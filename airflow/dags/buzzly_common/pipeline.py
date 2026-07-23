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

import os
import re
import shutil
from pathlib import Path
from typing import Any

# The ordered stages between `verify_artifact` and `finalize`. Steps 5-7 of the
# build plan fill these in; step 4 wired them up as pass-throughs so the status
# and row-count plumbing could be proven before any parser existed.
STAGES: tuple[str, ...] = (
    "hash_dedupe",
    "detect_format",
    "parse",
    "clean_thai",
    "validate",
    "quarantine_bad_rows",
    "upsert_target",
)

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


def short_circuit(name: str, ledger: dict, reason: str) -> dict:
    """Stop the pipeline early without failing the run.

    Every later stage becomes a pass-through and `finalize` still writes a
    terminal status — the outcome is a success that ingested nothing, which is
    the truth about a duplicate upload.
    """
    return run_stage(name, {**ledger, "skipped": None}, note=f"short-circuit — {reason}",
                     skipped=reason)


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

    `partial` exists so a file with a handful of bad rows still delivers the
    good ones — the persona is a merchant with messy exports, and an
    all-or-nothing import would reject almost every real file they own.
    """
    if ledger.get("skipped"):
        return "succeeded", f"Nothing to ingest — {ledger['skipped']}"

    total, ok, quarantined = (ledger.get(key, 0) for key in COUNTERS)
    if total == 0:
        return "succeeded", "No data rows were found in this file."
    if quarantined == 0:
        return "succeeded", None
    if ok == 0:
        return "failed", f"Every row was rejected ({quarantined} of {total}); nothing was imported."
    return "partial", f"Imported {ok} of {total} rows; {quarantined} could not be read."


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


def clear_staging(run_id: str) -> bool:
    """Remove a run's staging directory. True if there was one."""
    directory = staging_dir(run_id)
    if not directory.is_dir():
        return False
    shutil.rmtree(directory, ignore_errors=True)
    return True
