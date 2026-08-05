"""The answer key, and how a parse is scored against it.

``fixtures/imports/ground-truth.json`` is written by the same generator that
writes the CSVs, from the values it holds *before* serialising them into
Buddhist-era dates and ``฿``. So the key is independent of every parser being
measured — which is the only way an accuracy figure means anything.

Four outcomes per cell, not two
-------------------------------
Scoring cells as merely right or wrong hides the error that matters most. A
parser that reads a blank conversions cell as ``0`` and one that cannot read it
at all are both "not correct", and they are not remotely the same event:

``correct``     the value matches the key.
``missing``     the key has a value, the parser produced nothing. Data lost —
                visible, recoverable, and the merchant can be told.
``fabricated``  the key says the cell was empty, the parser produced a value.
                **The dangerous one.** Nothing looks wrong; a number that was
                never in the merchant's file is now in their dashboard.
``wrong``       both have a value and they differ.

Money is compared as ``Decimal``. Comparing it as float would make the
comparison approximate, and a harness that reports 99.97% because of binary
rounding has measured its own arithmetic rather than the parser.
"""

from __future__ import annotations

import datetime as dt
import json
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from buzzly_common.records import field_kind

TRUTH_FILENAME = "ground-truth.json"

# Outcome names, in the order a report should read them.
OUTCOMES = ("correct", "missing", "fabricated", "wrong")


def fixtures_root(start: Path | None = None) -> Path:
    """Locate ``fixtures/imports`` on the host or inside the Airflow image.

    The container mounts it read-only at a fixed path; on the host it sits
    beside the repo. Both are checked so the harness runs in either place
    without a flag.
    """
    mounted = Path("/opt/airflow/fixtures/imports")
    if (mounted / TRUTH_FILENAME).is_file():
        return mounted

    here = (start or Path(__file__)).resolve()
    for parent in here.parents:
        candidate = parent / "fixtures" / "imports"
        if (candidate / TRUTH_FILENAME).is_file():
            return candidate
    raise FileNotFoundError(
        f"Could not find {TRUTH_FILENAME}. Run `node fixtures/imports/generate.mjs`."
    )


def load_truth(root: Path | None = None) -> dict:
    root = root or fixtures_root()
    return json.loads((root / TRUTH_FILENAME).read_text(encoding="utf-8"))


# ── comparison ────────────────────────────────────────────────────────────────


def _canonical(field: str, value: Any) -> Any:
    """Reduce a parsed value to a form both implementations can be judged in.

    The pipeline yields ``Decimal`` and ``datetime.date``; the baseline yields
    ``float`` and ``date``; the key holds strings. All three collapse here, so
    the comparison tests the *value* rather than which type happened to carry
    it. A float becomes a Decimal via ``str`` — never ``Decimal(float)``, which
    would drag in the binary expansion this whole module exists to avoid.
    """
    if value is None or value == "":
        return None

    kind = field_kind(field)
    if kind == "date":
        if isinstance(value, (dt.date, dt.datetime)):
            return value.isoformat()[:10]
        return str(value).strip()[:10]
    if kind == "int":
        try:
            return int(value)
        except (TypeError, ValueError):
            return str(value)
    if kind == "decimal":
        try:
            return Decimal(str(value))
        except (InvalidOperation, TypeError, ValueError):
            return str(value)
    return " ".join(str(value).split())


def score_cell(field: str, actual: Any, expected: Any) -> str:
    """One of :data:`OUTCOMES` for a single field of a single row."""
    got, want = _canonical(field, actual), _canonical(field, expected)
    if want is None:
        return "correct" if got is None else "fabricated"
    if got is None:
        return "missing"
    return "correct" if got == want else "wrong"


def _blank_tally() -> dict[str, int]:
    return {outcome: 0 for outcome in OUTCOMES}


def score_rows(rows_by_number: dict[int, dict], truth_rows: list[dict]) -> dict:
    """Score parsed rows against the key, per cell and per field.

    ``rows_by_number`` maps the file's own 1-based line number to that row's
    parsed ``values``. Keying on the line number rather than on position is what
    lets a parser that dropped rows still be scored on the rows it did read:
    every cell of a dropped row counts as ``missing`` rather than shifting every
    later row against the wrong key and reporting nonsense.
    """
    totals = _blank_tally()
    by_field: dict[str, dict[str, int]] = {}
    rows_matched = 0
    blank_agreements = 0
    examples: list[dict] = []

    for entry in truth_rows:
        values = rows_by_number.get(entry["row_number"])
        if values is not None:
            rows_matched += 1
        for field, expected in entry["values"].items():
            actual = (values or {}).get(field)
            outcome = score_cell(field, actual, expected)
            totals[outcome] += 1
            # "Correct" on a cell the key says was empty is agreement about an
            # absence, not data recovered. Counted apart so a parser that read
            # nothing at all cannot report a non-zero accuracy without the
            # report saying where it came from.
            if outcome == "correct" and _canonical(field, expected) is None:
                blank_agreements += 1
            by_field.setdefault(field, _blank_tally())[outcome] += 1
            if outcome in ("wrong", "fabricated") and len(examples) < 10:
                examples.append({
                    "row_number": entry["row_number"], "field": field,
                    "expected": expected, "actual": str(actual), "outcome": outcome,
                })

    cells = sum(totals.values())
    values_recovered = totals["correct"] - blank_agreements
    populated = cells - blank_agreements - totals["fabricated"]
    return {
        "rows_expected": len(truth_rows),
        "rows_matched": rows_matched,
        "cells": cells,
        **totals,
        "blank_agreements": blank_agreements,
        "accuracy": rate(totals["correct"], cells),
        # Accuracy over the cells that actually hold a value — the figure to
        # quote when comparing two parsers, because it cannot be inflated by a
        # file's empty cells.
        "value_accuracy": rate(values_recovered, populated),
        "by_field": by_field,
        "examples": examples,
    }


def rate(part: int, whole: int) -> float:
    """A ratio that reports 0.0 rather than raising when there is nothing to divide."""
    return round(part / whole, 6) if whole else 0.0
