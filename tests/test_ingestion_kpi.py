"""KPI-2 (Ingestion Success) and KPI-3 (DLQ Capture), measured end to end.

    python3 -m pytest tests/test_ingestion_kpi.py -v

Runs without pytest too — every case is a plain ``unittest`` test, so a machine
with no install step can use::

    python3 -m unittest discover -s tests -v

What this is
------------
Not a unit test. Each of the 35 frozen fixtures is uploaded to the *cloud*
Supabase project exactly as ``/imports`` uploads a merchant's file, run through
the real ``buzzly_import_pipeline`` DAG on the local Airflow, and then observed
in the database. The deliverable is evidence, not a green tick:
``tests/RESULTS.md`` (file -> expected -> actual -> verdict, with a summary line
per KPI) and ``tests/evidence/dlq_dump.csv`` (the raw dead-letter rows, for the
thesis appendix). Both are written even when cases fail, because a failure is a
result and a results file that only exists when everything passed is not
evidence of anything.

Expectations come from ``tests/fixtures/MANIFEST.json``, rendered from the same
declared ``EXPECTATIONS`` list as ``MANIFEST.md`` by ``generate.py``. They are
hand-written intent, read off the pipeline's rules — never produced by running
the pipeline, which would only prove it agrees with itself.

Why the whole corpus runs in ``setUpClass``
-------------------------------------------
Three reasons, all of them properties of the thing being measured:

* **Order is load-bearing.** ``ok_20`` is a duplicate only because ``ok_01``
  ingested the same bytes first, and the reset between fixtures is skipped for
  exactly that pair. A test that ran fixtures independently would measure
  something else.
* **A reset stands between every pair of fixtures**, so they cannot be
  parallelised and must not interleave.
* **The verdicts are computed once, up front**, so ``RESULTS.md`` describes the
  same run whatever the test runner does with the assertions afterwards.

Every fixture then gets its own test case reporting its own verdict, so a
failure names a file rather than the suite.

Nothing here fixes anything
---------------------------
If a fixture fails, this suite reports it. Per the standing constraint on this
work, the pipeline is not patched to make a case pass — a failure is either a
real bug or a bad fixture, and which one it is a human decides. ``fix_13`` is
the known bug, pinned as an XFAIL against its *actual* behaviour; if it ever
starts behaving as declared, that is reported as a failure too, because the
frozen spec would then no longer describe reality.
"""

from __future__ import annotations

import csv
import json
import os
import sys
import unittest
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import kpi_harness as kpi  # noqa: E402

TESTS_ROOT = Path(__file__).resolve().parent
SPEC_PATH = TESTS_ROOT / "fixtures" / "MANIFEST.json"
RESULTS_PATH = TESTS_ROOT / "RESULTS.md"
DLQ_DUMP_PATH = TESTS_ROOT / "evidence" / "dlq_dump.csv"
RUNS_DIR = TESTS_ROOT / "evidence" / "runs"

# A new measurement is a new dated directory, never a replacement of the old
# evidence. With KPI_EVIDENCE_DIR set, all three outputs — and the archive the
# re-runnability comparison reads — live there instead.
if os.environ.get("KPI_EVIDENCE_DIR"):
    _evidence = Path(os.environ["KPI_EVIDENCE_DIR"]).resolve()
    RESULTS_PATH = _evidence / "RESULTS.md"
    DLQ_DUMP_PATH = _evidence / "dlq_dump.csv"
    RUNS_DIR = _evidence / "runs"

# The fields two runs of the same corpus must agree on, exactly. Timings and
# ids are deliberately absent: a run that took a second longer is not a
# different result, and treating it as one would bury a real difference in
# noise. Everything here is an outcome the pipeline decided.
COMPARABLE_FIELDS = ("verdict", "job_status", "dlq_code", "dataset", "rows_total",
                     "rows_ok", "rows_quarantined", "table_delta", "staged_rows",
                     "harness_error")

# `fix_13` documents a real bug: a UTF-16 BOM with an odd byte count raises a
# bare UnicodeDecodeError out of `reader.py:76`, which `detect_format` does not
# catch, so the task crashes and no DLQ row is ever written. The manifest
# declares what the file *should* do (ENCODING_ERROR); this is what it actually
# does, and the two are kept apart on purpose so the fix — in a later, approved
# session — has a before and an after to point at.
KNOWN_FAILURE = "malformed/fix_13_ENCODING_ERROR.csv"
KNOWN_FAILURE_ACTUAL = {"job_status": "failed", "dlq_code": None, "dataset": None}


