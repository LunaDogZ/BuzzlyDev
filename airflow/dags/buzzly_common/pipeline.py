"""The stage contract for ``buzzly_import_pipeline`` — what flows between tasks.

Every stage between ``verify_artifact`` and ``finalize`` takes a **ledger** and
returns a new one. The ledger is the single value that crosses task boundaries,
which puts three constraints on it, all of them deliberate:

* **Small.** It travels through XCom, i.e. the Airflow metadata database. It
  carries row *counts* and a *path*, never file contents and never parsed rows.
  Bulk data is staged on disk (see the staging helpers below) and referenced.
* **JSON-serialisable.** Plain dicts and lists, no dataclasses — Airflow 3
  serialises XCom as JSON, and a value that survives a round-trip unchanged is
  one less thing to debug at 2am.
* **Immutable in place.** ``run_stage`` copies rather than mutates. A task that
  edits the dict it was handed is editing a value Airflow may hand to a
  *retry* of a sibling task, and the resulting bugs are invisible.

The trail
---------
Each stage appends one entry to ``ledger["trail"]``, so a finished run carries
its own audit log: which stages ran, what each one did, and how the row counts
moved. Timing is not recorded here on purpose — Airflow already measures task
duration, and one stage per task is exactly why the stages are separate tasks.
That per-stage duration is the throughput measurement the research write-up
needs, taken for free.

Short-circuiting
----------------
A stage that finds there is nothing to do (currently only ``hash_dedupe``, on a
re-upload of an identical file) calls ``short_circuit`` instead of raising
``AirflowSkipException`` or using ``ShortCircuitOperator``. Both of those mark
downstream tasks *skipped* — including ``finalize``, which is what writes the
job's terminal status. A skipped ``finalize`` is not a failure either, so the
DAG-level ``on_failure_callback`` would not fire, and the job would sit at
``running`` forever with the merchant watching a spinner. Flowing a flagged
ledger through instead costs a one-line guard per stage and guarantees that
whatever happens, exactly one task writes the outcome.

This module deliberately imports nothing from Airflow or ``requests`` so it can
be unit-tested with plain ``pytest`` — see ``airflow/tests/test_pipeline.py``.
"""

from __future__ import annotations

import json
import os
import re
import shutil
from pathlib import Path
from typing import Any

# The ordered stages between `verify_artifact` and `finalize`. A stage may
# decline to do its work (nothing to dedupe, no rows rejected, a short-circuited
# ledger) but the sequence itself never varies — one path through the file means
# one place to look when a number is wrong.
STAGES: tuple[str, ...] = (
    "hash_dedupe",
    "detect_format",
    "parse",
    "clean_thai",
    "validate",
    "quarantine_bad_rows",
    "upsert_target",
)

# Every task that reports progress to the merchant, in the order they run —
# the two that bracket the stages proper are included because they are where a
# job spends its first seconds and where it can visibly fail (a missing object,
# a hash mismatch), and "0 of 9" is a worse answer than "checking the file".
#
# This tuple is the authority for the progress bar on /imports. Its TypeScript
# mirror is `IMPORT_STAGES` in `src/hooks/useImportJobs.tsx`, and
# `airflow/tests/test_stage_contract.py` fails if the two drift — a renamed
# stage that only the DAG knows about would render as a blank step.
PROGRESS_STAGES: tuple[str, ...] = ("resolve_job", "verify_artifact", *STAGES, "finalize")

COUNTERS: tuple[str, ...] = ("rows_total", "rows_ok", "rows_quarantined")

# Where downloaded uploads live while a run is in flight. Under LocalExecutor
# every task of a run is a subprocess of the same scheduler container, so a
# local path is shared storage. Anything that reads it must be able to
# re-download instead (see `read_staged` returning None) — a container restart
# between two tasks is a normal event, not a fault.
STAGING_ROOT = Path(os.environ.get("BUZZLY_IMPORT_STAGING_DIR", "/tmp/buzzly-imports"))

_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")


# ── ledger ────────────────────────────────────────────────────────────────────


