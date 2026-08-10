"""Machinery for the ingestion KPI suite — upload, run, observe, reset.

``test_ingestion_kpi.py`` holds the assertions; this holds everything that
talks to something. Split that way because the assertions are the part a
reader of the thesis has to trust, and they are easier to trust when they are
not interleaved with HTTP.

What this talks to
------------------
* **Airflow 3** on ``localhost:8081`` — REST, bearer token from
  ``POST /auth/token`` (not basic auth; the old form fails with a misleading
  401). Used to trigger one DagRun per fixture, poll it, and read the ledger
  each stage returned through XCom.
* **Supabase**, the *cloud* project, over PostgREST + Storage with the
  service_role key. Not a local database: the Airflow Variables the DAG reads
  point at the cloud project, so that is where the pipeline actually writes,
  and measuring anywhere else would measure nothing.

The workspace scoping rule, which is not negotiable
---------------------------------------------------
The cloud project holds live data reserved for other measurements. **Nothing
here truncates a table.** Every write and every delete is scoped to one
workspace this module creates (:data:`TEST_TEAM_ID`, a fixed uuid5 so re-runs
reuse it), and every reset is bracketed by a check that the row counts *outside*
that workspace have not moved. A reset that would remove more than a test
workspace could plausibly hold aborts the suite instead of proceeding — see
:func:`reset_workspace`.
"""

from __future__ import annotations

import hashlib
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_ROOT = REPO_ROOT / "tests" / "fixtures"

# ── configuration ─────────────────────────────────────────────────────────────

AIRFLOW_URL = "http://localhost:8081"
AIRFLOW_USER = "airflow"
AIRFLOW_PASSWORD = "airflow"

DAG_ID = "buzzly_import_pipeline"
IMPORTS_BUCKET = "imports"

# The workspace every row this suite writes belongs to. Derived rather than
# random so a second run reuses the first one's workspace — which is what makes
# "delete everything scoped to this team" a complete reset rather than a
# growing pile of abandoned test workspaces.
TEST_TEAM_ID = str(uuid.uuid5(uuid.NAMESPACE_DNS, "ingestion-kpi.tests.buzzly.app"))
TEST_WORKSPACE_NAME = "Ingestion KPI harness — automated, do not use"

# `batch_id_for` in `buzzly_common.targets` derives one batch per job from the
# job id. Re-derived here rather than imported so the harness does not learn
# where to look from the code it is measuring — and `assert_batch_derivation`
# proves the two agree against a real promoted batch, once per run, so a drift
# is a loud failure rather than a scope that quietly matches nothing.
_IMPORT_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_DNS, "imports.buzzly.app")


def batch_id_for(import_job_id: str) -> str:
    return str(uuid.uuid5(_IMPORT_NAMESPACE, "\x1f".join(["batch", import_job_id.strip().casefold()])))


# The six tables `promote_batch` commits, plus the staging buffer. A leak check
# that watched only `ad_insights` would miss rows landing in `campaigns` or
# `ads`, which is exactly the shape a half-committed file has.
PROMOTE_TABLES = ("campaigns", "ad_groups", "ads", "campaign_ads", "ad_insights", "sync_history")

# `clean_thai` announces the dataset it resolved in its stage note, which
# reaches us through the ledger it returns on XCom. These are the two shapes
# that note can take. Declared here rather than imported from
# `buzzly_common.targets` for the same reason as the batch id; an unrecognised
# note raises instead of returning None, so a wording change cannot turn into a
# silently unasserted dataset.
_MAPPED_AS = re.compile(r"columns mapped as (\w+)")
_DATASET_LABELS = {
    "an ad performance export": "ad_performance",
    "a Shopee income report": "shopee_income",
    "a product cost (COGS) sheet": "product_cogs",
}

# How long one fixture may take. `fix_13` crashes with an exception the DAG
# treats as transient, so it burns both retries at 30s apart before the run is
# finally marked failed — the budget has to cover that or a known bug would be
# reported as a timeout.
RUN_TIMEOUT_SECONDS = 480
POLL_INTERVAL_SECONDS = 3