def load_spec() -> list[dict]:
    if not SPEC_PATH.is_file():
        raise kpi.HarnessAbort(
            f"{SPEC_PATH} is missing. Run `python3 tests/fixtures/generate.py` first."
        )
    return json.loads(SPEC_PATH.read_text(encoding="utf-8"))["fixtures"]


# ── verdicts ──────────────────────────────────────────────────────────────────


def evaluate(spec: dict, observed: kpi.Observation) -> list[str]:
    """Every way this fixture failed its declared expectation. Empty means pass.

    All the checks run — the list is not short-circuited at the first failure —
    because "wrong DLQ code" and "also leaked four rows" are two findings, and
    reporting one of them would understate what happened.
    """
    if observed.harness_error:
        return [f"the run did not complete: {observed.harness_error}"]

    if spec["filename"] == KNOWN_FAILURE:
        return _evaluate_known_failure(observed)

    problems: list[str] = []

    if observed.job_status != spec["job_status"]:
        problems.append(
            f"import_jobs.status is {observed.job_status!r}, expected {spec['job_status']!r}"
            + (f" (message: {observed.error_message!r})" if observed.error_message else "")
        )

    # The database enforces one DLQ row per job with a unique partial index, so
    # a second row would mean the index is gone — worth catching here rather
    # than trusting a constraint the harness can actually see the effect of.
    if len(observed.dlq_rows) > 1:
        problems.append(f"{len(observed.dlq_rows)} DLQ rows for one job: {observed.dlq_codes}")
    elif observed.dlq_code != spec["dlq_code"]:
        problems.append(
            f"ingestion_dlq.error_code is {observed.dlq_code or 'no row'}, "
            f"expected {spec['dlq_code'] or 'no row'}"
        )

    if observed.dataset != spec["dataset"]:
        problems.append(
            f"resolved dataset is {observed.dataset or 'none'}, "
            f"expected {spec['dataset'] or 'none'}"
        )

    problems.extend(_evaluate_storage(spec, observed))
    return problems


def _evaluate_storage(spec: dict, observed: kpi.Observation) -> list[str]:
    """Did the file's rows land where the manifest says they must — or not at all."""
    problems: list[str] = []

    # Asserted for every outcome, and it is the requested explicit check for
    # each malformed fixture: rows in `ingestion_staging` derived from *this
    # job's* batch id must be zero. `promote_batch` drops the buffer in the same
    # transaction that commits, and a refused file never stages anything at all
    # (`upsert_target` returns before `ingest_ad_performance`, the only caller
    # of `stage_rows`). A non-empty buffer means one of those stopped being true.
    #
    # The scoping is what stops this passing vacuously. `ingestion_batches` rows
    # are written *by* the promote, so a refused file has none, and the filter
    # this replaced — staging joined through `ingestion_batches` — would have
    # matched the empty set for every refused file and proved nothing.
    if observed.staged_rows:
        problems.append(f"ingestion_staging still holds {observed.staged_rows} row(s) "
                        f"for this job's batch ({kpi.batch_id_for(observed.job_id)})")

    if spec["ingests"]:
        if observed.table_delta.get("ad_insights", 0) <= 0:
            problems.append(f"no rows reached ad_insights (deltas: {observed.table_delta})")
        if observed.rows_ok <= 0:
            problems.append(f"import_jobs.rows_ok is {observed.rows_ok}, expected the "
                            "whole file")
        if observed.rows_quarantined:
            problems.append(f"{observed.rows_quarantined} row(s) were quarantined in a file "
                            "that should have been clean")
        return problems

    # The hard gate. Not "ad_insights is empty" — all six tables a promote
    # writes, because a half-committed file shows up in `campaigns` and `ads`
    # before it shows up in the insights.
    leaked = {table: delta for table, delta in observed.table_delta.items() if delta}
    if leaked:
        problems.append(f"rows leaked into the fact tables: {leaked}")
    return problems


