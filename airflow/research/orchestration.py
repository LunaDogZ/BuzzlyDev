"""What running the pipeline *as a DAG* costs, and what it buys.

The offline half of this harness measures the cleaning module. This half
measures the decision to orchestrate it at all — which is the claim that needs
evidence, because "use Airflow" is the part a reader is entitled to be
sceptical about. A cleaning module is obviously worth something; a scheduler
wrapped around a script has to justify itself in numbers.

Read-only by design
-------------------
Every figure here comes from DagRuns that already happened — real imports of
real fixtures through the real sensor path, including the ones that failed.
Nothing is triggered, nothing is written, so running the harness cannot change
the history it is reporting on, and a second run on the same instance produces
the same numbers.

The comparison that is actually fair
------------------------------------
Comparing "DAG wall clock" against "script wall clock" would be dishonest: six
of the eleven tasks spend their time on network round-trips to Supabase, which
a single-process script would also have to pay. So the comparison is restricted
to :data:`COMPUTE_STAGES` — the four tasks that only read and transform the file
— against the same work called in-process by :mod:`research.measure`. The
difference between those two is the per-task cost of orchestration and nothing
else.

That cost is real and this module reports it without flattering it. What it
buys is stated alongside, because a number with no counterpart is an argument
for removing the thing being measured:

* a retry boundary per stage, which is why a network blip re-runs one task
  instead of re-reading a 3,458-row file,
* a log boundary per stage, which is how a failure is attributed to
  ``validate`` (the merchant's data) rather than ``verify_artifact`` (our
  storage) without opening a debugger,
* a timing boundary per stage — the very numbers below, which no
  single-script implementation would produce at all.
"""

from __future__ import annotations

import json
import os
import statistics
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

DEFAULT_BASE_URL = os.environ.get("BUZZLY_AIRFLOW_URL", "http://localhost:8081")
DEFAULT_USERNAME = os.environ.get("BUZZLY_AIRFLOW_USER", "airflow")
DEFAULT_PASSWORD = os.environ.get("BUZZLY_AIRFLOW_PASSWORD", "airflow")

PIPELINE_DAG = "buzzly_import_pipeline"
SENSOR_DAG = "buzzly_import_sensor"

# The tasks that only read and transform the staged file. No Supabase, no
# Storage — so their duration is the stage's own work plus exactly one task
# boundary, which is what makes them comparable with an in-process call.
COMPUTE_STAGES = ("detect_format", "parse", "clean_thai", "validate")

# Which in-process phase each compute stage corresponds to, so the two sides of
# the comparison are stated rather than assumed. `detect_format` and `parse`
# both come out of the reader; `clean_thai` maps headers and types every cell.
STAGE_TO_PHASE = {
    "detect_format": ("read",),
    "parse": ("read",),
    "clean_thai": ("map", "type"),
    "validate": ("validate",),
}


class AirflowUnavailable(Exception):
    """Airflow is not reachable — the live half is skipped, not failed."""


class AirflowAPI:
    """The slice of the Airflow 3 REST API this harness needs.

    Auth is ``POST /auth/token`` returning a bearer token, not basic auth —
    Airflow 3 changed this and the old form fails with a misleading 401.
    """

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        username: str = DEFAULT_USERNAME,
        password: str = DEFAULT_PASSWORD,
        timeout: int = 15,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self.timeout = timeout
        self._token: str | None = None

    def _post_json(self, path: str, payload: dict) -> dict:
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            return json.loads(response.read())

    def token(self) -> str:
        if self._token is None:
            try:
                body = self._post_json(
                    "/auth/token", {"username": self.username, "password": self.password}
                )
            except (urllib.error.URLError, OSError) as exc:
                raise AirflowUnavailable(f"{self.base_url} did not answer: {exc}") from exc
            self._token = body["access_token"]
        return self._token

    def get(self, path: str) -> dict:
        request = urllib.request.Request(
            f"{self.base_url}{path}", headers={"Authorization": f"Bearer {self.token()}"}
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            raise AirflowUnavailable(f"GET {path} -> {exc.code}") from exc
        except (urllib.error.URLError, OSError) as exc:
            raise AirflowUnavailable(f"GET {path} failed: {exc}") from exc

    def dag_runs(self, dag_id: str, limit: int = 100) -> list[dict]:
        return self.get(f"/api/v2/dags/{dag_id}/dagRuns?limit={limit}")["dag_runs"]

    def task_instances(self, dag_id: str, run_id: str) -> list[dict]:
        quoted = urllib.parse.quote(run_id, safe="")
        return self.get(
            f"/api/v2/dags/{dag_id}/dagRuns/{quoted}/taskInstances"
        )["task_instances"]


# ── statistics ────────────────────────────────────────────────────────────────


def _summarise(values: list[float]) -> dict:
    """Median first, because one slow cold start skews a mean and not a median."""
    if not values:
        return {"n": 0}
    ordered = sorted(values)
    return {
        "n": len(ordered),
        "median": round(statistics.median(ordered), 3),
        "min": round(ordered[0], 3),
        "max": round(ordered[-1], 3),
        # The 95th percentile of a handful of runs is the slowest of them; it is
        # reported anyway because a tail is what a merchant waiting on a spinner
        # experiences, and hiding it behind a median would be flattering.
        "p95": round(ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))], 3),
    }


def _run_seconds(run: dict) -> float | None:
    start, end = run.get("start_date"), run.get("end_date")
    if not start or not end:
        return None
    import datetime as dt

    parse = lambda text: dt.datetime.fromisoformat(text.replace("Z", "+00:00"))  # noqa: E731
    return (parse(end) - parse(start)).total_seconds()