# A DagRun reaching `failed` is not the same moment as the job reaching its
# terminal status. When a task crashes without writing one itself, the status is
# written by the DAG-level `on_failure_callback`, which Airflow runs *after* it
# marks the run failed — measured at about five seconds. Reading `import_jobs`
# the instant the run ends therefore catches some jobs still at `running`, which
# would be reported as a stuck job when nothing is stuck. The grace is generous;
# a job that has still not settled after it is a real finding and is recorded as
# observed rather than retried into a nicer answer.
TERMINAL_JOB_GRACE_SECONDS = 90
TERMINAL_JOB_STATUSES = ("succeeded", "partial", "failed", "cancelled")

# The blast-radius ceilings (open item C). The largest fixture is 120 rows and
# every fixture is preceded by a reset, so a scoped delete should never see
# more than a few hundred rows. These are set well above that and still far
# below anything live: crossing one means the scope is wrong, and the suite
# stops rather than finds out afterwards.
MAX_ROWS_PER_TABLE = 2_000
MAX_ROWS_PER_RESET = 10_000


class HarnessAbort(RuntimeError):
    """Something is wrong with the harness or its scoping — stop, do not proceed.

    Distinct from a fixture failing. A fixture failure is a result; this is the
    suite refusing to keep running because it can no longer promise it is only
    touching its own workspace.
    """


# ── Supabase (cloud, service_role) ────────────────────────────────────────────