def _evaluate_known_failure(observed: kpi.Observation) -> list[str]:
    """`fix_13` is asserted against the bug, not against the manifest.

    An unexpected *pass* is reported as a failure. If the file starts producing
    the ENCODING_ERROR the manifest declares, the bug has been fixed and the
    frozen spec no longer describes reality — that needs a human to update the
    manifest and flip the xfail, not a suite that quietly goes green.
    """
    actual = {"job_status": observed.job_status, "dlq_code": observed.dlq_code,
              "dataset": observed.dataset}
    if actual == KNOWN_FAILURE_ACTUAL:
        return []
    if observed.dlq_code == "ENCODING_ERROR":
        return ["XPASS — fix_13 now produces ENCODING_ERROR, so the reader bug appears "
                "fixed. Update MANIFEST.md and remove the xfail; do not leave this "
                "reporting a stale known failure."]
    return [f"the known failure changed shape: {actual}, previously {KNOWN_FAILURE_ACTUAL}"]


# ── the run ───────────────────────────────────────────────────────────────────


class IngestionKPI(unittest.TestCase):
    """One live pass over the corpus, then one test case per fixture."""

    specs: list[dict] = []
    observations: dict[str, kpi.Observation] = {}
    verdicts: dict[str, list[str]] = {}
    baseline_start: dict[str, int] = {}
    baseline_end: dict[str, int] = {}
    started_at: str = ""

    @classmethod
    def setUpClass(cls) -> None:
        cls.specs = load_spec()
        cls.started_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

        url, key = kpi.load_service_credentials()
        db = kpi.Supabase(url, key)
        air = kpi.Airflow()
        air.assert_pipeline_unpaused()
        kpi.ensure_workspace(db)

        # Open item B, first half. Taken before anything is created, so the
        # number RESULTS.md reports as "untouched" is one this run observed
        # rather than one it inherited from the handoff document.
        cls.baseline_start = kpi.assert_protected_unchanged(db, where="suite start")

        # Section 5.2 of the handoff: without this, run two would find ok_01's
        # bytes already imported and score it as a duplicate — KPI-2 would come
        # out 19/20 for a reason that has nothing to do with the pipeline.
        kpi.reset_workspace(db, where="suite start")

        by_name = {spec["filename"]: spec for spec in cls.specs}
        verified_batch_derivation = False

        # Not the order the manifest lists them in — the order its ordering rule
        # requires. `ok_20` is a duplicate only if `ok_01`'s completed import is
        # still there when it runs, and every reset in between deletes exactly
        # that. See `kpi.execution_order`.
        for index, spec in enumerate(kpi.execution_order(cls.specs)):
            name = spec["filename"]
            if spec["reset_before"] and index:
                kpi.reset_workspace(db, where=f"before {name}")
            if spec["depends_on"]:
                kpi.assert_dependency_ingested(
                    db, dependant=name,
                    depends_on=kpi.FIXTURE_ROOT / by_name[spec["depends_on"]]["filename"],
                )

            try:
                observation = kpi.run_fixture(db, air, spec)
            except kpi.HarnessAbort:
                raise
            except Exception as exc:  # noqa: BLE001 — one bad fixture must not lose the rest
                observation = kpi.Observation(filename=name, job_id="", run_id="")
                observation.harness_error = f"{type(exc).__name__}: {exc}"

            cls.observations[name] = observation
            cls.verdicts[name] = evaluate(spec, observation)

            # Done once, on the first file that really committed: it proves the
            # batch id this harness derives is the one the pipeline used, and so
            # that every `ingestion_staging` check above is querying real rows
            # rather than an id that matches nothing.
            if not verified_batch_derivation and spec["ingests"] and not observation.harness_error:
                kpi.assert_batch_derivation(db, observation)
                verified_batch_derivation = True

            print(f"  {name:52} {observation.job_status or 'ERROR':10} "
                  f"{observation.dlq_code or '—':22} {observation.seconds:6.1f}s "
                  f"{'ok' if not cls.verdicts[name] else 'FAIL'}", flush=True)

        if not verified_batch_derivation:
            raise kpi.HarnessAbort(
                "No fixture committed a batch, so the batch-id derivation was never "
                "verified and every staging-leak check is unproven."
            )

        # Open item B, second half. The suite is only trustworthy if the live
        # rows are still exactly where they were before it started.
        cls.baseline_end = kpi.assert_protected_unchanged(db, where="suite end")

    @classmethod
    def tearDownClass(cls) -> None:
        if not cls.observations:
            return
        # The previous run is loaded *before* this one is archived, so the
        # comparison is against a different run rather than against itself.
        previous = load_previous_run()
        archive = write_run_archive(cls)
        write_dlq_dump(cls.observations)
        RESULTS_PATH.write_text(render_results(cls, previous), encoding="utf-8")
        print(f"\nevidence -> {RESULTS_PATH}\nevidence -> {DLQ_DUMP_PATH}"
              f"\nevidence -> {archive}", flush=True)

    def _check(self, filename: str) -> None:
        problems = self.verdicts[filename]
        if problems:
            self.fail(f"{filename}\n  - " + "\n  - ".join(problems))