def measure_runs(api: AirflowAPI, dag_id: str = PIPELINE_DAG, limit: int = 100) -> dict:
    """Per-stage timing, outcomes and retries across the instance's real history."""
    runs = api.dag_runs(dag_id, limit=limit)
    if not runs:
        return {"runs": 0, "note": f"{dag_id} has no run history on this instance"}

    stage_durations: dict[str, list[float]] = {}
    outcomes: dict[str, int] = {}
    wall_by_state: dict[str, list[float]] = {}
    retries: list[dict] = []
    task_total_by_run: dict[str, float] = {}
    failed_stages: dict[str, int] = {}

    for run in runs:
        state = run.get("state") or "unknown"
        outcomes[state] = outcomes.get(state, 0) + 1
        seconds = _run_seconds(run)
        if seconds is not None:
            wall_by_state.setdefault(state, []).append(seconds)

        instances = api.task_instances(dag_id, run["dag_run_id"])
        run_total = 0.0
        for task in instances:
            duration = task.get("duration")
            if duration is not None:
                stage_durations.setdefault(task["task_id"], []).append(duration)
                run_total += duration
            if (task.get("try_number") or 1) > 1:
                retries.append({
                    "run_id": run["dag_run_id"], "task_id": task["task_id"],
                    "tries": task["try_number"], "final_state": task.get("state"),
                })
            if task.get("state") == "failed":
                failed_stages[task["task_id"]] = failed_stages.get(task["task_id"], 0) + 1
        task_total_by_run[run["dag_run_id"]] = run_total

    # Wall clock the run spent not executing a task: scheduling, executor
    # hand-off and XCom round-trips. The price of the boundaries, isolated.
    overheads = [
        seconds - task_total_by_run.get(run["dag_run_id"], 0.0)
        for run in runs
        if (seconds := _run_seconds(run)) is not None
    ]

    # The history spans every version of this DAG that has ever run on the
    # instance, so it can contain tasks the DAG no longer has — `process` was
    # the single no-op task the stages replaced in step 4. Those rows are kept
    # rather than filtered (deleting inconvenient history is not measurement)
    # and flagged, so nobody quotes a timing for a task that no longer exists.
    try:
        from buzzly_common.pipeline import PROGRESS_STAGES

        current = {*PROGRESS_STAGES, "cleanup_staging"}
    except ImportError:  # pragma: no cover - only when run outside the repo
        current = set()

    return {
        "dag_id": dag_id,
        "runs": len(runs),
        "outcomes": outcomes,
        "first_run": runs[0].get("start_date"),
        "last_run": runs[-1].get("start_date"),
        "stages": {
            stage: {**_summarise(values), "retired": bool(current) and stage not in current}
            for stage, values in stage_durations.items()
        },
        "wall_seconds": {state: _summarise(values) for state, values in wall_by_state.items()},
        "scheduling_overhead_seconds": _summarise(overheads),
        "retries": retries,
        "tasks_retried": len(retries),
        # Where runs actually die. A pipeline whose failures cluster in one
        # stage is telling you which input it cannot handle.
        "failed_stages": failed_stages,
    }


def measure_dag_vs_inprocess(runs_report: dict, phases_ms: dict) -> dict:
    """The orchestration tax, per task boundary, on identical work.

    ``phases_ms`` is the per-phase timing :mod:`research.measure` records for a
    fixture — the same reading and transforming, called directly.
    """
    stages = runs_report.get("stages", {})
    rows = []
    for stage in COMPUTE_STAGES:
        summary = stages.get(stage)
        if not summary or not summary.get("n") or summary.get("retired"):
            continue
        in_process_ms = sum(phases_ms.get(phase, 0.0) for phase in STAGE_TO_PHASE[stage])
        dag_ms = summary["median"] * 1000
        rows.append({
            "stage": stage,
            "dag_median_ms": round(dag_ms, 1),
            "in_process_ms": round(in_process_ms, 3),
            "overhead_ms": round(dag_ms - in_process_ms, 1),
        })

    if not rows:
        return {"comparable": False, "reason": "no compute-stage timings in the history"}

    dag_total = sum(row["dag_median_ms"] for row in rows)
    in_process_total = sum(row["in_process_ms"] for row in rows)
    return {
        "comparable": True,
        "stages": rows,
        "dag_total_ms": round(dag_total, 1),
        "in_process_total_ms": round(in_process_total, 3),
        "overhead_total_ms": round(dag_total - in_process_total, 1),
        "overhead_per_task_ms": round((dag_total - in_process_total) / len(rows), 1),
        "slowdown_factor": round(dag_total / in_process_total, 1) if in_process_total else None,
        "tasks_in_dag": 11,
        "note": (
            "Restricted to the four tasks that touch no network. The other seven "
            "spend their time on Supabase round-trips a single script would pay too."
        ),
    }


def measure_orchestration(phases_ms: dict, limit: int = 100) -> dict:
    """The live half. Returns a skip record rather than raising when Airflow is down."""
    api = AirflowAPI()
    try:
        pipeline = measure_runs(api, PIPELINE_DAG, limit=limit)
        sensor = measure_runs(api, SENSOR_DAG, limit=limit)
    except AirflowUnavailable as exc:
        return {
            "available": False,
            "reason": str(exc),
            "hint": "cd airflow && docker compose up -d",
        }

    return {
        "available": True,
        "base_url": DEFAULT_BASE_URL,
        "pipeline": pipeline,
        # The sensor is measured too: it is the component that makes the whole
        # thing work without Airflow being reachable from the internet, and its
        # cost is one poll every two minutes whether or not there is work.
        "sensor": {
            "runs": sensor.get("runs"),
            "outcomes": sensor.get("outcomes"),
            "wall_seconds": sensor.get("wall_seconds"),
        },
        "dag_vs_inprocess": measure_dag_vs_inprocess(pipeline, phases_ms),
    }