def new_ledger(job: dict[str, Any], *, staging_path: str, size_bytes: int, sha256: str) -> dict:
    """Seed a ledger from a resolved job and its verified artifact."""
    return {
        "import_job_id": job["import_job_id"],
        "platform": job["platform"],
        "staging_path": staging_path,
        "size_bytes": size_bytes,
        "sha256": sha256,
        # Filled by detect_format (step 5): "csv" | "xlsx".
        "file_format": None,
        "encoding": None,
        "rows_total": 0,
        "rows_ok": 0,
        "rows_quarantined": 0,
        # Set by quarantine_bad_rows (step 6) once it writes the error CSV.
        "error_report_path": None,
        # Canonical fields the header mapping could not find, from clean_thai.
        # Carried because it changes the *reason* a file is refused: when a
        # required column is absent every row fails for the same reason, and the
        # honest dead-letter code is "these headers are not a shape we can
        # store", not "your rows broke the rules".
        "missing_required": [],
        # Non-null means "stop working, finalize what you have". See module docstring.
        "skipped": None,
        "trail": [],
    }


def run_stage(name: str, ledger: dict, *, todo: str | None = None, note: str | None = None,
              **updates: Any) -> dict:
    """Return a new ledger with this stage's result recorded.

    `updates` may only touch keys the ledger already has; a typo would
    otherwise add a field nobody reads and silently lose the value.
    """
    if name not in STAGES:
        raise ValueError(f"{name!r} is not a pipeline stage — expected one of {STAGES}")

    unknown = set(updates) - set(ledger)
    if unknown:
        raise KeyError(f"{name} tried to set unknown ledger field(s): {sorted(unknown)}")

    updated = dict(ledger)
    if ledger.get("skipped"):
        note = f"not run — {ledger['skipped']}"
    else:
        updated.update(updates)
        if note is None:
            note = f"TODO {todo}" if todo else "ok"

    updated["trail"] = [
        *ledger.get("trail", []),
        {"stage": name, "note": note, **{key: updated[key] for key in COUNTERS}},
    ]
    return updated


def short_circuit(name: str, ledger: dict, reason: str, **updates: Any) -> dict:
    """Stop the pipeline early without failing the run.

    Every later stage becomes a pass-through and `finalize` still writes a
    terminal status — the outcome is a success that ingested nothing, which is
    the truth about a duplicate upload.

    `updates` exists for a stage that short-circuits *after* rows have been
    counted: the counters must be zeroed in the same breath, or `finalize`'s
    balance check fails on rows that were read but deliberately not ingested.
    Reporting them as ingested would be worse than the failure — `hash_dedupe`
    treats "succeeded with rows_ok > 0" as proof the data is already here, so a
    non-zero count on a file we did not store would refuse the merchant's
    re-upload later, forever.
    """
    return run_stage(name, {**ledger, "skipped": None}, note=f"short-circuit — {reason}",
                     skipped=reason, **updates)


def assert_consistent(ledger: dict) -> None:
    """Every row is either ingested or quarantined. Raise if a stage lost some.

    Called by `finalize` before the counts reach the merchant's screen. A
    mismatch is a bug in a stage, and failing loudly beats reporting numbers
    that do not add up — the DAG failure callback turns it into a visible
    `failed` job rather than a wrong `succeeded` one.
    """
    counts = {key: ledger.get(key, 0) for key in COUNTERS}
    negative = [key for key, value in counts.items() if not isinstance(value, int) or value < 0]
    if negative:
        raise ValueError(f"Row counts must be non-negative integers; got {counts} (bad: {negative})")

    total, ok, quarantined = (counts[key] for key in COUNTERS)
    if ok + quarantined != total:
        raise ValueError(
            f"Row accounting does not balance for job {ledger.get('import_job_id')}: "
            f"rows_ok({ok}) + rows_quarantined({quarantined}) != rows_total({total}). "
            f"Trail: {ledger.get('trail')}"
        )


def terminal_status(ledger: dict) -> tuple[str, str | None]:
    """Decide the job's final status and the message the merchant sees.

    **A file commits every valid row or it commits nothing.** There is no
    `partial` outcome: one unreadable row refuses the whole file.

    This reverses a documented product decision, knowingly. The persona is a
    merchant with messy exports, and `partial` existed precisely so that a
    handful of bad rows still delivered the good ones — an all-or-nothing import
    rejects a lot of real files. It was traded for a property the research needs
    and partial delivery cannot give: every ingested figure belongs to exactly
    one file that was accepted whole, so "the pipeline's output reconciles
    against the source" is a claim about a whole file rather than about whatever
    subset of it happened to pass. Row-level quarantine belongs in the write-up's
    limitations, as the thing production would need next.

    What survives is the *diagnosis*: every rejected row still gets its reason in
    `import_row_errors` and in the downloadable CSV. Under all-or-nothing that
    report stops being a nicety and becomes the only thing the merchant gets
    back, which is why `quarantine_bad_rows` runs even though nothing will be
    stored.
    """
    if ledger.get("skipped"):
        return "succeeded", f"Nothing to ingest — {ledger['skipped']}"

    total, _ok, quarantined = (ledger.get(key, 0) for key in COUNTERS)
    if total == 0:
        # Nothing to refuse and nothing to store. Not the merchant's mistake and
        # not a failure to them — but the DLQ still records EMPTY_PAYLOAD, so
        # the two views disagree here on purpose.
        return "succeeded", "No data rows were found in this file."
    if quarantined == 0:
        return "succeeded", None
    return "failed", (
        f"This file was not imported. {quarantined} of {total} rows could not be read, "
        "and we import a file only in full — download the error report, fix those "
        "rows and upload the file again."
    )


