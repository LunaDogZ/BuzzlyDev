"""Why a file was refused — the dead-letter queue's vocabulary.

``import_row_errors`` answers the merchant's question ("which of my rows are
wrong, and what do I fix"). This module answers the engineer's ("what kind of
file are we losing, and how often"), in exactly seven words so the answers can
be counted.

The seven codes
---------------
Six come from the sprint brief. ``ROW_VALIDATION_FAILED`` is the seventh, added
because none of the six means *"every cell was read perfectly and the rows broke
the rules"* — a negative spend, more clicks than impressions, a row repeated
inside the file. Filing those under ``TYPE_COERCION_FAILED`` would be a lying
diagnostic: it names a defect in our reader when the defect is in their data,
and it would corrupt the one measurement that is hard to game. Landing in the
queue is easy; naming the right reason is the graded part.

The line between the two row-level codes is therefore *who failed*:

* ``TYPE_COERCION_FAILED`` — we could not turn the merchant's cells into values.
  ``unreadable_date``, ``unreadable_number``, ``short_row``.
* ``ROW_VALIDATION_FAILED`` — we read them fine and the rules refused the row.
  ``missing_required``, ``negative_value``, ``value_out_of_range``,
  ``clicks_exceed_impressions``,
  ``duplicate_row``.

``UNKNOWN`` is deliberately never raised by any classification below; it exists
so an unclassified fault has somewhere to go, and a non-zero count of it in the
harness is a defect report about this module rather than about the file.

Stdlib only, like its neighbours in ``buzzly_common`` — it is unit-tested with
no Airflow, no network and no database.
"""

from __future__ import annotations

from typing import Any, Iterable

SCHEMA_MISMATCH = "SCHEMA_MISMATCH"
TYPE_COERCION_FAILED = "TYPE_COERCION_FAILED"
ENCODING_ERROR = "ENCODING_ERROR"
EMPTY_PAYLOAD = "EMPTY_PAYLOAD"
DUPLICATE_BATCH = "DUPLICATE_BATCH"
ROW_VALIDATION_FAILED = "ROW_VALIDATION_FAILED"
UNKNOWN = "UNKNOWN"

# Must match the CHECK constraint on public.ingestion_dlq.error_code exactly.
# `airflow/tests/test_dlq.py` reads the migration and fails if they drift — a
# code Python can emit but the database rejects would turn a refusal into a
# *second* failure, and the DLQ row that explains the first would be the thing
# that goes missing.
ERROR_CODES: tuple[str, ...] = (
    SCHEMA_MISMATCH,
    TYPE_COERCION_FAILED,
    ENCODING_ERROR,
    EMPTY_PAYLOAD,
    DUPLICATE_BATCH,
    ROW_VALIDATION_FAILED,
    UNKNOWN,
)

# Row-level reason codes (from `records.py` and `validate.py`) to the file-level
# code they roll up into. Every code either side of this map is exhaustive as of
# this sprint; a new row-level code that is not listed here rolls up as a rule
# failure, which is the statement that stays true either way (see `_roll_up`).
ROW_CODE_GROUPS: dict[str, str] = {
    # We could not read the cell.
    "unreadable_date": TYPE_COERCION_FAILED,
    "unreadable_number": TYPE_COERCION_FAILED,
    "short_row": TYPE_COERCION_FAILED,
    # We read it, and a rule refused the row.
    "missing_required": ROW_VALIDATION_FAILED,
    "negative_value": ROW_VALIDATION_FAILED,
    "clicks_exceed_impressions": ROW_VALIDATION_FAILED,
    "duplicate_row": ROW_VALIDATION_FAILED,
    "value_out_of_range": ROW_VALIDATION_FAILED,
}

# Substrings of `UnreadableFile` messages that pin a file-level fault to a code.
# Matching on the message rather than on an exception subclass is a compromise:
# `reader.UnreadableFile` is one class raised from seven places, and giving it
# subclasses would be the cleaner fix. Doing that here would mean editing the
# measured research artifact mid-sprint, so the mapping lives outside it and
# `test_dlq.py` asserts every message `reader.py` can raise is matched — which
# is what stops this list rotting silently.
_MESSAGE_CODES: tuple[tuple[str, str], ...] = (
    ("is empty (0 bytes)", EMPTY_PAYLOAD),
    ("contains no rows", EMPTY_PAYLOAD),
    ("no column headings", EMPTY_PAYLOAD),
    ("text encoding could not be determined", ENCODING_ERROR),
    # A format we will not read is a mismatch between the file's shape and the
    # shapes we accept — the same statement SCHEMA_MISMATCH makes about columns,
    # one level up.
    ("legacy Excel", SCHEMA_MISMATCH),
    ("could not be opened", SCHEMA_MISMATCH),
    ("cannot read .xlsx files", SCHEMA_MISMATCH),
)


