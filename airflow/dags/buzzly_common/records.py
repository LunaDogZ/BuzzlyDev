"""Raw cells -> typed canonical records.

Where :mod:`buzzly_common.mapping` decides *which* column a heading is and
:mod:`buzzly_common.thai` decides what a cell *says*, this module puts the two
together and produces the record the rest of the pipeline works with.

Failure is per-cell, not per-file
---------------------------------
A cell that will not parse records an **issue** on its row and leaves the field
``None``; it never raises. That is what lets a 3,000-row Shopee export with
eleven bad rows deliver 2,989 good ones. The issues travel with the record so
:mod:`buzzly_common.validate` can decide, one row at a time, whether the damage
is disqualifying — a missing ``cost_per_conversion`` is not, a missing date is.

The distinction that matters is *absent* versus *unreadable*. An empty cell is
the merchant saying "no value" and produces no issue; a cell containing
``31/02/2569`` or ``N/A`` in a numeric column is something they meant to be
data, and is reported. Treating those the same would either flood the error
report with empty optional cells or silently swallow real corruption.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Any

from buzzly_common.mapping import DATASETS
from buzzly_common.reader import iter_cells
from buzzly_common.thai import (
    is_blank,
    normalize_text,
    parse_decimal,
    parse_int,
    parse_thai_date,
)

# How each canonical field is read. Anything unlisted is text.
DATE_FIELDS = frozenset({"date", "date_end", "order_date"})
INT_FIELDS = frozenset({"impressions", "reach", "clicks", "conversions", "quantity"})
DECIMAL_FIELDS = frozenset({
    "ctr", "cpc", "cpm", "spend", "cost_per_conversion", "revenue", "roas",
    "unit_price", "seller_discount", "buyer_paid", "commission_fee",
    "transaction_fee", "service_fee", "shipping_fee", "net_payout",
    "unit_cost", "list_price",
})


def field_kind(field: str) -> str:
    if field in DATE_FIELDS:
        return "date"
    if field in INT_FIELDS:
        return "int"
    if field in DECIMAL_FIELDS:
        return "decimal"
    return "text"


class Issue(dict):
    """One problem with one cell, in the shape ``import_row_errors`` stores."""

    def __init__(self, code: str, message: str, column: str | None = None) -> None:
        super().__init__(error_code=code, error_message=message, column_name=column)


def _parse_cell(field: str, value: Any) -> tuple[Any, Issue | None]:
    """Read one cell as its field's type. Returns ``(value, issue)``."""
    kind = field_kind(field)
    if kind == "text":
        return normalize_text(value), None

    if is_blank(value):
        # Absent, not broken. The row-level rules decide whether the absence of
        # this particular field disqualifies the row.
        return None, None

    if kind == "date":
        parsed = parse_thai_date(value)
        if parsed is None:
            return None, Issue(
                "unreadable_date",
                f"'{normalize_text(value)}' is not a date we can read. "
                "Expected e.g. 2026-07-18, 18/07/2569 or 18 ก.ค. 2569.",
                field,
            )
        return parsed, None

    parsed = parse_int(value) if kind == "int" else parse_decimal(value)
    if parsed is None:
        return None, Issue(
            "unreadable_number",
            f"'{normalize_text(value)}' is not a number we can read.",
            field,
        )
    return parsed, None


def build_record(row_number: int, cells: list[Any], mapping: dict) -> dict:
    """Build one typed record from one raw row.

    ``raw`` keeps the original cells for every mapped column. It is what the
    error report shows the merchant and what ``import_row_errors.raw_row``
    stores — a rejected row is only actionable if they can see what was in it.
    """
    columns: dict[str, int] = mapping["columns"]
    width = len(mapping.get("headers") or []) or (max(columns.values()) + 1 if columns else 0)

    issues: list[Issue] = []
    original_width = len(cells)
    if original_width < width:
        issues.append(Issue(
            "short_row",
            f"This row has {original_width} values but the file has {width} columns.",
        ))

    padded = iter_cells(cells, width)
    values: dict[str, Any] = {}
    raw: dict[str, str] = {}

    for field, position in columns.items():
        cell = padded[position] if position < len(padded) else ""
        raw[field] = normalize_text(cell)
        parsed, issue = _parse_cell(field, cell)
        values[field] = parsed
        if issue is not None:
            issues.append(issue)

    return {
        "row_number": row_number,
        "values": values,
        "raw": raw,
        "issues": issues,
        "truncated": original_width < width,
    }


def build_records(rows: list[tuple[int, list[Any]]], mapping: dict) -> list[dict]:
    """Type every row of the file. Never raises on data."""
    return [build_record(row_number, cells, mapping) for row_number, cells in rows]


def jsonable(value: Any) -> Any:
    """Make a parsed value safe to stage as JSON without losing exactness.

    Decimals become **strings**, not floats. Money is the whole point of this
    product — the write-up reconciles fixture totals to the satang, and
    PostgREST accepts a numeric string for a ``numeric`` column, so nothing is
    gained by rounding through binary floating point on the way.
    """
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (dt.date, dt.datetime)):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(item) for item in value]
    return value


def rehydrate(field: str, value: Any) -> Any:
    """Undo :func:`jsonable` for one field.

    Stages hand bulk data to each other as JSON on disk, which flattens
    ``Decimal`` to a string and ``date`` to ISO text. The validation rules test
    types (``isinstance(value, (int, Decimal))``) to decide whether a metric is
    negative, so a record read straight back from JSON would silently pass every
    numeric rule — the rows would look valid because the checks no longer apply
    to them. Restoring the types on read is what keeps the stage boundary from
    quietly weakening the rules.
    """
    if value is None:
        return None
    kind = field_kind(field)
    if kind == "decimal":
        return value if isinstance(value, Decimal) else Decimal(str(value))
    if kind == "int":
        return value if isinstance(value, int) else int(value)
    if kind == "date":
        return value if isinstance(value, dt.date) else dt.date.fromisoformat(str(value))
    return value


def rehydrate_records(records: list[dict]) -> list[dict]:
    """Restore parsed types across a list of records read back from JSON."""
    restored = []
    for record in records:
        restored.append({
            **record,
            "values": {
                field: rehydrate(field, value)
                for field, value in record["values"].items()
            },
        })
    return restored


def summarize_mapping(mapping: dict) -> str:
    """One-line human summary of what the header row resolved to."""
    columns = mapping["columns"]
    parts = [f"{len(columns)} columns mapped as {mapping['dataset']}"]
    if mapping["unmapped"]:
        parts.append(f"{len(mapping['unmapped'])} ignored ({', '.join(mapping['unmapped'][:3])})")
    if mapping["conflicts"]:
        parts.append(f"{len(mapping['conflicts'])} duplicate headings")
    return "; ".join(parts)