def load_service_credentials() -> tuple[str, str]:
    """The cloud project URL and service_role key, from ``mock-api/.env``.

    That file is gitignored and already holds these two values for the dev
    tooling; reading it beats a second copy that can fall out of step. Values
    may be quoted, so quotes are stripped.
    """
    path = REPO_ROOT / "mock-api" / ".env"
    if not path.is_file():
        raise HarnessAbort(f"{path} is missing — it holds the cloud service_role key")

    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")

    url = values.get("SUPABASE_URL", "")
    key = values.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise HarnessAbort(f"{path} has no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
    return url.rstrip("/"), key


class Supabase:
    """The slice of PostgREST and Storage this suite needs, service_role."""

    def __init__(self, url: str, key: str) -> None:
        self.url = url
        self._session = requests.Session()
        self._session.headers.update({"apikey": key, "Authorization": f"Bearer {key}"})

    def _request(self, method: str, path: str, **kwargs: Any) -> requests.Response:
        response = self._session.request(method, f"{self.url}{path}",
                                         timeout=kwargs.pop("timeout", 60), **kwargs)
        if not response.ok:
            raise HarnessAbort(f"{method} {path} -> {response.status_code}: {response.text[:400]}")
        return response

    # ── reads ────────────────────────────────────────────────────────────────

    def select(self, table: str, query: str) -> list[dict]:
        return self._request("GET", f"/rest/v1/{table}?{query}",
                             headers={"Content-Type": "application/json"}).json()

    def count(self, table: str, query: str = "") -> int:
        """Exact row count for a filter, read from the Content-Range header."""
        suffix = f"?{query}" if query else "?select=*"
        response = self._request("GET", f"/rest/v1/{table}{suffix}",
                                 headers={"Prefer": "count=exact", "Range": "0-0"})
        content_range = response.headers.get("content-range", "")
        total = content_range.rpartition("/")[2]
        if not total.isdigit():
            raise HarnessAbort(f"count({table}, {query!r}) got no usable Content-Range: "
                               f"{content_range!r}")
        return int(total)

    # ── writes ───────────────────────────────────────────────────────────────

    def insert(self, table: str, rows: list[dict], *, on_conflict: str | None = None) -> None:
        suffix = f"?on_conflict={on_conflict}" if on_conflict else ""
        prefer = "return=minimal"
        if on_conflict:
            prefer = "resolution=merge-duplicates,return=minimal"
        self._request("POST", f"/rest/v1/{table}{suffix}", json=rows,
                      headers={"Content-Type": "application/json", "Prefer": prefer})

    def patch(self, table: str, query: str, values: dict) -> list[dict]:
        return self._request("PATCH", f"/rest/v1/{table}?{query}", json=values,
                             headers={"Content-Type": "application/json",
                                      "Prefer": "return=representation"}).json()

    def delete(self, table: str, query: str) -> int:
        """Delete a filtered set and return how many rows went. Never unfiltered.

        The empty-query guard is the last line of defence between a scoping bug
        and a truncated live table: PostgREST happily deletes every row when a
        filter renders to nothing, and that is precisely the mistake this suite
        must be incapable of making.
        """
        if not query.strip():
            raise HarnessAbort(f"refusing an unfiltered DELETE on {table}")
        response = self._request("DELETE", f"/rest/v1/{table}?{query}",
                                 headers={"Prefer": "return=representation"})
        return len(response.json())

    def upload(self, path: str, data: bytes, content_type: str = "text/csv") -> None:
        segments = "/".join(requests.utils.quote(part) for part in path.split("/"))
        self._request("POST", f"/storage/v1/object/{IMPORTS_BUCKET}/{segments}",
                      data=data, headers={"Content-Type": content_type, "x-upsert": "true"})


# ── Airflow 3 REST ────────────────────────────────────────────────────────────


class Airflow:
    def __init__(self, base_url: str = AIRFLOW_URL, username: str = AIRFLOW_USER,
                 password: str = AIRFLOW_PASSWORD) -> None:
        self.base_url = base_url.rstrip("/")
        self._session = requests.Session()
        try:
            response = self._session.post(f"{self.base_url}/auth/token",
                                          json={"username": username, "password": password},
                                          timeout=15)
        except requests.RequestException as exc:
            raise HarnessAbort(f"Airflow at {self.base_url} did not answer: {exc}") from exc
        if not response.ok:
            raise HarnessAbort(f"Airflow auth failed: {response.status_code} {response.text[:200]}")
        self._session.headers.update({"Authorization": f"Bearer {response.json()['access_token']}"})

    def _get(self, path: str, *, allow_missing: bool = False) -> Any:
        response = self._session.get(f"{self.base_url}{path}", timeout=30)
        if response.status_code == 404 and allow_missing:
            return None
        if not response.ok:
            raise HarnessAbort(f"GET {path} -> {response.status_code}: {response.text[:300]}")
        return response.json()

    def assert_pipeline_unpaused(self) -> None:
        """Triggering a paused DAG succeeds and then nothing happens — check first."""
        dag = self._get(f"/api/v2/dags/{DAG_ID}")
        if dag.get("is_paused"):
            raise HarnessAbort(
                f"{DAG_ID} is paused. Triggering it would queue runs that never execute; "
                f"unpause it before running this suite."
            )

    def trigger(self, run_id: str, conf: dict) -> str:
        response = self._session.post(
            f"{self.base_url}/api/v2/dags/{DAG_ID}/dagRuns",
            json={"dag_run_id": run_id, "logical_date": None, "conf": conf},
            timeout=30,
        )
        if not response.ok:
            raise HarnessAbort(f"trigger {run_id} -> {response.status_code}: {response.text[:400]}")
        return response.json()["dag_run_id"]

    def wait(self, run_id: str, timeout: int = RUN_TIMEOUT_SECONDS) -> dict:
        quoted = requests.utils.quote(run_id, safe="")
        deadline = time.monotonic() + timeout
        while True:
            run = self._get(f"/api/v2/dags/{DAG_ID}/dagRuns/{quoted}")
            if run["state"] in ("success", "failed"):
                return run
            if time.monotonic() > deadline:
                raise HarnessAbort(
                    f"DagRun {run_id} was still {run['state']!r} after {timeout}s. "
                    "The suite stops rather than report a timeout as a pipeline result."
                )
            time.sleep(POLL_INTERVAL_SECONDS)

    def task_states(self, run_id: str) -> dict[str, str]:
        quoted = requests.utils.quote(run_id, safe="")
        payload = self._get(f"/api/v2/dags/{DAG_ID}/dagRuns/{quoted}/taskInstances")
        return {task["task_id"]: task.get("state") for task in payload["task_instances"]}

    def ledger(self, run_id: str, task_id: str) -> dict | None:
        """The ledger a stage returned, or None if it never ran.

        XCom rather than the task log: the ledger is a structured value Airflow
        already stores, and scraping a log for it would be reading a rendering
        of the thing instead of the thing.
        """
        quoted = requests.utils.quote(run_id, safe="")
        payload = self._get(
            f"/api/v2/dags/{DAG_ID}/dagRuns/{quoted}/taskInstances/{task_id}/xcomEntries/return_value",
            allow_missing=True,
        )
        return payload["value"] if payload else None


def dataset_from_ledger(ledger: dict | None) -> str | None:
    """Which dataset `clean_thai` resolved, read out of its own stage note.

    ``None`` means no dataset was resolved — either the stage never ran, or the
    ledger reached it already short-circuited. An *unrecognised* note is not
    ``None``: it raises, because a note this cannot read would otherwise turn
    the dataset assertion off without saying so.
    """
    if ledger is None:
        return None
    note = next((entry["note"] for entry in ledger.get("trail", [])
                 if entry.get("stage") == "clean_thai"), None)
    if note is None:
        return None
    if note.startswith("not run —"):
        return None

    matched = _MAPPED_AS.search(note)
    if matched:
        return matched.group(1)
    for label, dataset in _DATASET_LABELS.items():
        if label in note:
            return dataset
    raise HarnessAbort(
        f"clean_thai's note is not in a shape this harness can read: {note!r}. "
        "The dataset assertion cannot be made, so the suite stops rather than skip it."
    )


# ── the test workspace ────────────────────────────────────────────────────────


def ensure_workspace(db: Supabase) -> str:
    """Make sure the harness's own workspace exists. Returns its id.

    ``workspaces.owner_id`` is NOT NULL and references a real auth user, and a
    test harness has no business minting users — so a brand-new workspace
    borrows the owner id of an existing one. Nothing else of that owner's is
    read or written; the borrowed value only satisfies the foreign key.
    """
    existing = db.select("workspaces", f"id=eq.{TEST_TEAM_ID}&select=id")
    if existing:
        return TEST_TEAM_ID

    owners = db.select("workspaces", "select=owner_id&order=created_at.asc&limit=1")
    if not owners or not owners[0].get("owner_id"):
        raise HarnessAbort(
            "No existing workspace to borrow an owner_id from, and workspaces.owner_id "
            "is NOT NULL — cannot create the test workspace."
        )
    db.insert("workspaces", [{
        "id": TEST_TEAM_ID,
        "name": TEST_WORKSPACE_NAME,
        "owner_id": owners[0]["owner_id"],
        "description": "Created by tests/test_ingestion_kpi.py. Safe to delete when idle.",
    }])
    return TEST_TEAM_ID


# ── protected live counts (open item B) ───────────────────────────────────────

# The live rows this suite must leave exactly as it found them. Measured at
# Step 1 and re-measured at Step 3; they are reserved for a different KPI, so a
# change in any of them is a scoping failure, not a test failure.
PROTECTED_BASELINE = {"ad_insights": 881, "import_jobs": 9, "ingestion_dlq": 3}


def _in_filter(column: str, values: list[str]) -> str | None:
    """A PostgREST ``in.()`` filter, or None when the set is empty.

    None matters: ``in.()`` with nothing in it is a syntax error, and coercing
    it to "match everything" would be the worst possible reading.
    """
    if not values:
        return None
    return f"{column}=in.({','.join(values)})"


def test_ad_account_ids(db: Supabase) -> list[str]:
    """Every ad account belonging to the test workspace.

    Not one account: `resolve_ad_account` opens one per platform, and the corpus
    uploads under `meta`, `tiktok` and `shopee_ads`. Scoping `ad_insights` to a
    single account would leave two platforms' rows unwatched.
    """
    return [row["id"] for row in db.select("ad_accounts", f"team_id=eq.{TEST_TEAM_ID}&select=id")]


def protected_counts(db: Supabase) -> dict[str, int]:
    """Row counts for the three protected tables, *excluding* the test workspace.

    Counted as total-minus-ours rather than with a ``neq`` filter, because
    ``neq`` also drops rows whose column is NULL and would quietly understate
    the live total it is supposed to be protecting.
    """
    accounts = test_ad_account_ids(db)
    inside_insights = 0
    scope = _in_filter("ad_account_id", accounts)
    if scope:
        inside_insights = db.count("ad_insights", f"{scope}&select=*")
    return {
        "ad_insights": db.count("ad_insights") - inside_insights,
        "import_jobs": db.count("import_jobs") - db.count(
            "import_jobs", f"team_id=eq.{TEST_TEAM_ID}&select=*"),
        "ingestion_dlq": db.count("ingestion_dlq") - db.count(
            "ingestion_dlq", f"team_id=eq.{TEST_TEAM_ID}&select=*"),
    }


def assert_protected_unchanged(db: Supabase, *, where: str) -> dict[str, int]:
    counts = protected_counts(db)
    drift = {table: (PROTECTED_BASELINE[table], counts[table])
             for table in PROTECTED_BASELINE if counts[table] != PROTECTED_BASELINE[table]}
    if drift:
        raise HarnessAbort(
            f"Live rows outside the test workspace changed ({where}): "
            + ", ".join(f"{table} expected {want}, found {got}"
                        for table, (want, got) in drift.items())
            + ". The suite stops immediately — this is a scoping failure, not a test result."
        )
    return counts


# ── the scoped reset (open items B and C) ─────────────────────────────────────


def _reset_plan(db: Supabase) -> list[tuple[str, str]]:
    """``(table, filter)`` pairs in foreign-key-safe delete order.

    The two-step filters — campaign ids, job ids, batch ids — exist because
    PostgREST has no subqueries; each is the same set the approved SQL's
    ``IN (SELECT ...)`` would have produced, resolved one request earlier.
    """
    accounts = test_ad_account_ids(db)
    campaigns = [row["id"] for row in
                 db.select("campaigns", f"team_id=eq.{TEST_TEAM_ID}&select=id")]
    jobs = [row["id"] for row in
            db.select("import_jobs", f"team_id=eq.{TEST_TEAM_ID}&select=id")]

    # Staging rows for a batch that never promoted have no `ingestion_batches`
    # row at all — a batch row is written *by* the promote. So the buffer is
    # found by re-deriving each job's batch id, not by joining the batch table,
    # which would miss exactly the garbage a refused file leaves behind.
    batches = {batch_id_for(job) for job in jobs}
    batches.update(row["batch_id"] for row in
                   db.select("ingestion_batches", f"team_id=eq.{TEST_TEAM_ID}&select=batch_id"))

    plan: list[tuple[str, str]] = []

    def add(table: str, condition: str | None) -> None:
        if condition:
            plan.append((table, condition))

    add("ad_insights", _in_filter("ad_account_id", accounts))
    add("campaign_ads", _in_filter("campaign_id", campaigns))
    add("ads", f"team_id=eq.{TEST_TEAM_ID}")
    add("ad_groups", f"team_id=eq.{TEST_TEAM_ID}")
    add("campaigns", f"team_id=eq.{TEST_TEAM_ID}")
    add("sync_history", f"team_id=eq.{TEST_TEAM_ID}")
    add("ingestion_staging", _in_filter("batch_id", sorted(batches)))
    add("ingestion_batches", f"team_id=eq.{TEST_TEAM_ID}")
    add("ingestion_dlq", f"team_id=eq.{TEST_TEAM_ID}")
    add("import_row_errors", _in_filter("import_job_id", jobs))
    add("import_jobs", f"team_id=eq.{TEST_TEAM_ID}")
    return plan


def reset_workspace(db: Supabase, *, where: str) -> dict[str, int]:
    """Empty the test workspace, counting the blast radius before anything goes.

    PostgREST gives one transaction per request, so a single multi-statement
    transaction with a ROLLBACK is not available without adding a
    ``SECURITY DEFINER`` RPC — which is a migration, and migrations need
    approval. The requirement is met the other way instead, and not by counting
    and hoping:

    1. every filter is counted **before any delete runs**, and a count above the
       ceiling aborts the suite with nothing deleted;
    2. the protected live counts are verified before and after;
    3. each delete reports how many rows it removed, and the filter is re-counted
       afterwards — anything but zero aborts.

    Returns rows removed per table, for the run log.
    """
    assert_protected_unchanged(db, where=f"before reset {where}")

    plan = _reset_plan(db)

    # Phase one: look, do not touch. An oversized count here means the scope is
    # wrong, and finding that out after the DELETE would be finding out too late.
    counted = {table: db.count(table, f"{condition}&select=*") for table, condition in plan}
    oversized = {table: count for table, count in counted.items() if count > MAX_ROWS_PER_TABLE}
    if oversized:
        raise HarnessAbort(
            f"Reset aborted before deleting anything ({where}): {oversized} exceeds the "
            f"{MAX_ROWS_PER_TABLE}-row ceiling for a test workspace. The scope is wrong."
        )
    if sum(counted.values()) > MAX_ROWS_PER_RESET:
        raise HarnessAbort(
            f"Reset aborted before deleting anything ({where}): {sum(counted.values())} rows "
            f"in total exceeds the {MAX_ROWS_PER_RESET}-row ceiling. The scope is wrong."
        )

    # Phase two: delete, then prove each filter is empty.
    removed: dict[str, int] = {}
    for table, condition in plan:
        if not counted[table]:
            continue
        removed[table] = db.delete(table, condition)
        left = db.count(table, f"{condition}&select=*")
        if left:
            raise HarnessAbort(
                f"{table} still has {left} row(s) matching {condition!r} after the delete "
                f"({where}). Stopping rather than running a fixture against dirty state."
            )

    assert_protected_unchanged(db, where=f"after reset {where}")
    return removed


# ── running one fixture ───────────────────────────────────────────────────────


@dataclass
class Observation:
    """Everything one fixture's run left behind that the assertions read."""
    filename: str
    job_id: str
    run_id: str
    dag_state: str = ""
    job_status: str = ""
    rows_total: int = 0
    rows_ok: int = 0
    rows_quarantined: int = 0
    error_message: str | None = None
    # Whole rows, not just codes: every reset deletes the workspace's DLQ rows,
    # so the appendix dump has to be assembled fixture by fixture while the
    # evidence still exists. Reading the table once at the end would find only
    # the last file's record.
    dlq_rows: list[dict] = field(default_factory=list)
    dataset: str | None = None
    staged_rows: int = 0
    table_delta: dict[str, int] = field(default_factory=dict)
    task_states: dict[str, str] = field(default_factory=dict)
    seconds: float = 0.0
    # How long `import_jobs.status` took to reach a terminal value *after* the
    # DagRun already had one. Non-zero means this fixture went through the
    # settle wait, which is a fact about Airflow's callback timing rather than
    # about the file — recorded so the write-up can say which fixtures it
    # affected instead of claiming it affected none.
    settle_seconds: float = 0.0
    harness_error: str | None = None

    @property
    def dlq_codes(self) -> list[str]:
        return [row["error_code"] for row in self.dlq_rows]

    @property
    def dlq_code(self) -> str | None:
        return self.dlq_rows[0]["error_code"] if self.dlq_rows else None

    @property
    def rows_landed(self) -> int:
        return sum(self.table_delta.values())


def scoped_counts(db: Supabase) -> dict[str, int]:
    """Row counts in every table a promote writes, scoped to the test workspace.

    ``ad_insights`` carries no ``batch_id`` and no ``import_job_id``, so "this
    file stored nothing" cannot be a filter on the batch — it has to be a
    before/after difference, taken across all six tables rather than the obvious
    one.
    """
    accounts = test_ad_account_ids(db)
    campaigns = [row["id"] for row in
                 db.select("campaigns", f"team_id=eq.{TEST_TEAM_ID}&select=id")]

    insights_scope = _in_filter("ad_account_id", accounts)
    campaign_ads_scope = _in_filter("campaign_id", campaigns)
    return {
        "campaigns": db.count("campaigns", f"team_id=eq.{TEST_TEAM_ID}&select=*"),
        "ad_groups": db.count("ad_groups", f"team_id=eq.{TEST_TEAM_ID}&select=*"),
        "ads": db.count("ads", f"team_id=eq.{TEST_TEAM_ID}&select=*"),
        "campaign_ads": db.count("campaign_ads", f"{campaign_ads_scope}&select=*")
        if campaign_ads_scope else 0,
        "ad_insights": db.count("ad_insights", f"{insights_scope}&select=*")
        if insights_scope else 0,
        "sync_history": db.count("sync_history", f"team_id=eq.{TEST_TEAM_ID}&select=*"),
    }


def execution_order(specs: list[dict]) -> list[dict]:
    """Declaration order, except a dependent runs *immediately* after its dependency.

    The manifest's ordering rule is "``ok_20`` runs immediately after ``ok_01``
    with no reset in between", and in the corpus listing ``ok_20`` sits at the
    end of the valid group instead. Running the list as written puts eighteen
    resets between the pair, each of which deletes the workspace's
    ``import_jobs`` — including the completed import that is the only reason
    ``ok_20`` is a duplicate at all. So the rule is honoured here rather than
    assumed from the order the files happen to be listed in.

    The self-check at the end is the point: a fixture that skips its reset must
    be preceded by the thing it depends on, and if it is not, this stops the
    suite rather than hand it an ordering it cannot deliver.
    """
    by_name = {spec["filename"]: spec for spec in specs}
    dependents: dict[str, list[dict]] = {}
    for spec in specs:
        parent = spec["depends_on"]
        if parent is None:
            continue
        if parent not in by_name:
            raise HarnessAbort(f"{spec['filename']} depends on {parent}, which is not in "
                               "the manifest")
        dependents.setdefault(parent, []).append(spec)

    ordered: list[dict] = []

    def emit(spec: dict) -> None:
        ordered.append(spec)
        for child in dependents.get(spec["filename"], ()):
            emit(child)

    for spec in specs:
        if spec["depends_on"] is None:
            emit(spec)

    if len(ordered) != len(specs):
        raise HarnessAbort(f"ordering lost fixtures: {len(ordered)} of {len(specs)} — "
                           "a dependency cycle?")
    for position, spec in enumerate(ordered):
        if spec["reset_before"]:
            continue
        parent = spec["depends_on"]
        preceding = ordered[position - 1]["filename"] if position else None
        if parent is None or preceding != parent:
            raise HarnessAbort(
                f"{spec['filename']} skips its reset but does not run immediately after "
                f"{parent or 'anything'} (it follows {preceding}). It would be measured "
                "against state the manifest does not describe."
            )
    return ordered


def assert_dependency_ingested(db: Supabase, *, dependant: str, depends_on: Path) -> None:
    """Open item A: refuse to run a dependent fixture out of order.

    ``ok_20`` is only a duplicate because ``ok_01`` already ingested these exact
    bytes — `hash_dedupe` looks for a *succeeded import of the same hash that
    took rows*. Run it alone (``-k ok_20``), or in a shuffled order, or after a
    reset that cleared ``import_jobs``, and it ingests cleanly and "passes" for
    a reason that has nothing to do with duplicate detection. So the evidence
    `hash_dedupe` needs is checked here, and its absence stops the suite.
    """
    digest = hashlib.sha256(depends_on.read_bytes()).hexdigest()
    previous = db.select(
        "import_jobs",
        f"team_id=eq.{TEST_TEAM_ID}&file_hash=eq.{digest}&status=eq.succeeded"
        f"&rows_ok=gt.0&select=id,original_filename,rows_ok",
    )
    if not previous:
        raise HarnessAbort(
            f"{dependant} needs {depends_on.name} to have already ingested these bytes "
            f"(sha256 {digest[:12]}…), and no succeeded import with rows_ok > 0 exists for "
            "this workspace. Running it now would test a fresh ingest, not a duplicate. "
            "Run the whole suite in order rather than a single fixture."
        )


def wait_for_terminal_job(db: Supabase, job_id: str) -> tuple[dict, float]:
    """The job row once its status settles — or as it stands when the grace runs out.

    Deliberately not an abort. A job that never leaves ``running`` is the exact
    failure the DAG's callback exists to prevent, so it is worth *reporting*;
    turning it into a harness error would hide a pipeline result behind an
    infrastructure complaint.
    """
    started = time.monotonic()
    deadline = started + TERMINAL_JOB_GRACE_SECONDS
    while True:
        job = db.select("import_jobs", f"id=eq.{job_id}&select=*")[0]
        if job["status"] in TERMINAL_JOB_STATUSES or time.monotonic() > deadline:
            return job, round(time.monotonic() - started, 1)
        time.sleep(POLL_INTERVAL_SECONDS)


def run_fixture(db: Supabase, air: Airflow, spec: dict) -> Observation:
    """Upload one fixture the way the UI does, run it, and record what happened.

    Mirrors ``src/hooks/useImportJobs.tsx``: the object exists in Storage
    **before** the ``import_jobs`` row, so a trigger path can never pick up a
    job whose file is missing.

    The one addition is the claim between the insert and the trigger. Both real
    trigger paths — the Edge Function and the sensor DAG — claim a job
    (``pending`` -> ``queued``) before triggering it, and skipping that here
    would leave the row visible to the sensor for as long as the DagRun took to
    start. Two runs would then process one file. Claiming is therefore
    faithfulness to the upload contract, not a shortcut around it.
    """
    path = FIXTURE_ROOT / spec["filename"]
    data = path.read_bytes()
    job_id = str(uuid.uuid4())
    run_id = f"kpi__{job_id}"
    storage_path = f"{TEST_TEAM_ID}/{job_id}/{path.name}"

    before = scoped_counts(db)

    db.upload(storage_path, data)
    db.insert("import_jobs", [{
        "id": job_id,
        "team_id": TEST_TEAM_ID,
        "uploaded_by": None,
        "platform": spec["platform"],
        "storage_path": storage_path,
        "original_filename": path.name,
        "file_hash": hashlib.sha256(data).hexdigest(),
        "file_size_bytes": len(data),
        "status": "pending",
    }])

    claimed = db.patch("import_jobs", f"id=eq.{job_id}&status=eq.pending",
                       {"status": "queued"})
    if len(claimed) != 1:
        raise HarnessAbort(
            f"Could not claim job {job_id} for {spec['filename']} — something else took it "
            "first. Pause buzzly_import_sensor and re-run."
        )

    observation = Observation(filename=spec["filename"], job_id=job_id, run_id=run_id)
    started = time.monotonic()
    air.trigger(run_id, {"import_job_id": job_id})
    run = air.wait(run_id)
    observation.seconds = round(time.monotonic() - started, 1)
    observation.dag_state = run["state"]
    observation.task_states = air.task_states(run_id)

    job, observation.settle_seconds = wait_for_terminal_job(db, job_id)
    observation.job_status = job["status"]
    observation.rows_total = job["rows_total"]
    observation.rows_ok = job["rows_ok"]
    observation.rows_quarantined = job["rows_quarantined"]
    observation.error_message = job.get("error_message")

    observation.dlq_rows = db.select(
        "ingestion_dlq", f"import_job_id=eq.{job_id}&select=*&order=occurred_at.asc")
    observation.dataset = dataset_from_ledger(air.ledger(run_id, "clean_thai"))
    observation.staged_rows = db.count(
        "ingestion_staging", f"batch_id=eq.{batch_id_for(job_id)}&select=*")

    after = scoped_counts(db)
    observation.table_delta = {table: after[table] - before[table] for table in PROMOTE_TABLES}
    return observation


def assert_batch_derivation(db: Supabase, observation: Observation) -> None:
    """Prove the harness derives the same batch id the pipeline used.

    Called once, against a fixture that really promoted. Without it, a drift in
    the derivation would leave every ``ingestion_staging`` check querying a
    batch that does not exist — which reads as "the buffer is empty" and passes
    every time, turning the sharpest leak assertion in the suite off silently.
    """
    expected = batch_id_for(observation.job_id)
    rows = db.select("ingestion_batches",
                     f"import_job_id=eq.{observation.job_id}&select=batch_id")
    if not rows:
        raise HarnessAbort(
            f"{observation.filename} promoted no batch, so the batch-id derivation this "
            "harness relies on cannot be verified."
        )
    if rows[0]["batch_id"] != expected:
        raise HarnessAbort(
            f"Batch id drift: the pipeline used {rows[0]['batch_id']}, this harness derives "
            f"{expected}. Every staging-leak check would be querying nothing. See "
            "buzzly_common.targets.batch_id_for."
        )