def _attach_cases() -> None:
    """One test method per fixture, so a failure names the file it is about."""
    for index, spec in enumerate(load_spec()):
        name = spec["filename"]
        stem = Path(name).stem
        method = (lambda filename: lambda self: self._check(filename))(name)
        method.__doc__ = f"{name} — {spec['what']}"
        setattr(IngestionKPI, f"test_{index:02d}_{stem}", method)


_attach_cases()


# ── evidence ──────────────────────────────────────────────────────────────────

DLQ_COLUMNS = ("occurred_at", "original_filename", "platform", "error_code", "stage",
               "rows_attempted", "rows_rejected", "error_message", "file_hash",
               "batch_id", "import_job_id", "team_id", "dag_run_id", "detail", "id")


def _comparable(cls, filename: str) -> dict:
    """One fixture's outcome, reduced to what two runs must agree on."""
    observed = cls.observations[filename]
    return {
        "verdict": cls.verdicts.get(filename, []),
        "job_status": observed.job_status,
        "dlq_code": observed.dlq_code,
        "dataset": observed.dataset,
        "rows_total": observed.rows_total,
        "rows_ok": observed.rows_ok,
        "rows_quarantined": observed.rows_quarantined,
        "table_delta": observed.table_delta,
        "staged_rows": observed.staged_rows,
        "harness_error": observed.harness_error,
    }