def reported_counts(ledger: dict) -> dict[str, int]:
    """The row counts to store on the job, as opposed to the ones in the ledger.

    The ledger counts what *validation* decided; these count what the merchant
    actually got. On a refused file the two diverge in one column: the ledger
    says "3 of 10 rows were fine", and the job row must say **0 rows imported**,
    because none of them were. Reporting the 3 would describe an import that did
    not happen — and `hash_dedupe` reads `rows_ok` as evidence that data is
    already present, so a non-zero count on a file we refused could silently
    reject the merchant's re-upload of it later.

    ``rows_quarantined`` deliberately stays at the *actual* number rejected
    rather than becoming the whole file. It is what /imports counts in "see the
    N rejected rows", and it has to equal the number of rows in the error report
    they then open. Which means the three stored counters no longer sum on a
    refused file — 10 total, 0 imported, 3 rejected — and that is the honest
    reading of all-or-nothing rather than an accounting slip. The
    sum-to-total invariant belongs to the ledger, where `assert_consistent`
    still enforces it, and it was a property of partial delivery.
    """
    total, ok, quarantined = (ledger.get(key, 0) for key in COUNTERS)
    if ledger.get("skipped") or not quarantined:
        return {"rows_total": total, "rows_ok": ok, "rows_quarantined": quarantined}
    return {"rows_total": total, "rows_ok": 0, "rows_quarantined": quarantined}


# ── staging ───────────────────────────────────────────────────────────────────


def _safe(segment: str) -> str:
    """Make a run id or filename safe to use as one path segment."""
    cleaned = _UNSAFE.sub("_", segment).strip("._") or "unnamed"
    return cleaned[:120]


def staging_dir(run_id: str) -> Path:
    """Per-run directory. Keyed by run id so concurrent runs cannot collide."""
    return STAGING_ROOT / _safe(run_id)


def staging_path(run_id: str, filename: str) -> Path:
    return staging_dir(run_id) / _safe(filename)


def write_staged(path: str | Path, data: bytes) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return target


def read_staged(path: str | Path) -> bytes | None:
    """Read a staged file, or None if it is gone.

    None is an expected answer, not an error: the caller re-downloads. Retries
    and container restarts both land here.
    """
    target = Path(path)
    return target.read_bytes() if target.is_file() else None


def intermediate_path(run_id: str, name: str) -> Path:
    """Path for a stage's output within a run's staging directory.

    Parsed rows are far too big for XCom — a 3,458-row Shopee report is
    megabytes of JSON, and XCom is the metadata database. Stages therefore hand
    bulk data to each other through files here, keyed by run id so concurrent
    runs cannot collide, and the ledger carries only counts.

    The name is derived rather than carried in the ledger so that a stage can
    always find its predecessor's output without the ledger growing a field per
    stage — and so a retry recomputes exactly the same path.
    """
    return staging_dir(run_id) / f"_{_safe(name)}.json"


def write_intermediate(run_id: str, name: str, payload: Any) -> Path:
    """Serialise a stage's output. Values must already be JSON-safe."""
    target = intermediate_path(run_id, name)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return target


def read_intermediate(run_id: str, name: str) -> Any | None:
    """Read a stage's output, or None if staging was cleared under us.

    None is an expected answer for the same reason `read_staged` returns one:
    a retry may land on a container that never held the file. The caller decides
    whether to recompute or fail.
    """
    target = intermediate_path(run_id, name)
    if not target.is_file():
        return None
    return json.loads(target.read_text(encoding="utf-8"))


def clear_staging(run_id: str) -> bool:
    """Remove a run's staging directory. True if there was one."""
    directory = staging_dir(run_id)
    if not directory.is_dir():
        return False
    shutil.rmtree(directory, ignore_errors=True)
    return True