def classify_unreadable(message: str) -> str:
    """File-level code for a `reader.UnreadableFile` message."""
    text = str(message or "")
    for needle, code in _MESSAGE_CODES:
        if needle in text:
            return code
    return UNKNOWN


def classify_exception(exc: BaseException) -> str:
    """File-level code for whatever a parse or validate stage raised.

    The DAG refuses the file with this code instead of crashing, so every file
    ends committed or quarantined. Anything this does not recognise is
    ``UNKNOWN`` — by the module docstring, a defect report about our code.
    """
    if isinstance(exc, UnicodeError):
        return ENCODING_ERROR
    # Duck-typed rather than imported: `reader` is the measured artifact and this
    # module stays importable without it.
    if type(exc).__name__ == "UnreadableFile":
        return classify_unreadable(str(exc))
    return UNKNOWN


def _roll_up(reason_counts: dict[str, int]) -> str:
    """The one code that best describes a set of row-level rejections.

    Majority wins, and a tie goes to ``ROW_VALIDATION_FAILED``. That asymmetry
    is on purpose: a coercion failure *is* a validation failure in the broad
    sense, so the rule code is never false about a mixed file, while
    ``TYPE_COERCION_FAILED`` would be false about every rule-broken row in it.
    Ties should be rare; being wrong in the direction that still reads true is
    the cheaper mistake.
    """
    totals: dict[str, int] = {}
    for code, count in reason_counts.items():
        group = ROW_CODE_GROUPS.get(code, ROW_VALIDATION_FAILED)
        totals[group] = totals.get(group, 0) + count

    if not totals:
        return ROW_VALIDATION_FAILED
    best = max(totals.values())
    winners = [group for group, count in totals.items() if count == best]
    return ROW_VALIDATION_FAILED if ROW_VALIDATION_FAILED in winners else winners[0]


def classify_rejections(rejected: Iterable[dict]) -> str:
    """File-level code for a set of rejected rows from ``validate_records``.

    Each rejected row carries every reason it failed, not just the first, so a
    row counts once per distinct problem — the same weighting the merchant's
    error report shows.
    """
    counts: dict[str, int] = {}
    for row in rejected:
        for problem in row.get("problems", ()):
            code = problem.get("error_code")
            if code:
                counts[code] = counts.get(code, 0) + 1
    return _roll_up(counts)


def reason_summary(rejected: Iterable[dict]) -> dict[str, int]:
    """Per-reason counts, for the DLQ record's ``detail``."""
    counts: dict[str, int] = {}
    for row in rejected:
        for problem in row.get("problems", ()):
            code = problem.get("error_code")
            if code:
                counts[code] = counts.get(code, 0) + 1
    return counts


# How many offending rows the DLQ record quotes. The full set is in
# `import_row_errors` and in the merchant's downloadable CSV; this is a sample
# an engineer can read at a glance, not a second copy of the file.
SAMPLE_ROWS = 5


def build_record(
    *,
    job: dict[str, Any],
    error_code: str,
    error_message: str,
    stage: str | None = None,
    batch_id: str | None = None,
    rows_attempted: int = 0,
    rows_rejected: int = 0,
    rejected: Iterable[dict] | None = None,
    dag_run_id: str | None = None,
) -> dict[str, Any]:
    """One `ingestion_dlq` row.

    The identifying details are copied out of the job rather than left to a
    join: the FK is ``ON DELETE SET NULL`` so that a merchant deleting an import
    from their history cannot erase the engineering record of why it failed, and
    a record that has lost its filename and hash is not much of a record.
    """
    if error_code not in ERROR_CODES:
        # A code the CHECK constraint would reject means the DLQ write fails,
        # i.e. the one row explaining a refusal is the row that goes missing.
        # Fail here, where the test suite can see it.
        raise ValueError(f"{error_code!r} is not a DLQ error code — expected one of {ERROR_CODES}")

    rows = list(rejected or ())
    detail: dict[str, Any] = {}
    if rows:
        detail["by_reason"] = reason_summary(rows)
        detail["sample_rows"] = [
            {
                "row_number": row.get("row_number"),
                "reasons": [problem.get("error_code") for problem in row.get("problems", ())],
            }
            for row in rows[:SAMPLE_ROWS]
        ]
        if len(rows) > SAMPLE_ROWS:
            detail["sample_truncated_from"] = len(rows)

    return {
        "import_job_id": job.get("import_job_id"),
        "team_id": job.get("team_id"),
        "batch_id": batch_id,
        "original_filename": job.get("original_filename"),
        "file_hash": job.get("file_hash"),
        "platform": job.get("platform"),
        "error_code": error_code,
        "error_message": (error_message or "")[:2000],
        "stage": stage,
        "rows_attempted": rows_attempted,
        "rows_rejected": rows_rejected,
        "detail": detail or None,
        "dag_run_id": dag_run_id,
    }