def write_run_archive(cls) -> Path:
    """Keep this run's outcomes so the next one has something to be compared to.

    Re-runnability is a claim the handoff makes and nothing so far has
    evidenced. Two archived runs that agree fixture-for-fixture are that
    evidence; one run cannot be.
    """
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = cls.started_at.replace(":", "").replace("-", "")
    path = RUNS_DIR / f"run_{stamp}.json"
    path.write_text(json.dumps({
        "started_at": cls.started_at,
        "baseline_start": cls.baseline_start,
        "baseline_end": cls.baseline_end,
        "settle_seconds": {name: observed.settle_seconds
                           for name, observed in cls.observations.items()},
        "fixtures": {name: _comparable(cls, name) for name in cls.observations},
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def load_previous_run() -> dict | None:
    """The most recently archived run, or None on a first run."""
    if not RUNS_DIR.is_dir():
        return None
    archives = sorted(RUNS_DIR.glob("run_*.json"))
    if not archives:
        return None
    return json.loads(archives[-1].read_text(encoding="utf-8"))


def render_comparison(cls, previous: dict | None) -> list[str]:
    """Run-to-run agreement, or the exact fixtures that disagreed.

    A difference is reported as a **finding**, never resolved by preferring the
    later run. Two runs of a frozen corpus against a reset workspace should be
    identical; if they are not, the interesting thing is the difference itself.
    """
    lines = ["## Re-runnability — this run against the previous one", ""]
    if previous is None:
        return lines + [
            "No earlier archived run to compare against, so this run evidences the KPI "
            "numbers but **not** re-runnability. Run the suite once more: the next "
            "RESULTS.md compares the two and the comparison is the evidence.",
            "",
        ]

    lines.append(f"Compared against the run started **{previous['started_at']}** "
                 f"(this run: **{cls.started_at}**), on outcome only — "
                 f"`{'`, `'.join(COMPARABLE_FIELDS)}`. Timings and row ids are excluded: "
                 "a run that took a second longer is not a different result.")
    lines.append("")

    current_names = set(cls.observations)
    previous_names = set(previous["fixtures"])
    differences: list[str] = []

    for name in sorted(current_names | previous_names):
        if name not in previous_names:
            differences.append(f"| `{name}` | *(not in the previous run)* | present |")
            continue
        if name not in current_names:
            differences.append(f"| `{name}` | present | *(not in this run)* |")
            continue
        before, after = previous["fixtures"][name], _comparable(cls, name)
        changed = {key for key in COMPARABLE_FIELDS if before.get(key) != after.get(key)}
        for key in sorted(changed):
            differences.append(f"| `{name}` — `{key}` | `{before.get(key)}` "
                               f"| `{after.get(key)}` |")

    if not differences:
        lines += [
            f"**All {len(current_names)} fixtures produced identical results in both runs.** "
            "That identity is the re-runnability evidence: the corpus is frozen, the "
            "workspace is reset to the same state before each fixture, and the pipeline "
            "returned the same verdict for every file twice.",
            "",
            "The two state-dependent fixtures are called out explicitly, because they are "
            "the ones a second run could plausibly have scored differently:",
            "",
            "| Fixture | Why it depends on state | Run 1 | Run 2 |",
            "|---|---|---|---|",
        ]
        for name, why in (
            ("valid/ok_20_duplicate_of_ok_01.csv",
             "only a duplicate while `ok_01`'s completed import is still present"),
            ("malformed/fix_12_ROW_VALIDATION_FAILED.csv",
             "duplicate rows are detected within the file, so it must not depend on state"),
        ):
            if name not in current_names:
                continue
            before, after = previous["fixtures"][name], _comparable(cls, name)
            lines.append(
                f"| `{name}` | {why} | {before['job_status']} / {before['dlq_code'] or '—'} "
                f"| {after['job_status']} / {after['dlq_code'] or '—'} |"
            )
        return lines + [""]

    return lines + [
        "**FINDING — the two runs disagree.** A frozen corpus run against a reset "
        "workspace must produce the same outcome every time; a difference means "
        "something in the path is not deterministic. It is recorded here rather than "
        "resolved by taking the later run.",
        "",
        "| Fixture / field | Previous run | This run |",
        "|---|---|---|",
        *differences,
        "",
    ]


def write_dlq_dump(observations: dict[str, kpi.Observation]) -> None:
    """The raw dead-letter rows this run produced, in fixture order.

    Assembled from what each fixture left behind rather than read from the table
    at the end: the reset between fixtures deletes the workspace's DLQ rows, so
    by the last file only one record would still be there to read.
    """
    DLQ_DUMP_PATH.parent.mkdir(parents=True, exist_ok=True)
    buffer = StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(("fixture", *DLQ_COLUMNS))
    for filename, observation in observations.items():
        for row in observation.dlq_rows:
            writer.writerow([filename] + [
                json.dumps(row.get(column), ensure_ascii=False)
                if isinstance(row.get(column), (dict, list)) else row.get(column, "")
                for column in DLQ_COLUMNS
            ])
    DLQ_DUMP_PATH.write_text(buffer.getvalue(), encoding="utf-8")


def _expected_cell(spec: dict) -> str:
    return (f"{spec['job_status']} / {spec['dlq_code'] or '—'} / "
            f"{spec['dataset'] or '—'} / {'ingests' if spec['ingests'] else 'stores nothing'}")


def _actual_cell(observed: kpi.Observation) -> str:
    if observed.harness_error:
        return f"**did not run** — {observed.harness_error}"
    landed = observed.rows_landed
    return (f"{observed.job_status} / {observed.dlq_code or '—'} / "
            f"{observed.dataset or '—'} / "
            f"{'ingests' if landed else 'stores nothing'} "
            f"({observed.rows_ok}/{observed.rows_total} rows, "
            f"{landed} table rows, {observed.seconds}s)")


def _spec_for(cls, filename: str) -> dict:
    return next(spec for spec in cls.specs if spec["filename"] == filename)


def _table(cls, group: str) -> list[str]:
    lines = ["| File | Expected — status / DLQ / dataset / storage | Actual | Verdict |",
             "|---|---|---|---|"]
    for spec in cls.specs:
        if spec["group"] != group:
            continue
        name = spec["filename"]
        observed = cls.observations.get(name)
        problems = cls.verdicts.get(name, ["not run"])
        if observed is None:
            lines.append(f"| `{name}` | {_expected_cell(spec)} | — | **not run** |")
            continue
        verdict = "pass" if not problems else "**FAIL** — " + "; ".join(problems)
        if name == KNOWN_FAILURE and not problems:
            verdict = "xfail (as documented)"
        lines.append(f"| `{name}` | {_expected_cell(spec)} | {_actual_cell(observed)} "
                     f"| {verdict} |")
    return lines


def render_results(cls, previous: dict | None = None) -> str:
    valid = [spec for spec in cls.specs if spec["group"] == "valid"]
    malformed = [spec for spec in cls.specs
                 if spec["group"] == "malformed" and spec["scored"]]

    kpi2 = sum(1 for spec in valid if not cls.verdicts.get(spec["filename"], ["x"]))

    captured = correct = clean = 0
    for spec in malformed:
        observed = cls.observations.get(spec["filename"])
        if observed is None or observed.harness_error:
            continue
        if observed.dlq_rows:
            captured += 1
            if observed.dlq_code == spec["dlq_code"]:
                correct += 1
        if not observed.rows_landed and not observed.staged_rows:
            clean += 1

    failures = [name for name, problems in cls.verdicts.items() if problems]

    # Reported as numbers rather than as prose, so neither can go stale.
    leaked = {name: observed.table_delta
              for name, observed in cls.observations.items()
              if not _spec_for(cls, name)["ingests"] and observed.rows_landed}
    staged = {name: observed.staged_rows
              for name, observed in cls.observations.items() if observed.staged_rows}
    unsettled = [name for name, observed in cls.observations.items()
                 if observed.job_status and observed.job_status not in kpi.TERMINAL_JOB_STATUSES]
    settled_late = {name: observed.settle_seconds
                    for name, observed in cls.observations.items() if observed.settle_seconds}

    def pct(part: int, whole: int) -> str:
        return f"{part}/{whole} ({100 * part / whole:.1f}%)"

    lines = [
        "# Ingestion KPI results",
        "",
        f"Produced by `python3 -m pytest tests/test_ingestion_kpi.py -v`, "
        f"started {cls.started_at}.",
        "",
        "Every row below is one of the 35 frozen fixtures in `tests/fixtures/`, uploaded to "
        "the cloud Supabase project the way `/imports` uploads a merchant's file and run "
        "through the real `buzzly_import_pipeline` DAG. Expected values are the declared "
        "intent in `tests/fixtures/MANIFEST.json`, written by reading the pipeline's rules "
        "and never by running it.",
        "",
        "## Summary",
        "",
        f"- **KPI-2 — Ingestion Success: {pct(kpi2, len(valid))}** valid files that met their "
        "declared outcome in full (status, DLQ record, resolved dataset and storage).",
        f"- **KPI-3 — DLQ Capture: {pct(captured, len(malformed))}** malformed files produced "
        f"a dead-letter record, **{pct(correct, len(malformed))}** with the correct error "
        f"code, **{pct(clean, len(malformed))}** with zero rows leaked into the fact tables "
        "and an empty staging buffer.",
        f"- `fix_13` is excluded from the KPI-3 denominator as a documented known failure "
        "(12 scored, not 13). See below.",
        f"- `aux/` files are excluded from both denominators: they parse but have no target "
        "table, and a file that succeeds while storing nothing is not an ingestion success "
        "(limitation L-2).",
        "",
        f"- **Rows leaked** into the fact tables from files that must store nothing: "
        + (f"**{leaked}**" if leaked else "**0**, across all six tables `promote_batch` "
           "writes plus `ingestion_staging`."),
        f"- **Jobs whose status never settled** within "
        f"{kpi.TERMINAL_JOB_GRACE_SECONDS}s: "
        + (f"**{unsettled}** — each scored FAIL and kept in its denominator." if unsettled
           else "**none**."),
        "- **Fixtures that went through the status-settle wait** (their DagRun reached a "
        "terminal state before `import_jobs.status` did): "
        + (", ".join(f"`{name}` ({seconds}s)" for name, seconds in settled_late.items())
           if settled_late
           else "**none** — every job was already terminal when its run ended."),
        "",
        f"{len(failures)} case(s) failed." if failures else "All cases passed.",
        "",
        "## Live data left untouched",
        "",
        "Every write and delete this suite makes is scoped to one workspace it creates "
        f"(`{kpi.TEST_TEAM_ID}`). These are the row counts *outside* that workspace, which "
        "are reserved for other measurements and must not move:",
        "",
        "| Table (rows outside the test workspace) | Expected | At suite start | At suite end |",
        "|---|---|---|---|",
    ]
    for table, expected in kpi.PROTECTED_BASELINE.items():
        lines.append(f"| `{table}` | {expected} | {cls.baseline_start.get(table, '—')} "
                     f"| {cls.baseline_end.get(table, '—')} |")

    lines += [
        "",
        "The reset between fixtures counts every filter before it deletes anything and "
        f"aborts the whole suite above {kpi.MAX_ROWS_PER_TABLE} rows in any one table — a "
        "hard stop between a scoping bug and live data, checked before the first delete "
        "rather than after the last.",
        "",
        "## KPI-2 — Ingestion Success (20 valid files)",
        "",
        "`ok_20` is the duplicate no-op: it succeeds for the merchant, writes a "
        "`DUPLICATE_BATCH` record for the engineer, and must store no second copy of "
        "`ok_01`'s rows. It runs immediately after `ok_01` with no reset in between, and "
        "the suite refuses to run it if that earlier import is not present.",
        "",
        *_table(cls, "valid"),
        "",
        "## KPI-3 — DLQ Capture (12 scored malformed files)",
        "",
        "Every file here must be refused with **zero** rows in the six tables `promote_batch` "
        "writes and an empty `ingestion_staging`. `fix_08` and `fix_09` end `succeeded` on "
        "purpose: nothing is wrong with an empty file, so the merchant is told so, and the "
        "DLQ still counts it.",
        "",
        *_table(cls, "malformed"),
        "",
        "### The known failure",
        "",
        "`fix_13` is a UTF-16 BOM with an odd byte count. `reader.py:76` calls "
        "`data.decode('utf-16')` outside any try block, so it raises a bare "
        "`UnicodeDecodeError` rather than `UnreadableFile`; `detect_format` catches only "
        "`UnreadableFile`, so the task crashes, `_write_dlq` is never reached and **no "
        "dead-letter row is written at all**. It is asserted against that actual behaviour "
        "and excluded from the KPI-3 denominator. The fix belongs to a separate, approved "
        "session, so that the write-up has a before and an after instead of an untested "
        "patch.",
        "",
        "`ENCODING_ERROR` and `UNKNOWN` are unreachable from a merchant's file — the first "
        "because `reader.ENCODINGS` ends in `latin-1`, which decodes every possible byte "
        "sequence, and the second because it is only written when the commit itself throws. "
        "Four of the seven codes are reachable from a malformed file, and that is a finding "
        "rather than a gap in the corpus; the reachability table is in "
        "`tests/fixtures/MANIFEST.md`.",
        "",
        "## Auxiliary — scored under neither KPI",
        "",
        *_table(cls, "aux"),
        "",
        "## Run history",
        "",
        "The first execution of this suite **aborted**, and it is recorded here rather "
        "than quietly replaced, because what stopped it is a result.",
        "",
        "The manifest's ordering rule is that `ok_20` runs *immediately* after `ok_01` "
        "with no reset in between. The first run took the order the corpus is **listed** "
        "in, where `ok_20` sits at the end of the valid group — so eighteen resets ran "
        "between the pair, each deleting the workspace's `import_jobs`, including the "
        "completed import that is the only reason `ok_20` is a duplicate at all. The "
        "order guard (open item A) caught it: `ok_01`–`ok_19` had all passed, and the "
        "suite stopped at `ok_20` rather than ingest it as a fresh file and score a "
        "KPI-2 pass for a reason with nothing to do with duplicate detection. No "
        "`RESULTS.md` was written, by design — a run that aborts in `setUpClass` never "
        "reaches the code that writes one, so there is no partial results file carrying "
        "a flattering number.",
        "",
        "That run is **not** comparable with the ones below: it executed a different "
        "order and covered 19 of 35 fixtures. Re-runnability is evidenced by two "
        "*completed* runs under the corrected ordering, compared next.",
        "",
        *render_comparison(cls, previous),
        "## What `ingestion_staging` holds after a refusal",
        "",
        "Step 0's inventory recorded that a refused file stages nothing, and that is "
        "**correct**. `stage_rows` has exactly one caller, `ingest_ad_performance`, and "
        "`upsert_target` reaches it only past two guards "
        "(`buzzly_import_pipeline.py:744-754`): a short-circuited or empty ledger returns "
        "at the first, and any quarantined row returns at the second. Every refusal shape "
        "in this corpus hits one of them, or fails earlier still in `detect_format` / "
        "`parse` and never runs `upsert_target` at all. Measured here: "
        + (f"**{staged}**" if staged else
           "**0 staged rows for every one of the 35 fixtures**, asserted per fixture.")
        + "",
        "",
        "So the earlier concern resolves as **(b) — refused files do not leave orphaned "
        "rows, and the change was defensive**. But one half of it was not merely "
        "defensive, and it is worth stating plainly:",
        "",
        "- **The assertion would have passed vacuously.** `ingestion_batches` rows are "
        "written *by* `promote_batch`, so a batch that never promoted has none. Scoping "
        "the check as `ingestion_staging WHERE batch_id IN (SELECT batch_id FROM "
        "ingestion_batches WHERE team_id = …)` returns the empty set for every refused "
        "file — it would have reported a clean buffer without ever looking at one. This "
        "suite derives the batch id from the job id instead (the same `uuid5` the "
        "pipeline uses), and proves that derivation against a genuinely promoted batch "
        "once per run, so an orphaned buffer would actually be seen.",
        "- **The reset SQL had the same blind spot, and there its trigger is real.** A "
        "buffer can survive a run that dies between `stage_rows` returning and "
        "`promote_batch` committing — a killed container, an OOM. `promote_batch` drops "
        "the buffer inside its own transaction and `upsert_target`'s except clause calls "
        "`discard_staging_batch`; neither runs if the process disappears between them, "
        "and nothing else cleans up. No fixture produces that, so it is recorded as a gap "
        "in the reset scoping rather than as a finding about refusals.",
        "",
        "## Harness deviations from the production path",
        "",
        "Everything this suite does differently from a merchant uploading a file, and why. "
        "None of them changes what the pipeline does to a file; they are listed so a "
        "reader can check that for themselves.",
        "",
        "| Deviation | Why | Effect on the measurement |",
        "|---|---|---|",
        "| The harness claims the job itself (`pending` -> `queued`) between inserting the "
        "row and triggering the DAG | Both production trigger paths already do this — the "
        "`airflow-trigger` Edge Function and `buzzly_import_sensor` each claim before they "
        "trigger. Skipping it would leave the row visible to the sensor for as long as the "
        "DagRun took to start, and **two runs would process one file** | None. It is "
        "faithfulness to the upload contract, not a shortcut around it |",
        "| The DAG is triggered directly rather than through the webhook or the sensor | "
        "The webhook is inert in local development (a Supabase Edge Function cannot reach "
        "an Airflow on `localhost`), and the sensor polls every two minutes | Changes when "
        "a run starts, never what it does |",
        "| The test workspace is created by the harness, borrowing `owner_id` from an "
        "existing workspace | `workspaces.owner_id` is NOT NULL and references a real auth "
        "user; a test harness has no business minting users | None. The borrowed value only "
        "satisfies a foreign key — nothing else of that owner's is read or written |",
        f"| After the DagRun reaches a terminal state, the harness waits up to "
        f"{kpi.TERMINAL_JOB_GRACE_SECONDS}s for `import_jobs.status` to settle | **A "
        "measurement artifact, not a pipeline defect.** A DagRun reaching `failed` is not "
        "the moment the job reaches its terminal status: when a task crashes without "
        "writing one itself, the status comes from the DAG-level `on_failure_callback`, "
        "which Airflow runs *after* it marks the run failed — about five seconds on this "
        "instance. Reading `import_jobs` the instant the run ended caught `fix_13` still at "
        "`running` | A fixture whose status has not settled inside the grace is scored "
        "**FAIL** and **stays in its denominator**. It is never skipped and never excluded, "
        "because an inconclusive fixture dropping out would inflate the KPI |",
        "",
        "## Evidence",
        "",
        "- `tests/evidence/dlq_dump.csv` — every dead-letter row this run produced, "
        "assembled per fixture (the reset between fixtures clears the table, so the dump is "
        "collected as the run goes rather than read at the end).",
        "- `tests/fixtures/MANIFEST.md` — the declared spec, its per-file reasoning, the "
        "error-code reachability analysis and limitations L-1 to L-3.",
        "",
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    unittest.main(verbosity=2)
