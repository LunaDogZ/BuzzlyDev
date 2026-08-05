"""Row-level rules — which records may be ingested, and why the rest may not.

The governing trade-off: this persona's files are *messy*, and an all-or-nothing
import would reject nearly every real one. So a row is rejected only when
ingesting it would put a **wrong number** in front of the merchant, never for
being untidy. Everything else lands.

That line is drawn deliberately:

* A cell the merchant left empty is a fact ("no result that day"), and lands.
* A cell they filled with something unreadable is corruption. It is rejected,
  because a spend of ``N/A`` silently read as 0 understates their cost — and
  understated cost is precisely the error this product exists to eliminate.
* A row that contradicts itself (more clicks than impressions) is rejected even
  though every cell parses, because the arithmetic downstream would inherit the
  contradiction.
* A row identical to one already seen in the same file is rejected as a
  duplicate. Exports genuinely repeat rows when a merchant appends a re-download
  to an existing sheet, and double-counted spend is a wrong number.

Every rejection carries a code and a sentence the merchant can act on. Those two
go to ``import_row_errors`` and into the downloadable error report; the counts
they produce are what turns a job ``partial``.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

# Fields without which a record cannot be ingested at all, per dataset. Kept
# small on purpose — each entry is a row the merchant loses.
REQUIRED_FIELDS: dict[str, tuple[str, ...]] = {
    "ad_performance": ("date", "campaign_name"),
    "shopee_income": ("order_sn", "sku", "order_date"),
    "product_cogs": ("sku", "unit_cost"),
}

# Quantities that cannot meaningfully be below zero. Fees and discounts are
# absent here on purpose: Shopee issues genuine negative adjustments (refunds,
# fee reversals), and rejecting those would delete real money from the ledger.
NON_NEGATIVE_FIELDS: frozenset[str] = frozenset({
    "impressions", "reach", "clicks", "conversions", "spend", "quantity",
    "unit_price", "buyer_paid", "unit_cost", "list_price",
})

# The fields whose combination identifies a row within one file.
IDENTITY_FIELDS: dict[str, tuple[str, ...]] = {
    "ad_performance": ("date", "campaign_name", "ad_group_name", "ad_name"),
    "shopee_income": ("order_sn", "sku"),
    "product_cogs": ("sku",),
}

# Parse issues that disqualify a row outright wherever they occur. A structurally
# short row cannot be trusted at all — its values may be shifted into the wrong
# columns, which is worse than missing.
FATAL_ISSUE_CODES = frozenset({"short_row"})


def _identity(record: dict, dataset: str) -> tuple:
    values = record["values"]
    return tuple(
        str(values.get(field) or "").strip().lower()
        for field in IDENTITY_FIELDS.get(dataset, ())
    )


def _check_required(record: dict, dataset: str) -> list[dict]:
    problems = []
    for field in REQUIRED_FIELDS.get(dataset, ()):
        if record["values"].get(field) in (None, ""):
            # Distinguish "you left it out" from "we could not read it" — the
            # merchant's next action differs, and an issue already exists for
            # the unreadable case.
            already_reported = any(
                issue.get("column_name") == field for issue in record["issues"]
            )
            if not already_reported:
                problems.append({
                    "error_code": "missing_required",
                    "error_message": f"'{field}' is required but this row has no value for it.",
                    "column_name": field,
                })
    return problems


def _check_ranges(record: dict) -> list[dict]:
    problems = []
    values = record["values"]
    for field in NON_NEGATIVE_FIELDS:
        value = values.get(field)
        if isinstance(value, (int, Decimal)) and value < 0:
            problems.append({
                "error_code": "negative_value",
                "error_message": f"'{field}' cannot be negative (found {value}).",
                "column_name": field,
            })
    return problems


def _check_coherence(record: dict, dataset: str) -> list[dict]:
    """Cross-field arithmetic that must hold for the row to make sense."""
    if dataset != "ad_performance":
        return []
    values = record["values"]
    impressions, clicks = values.get("impressions"), values.get("clicks")
    # A negative impression count already has its own rejection reason; letting
    # it also trip this rule would report a confusing second problem ("more
    # clicks than impressions") that is a consequence of the first, not an
    # independent defect the merchant can act on.
    if not (isinstance(impressions, int) and isinstance(clicks, int)):
        return []
    if impressions < 0 or clicks < 0:
        return []
    if clicks > impressions:
        return [{
            "error_code": "clicks_exceed_impressions",
            "error_message": (
                f"This row has more clicks ({clicks}) than impressions ({impressions}), "
                "which cannot happen."
            ),
            "column_name": "clicks",
        }]
    return []


def validate_records(records: list[dict], dataset: str) -> dict:
    """Split typed records into the ones to ingest and the ones to report.

    Returns ``{"ok": [...], "rejected": [...], "counts": {...}}`` where each
    rejected entry carries its row number, the original cells, and every reason
    it failed — all of them, not just the first, so one pass through the error
    report is enough to fix the row.
    """
    ok: list[dict] = []
    rejected: list[dict] = []
    seen: dict[tuple, int] = {}
    reason_counts: dict[str, int] = {}

    for record in records:
        problems: list[dict] = []

        # Parse-time issues. An unreadable cell is corruption; a structurally
        # broken row is fatal on its own.
        for issue in record["issues"]:
            problems.append(dict(issue))

        problems.extend(_check_required(record, dataset))
        problems.extend(_check_ranges(record))
        problems.extend(_check_coherence(record, dataset))

        identity = _identity(record, dataset)
        if identity and any(identity):
            first_seen = seen.get(identity)
            if first_seen is not None:
                problems.append({
                    "error_code": "duplicate_row",
                    "error_message": (
                        f"This row repeats row {first_seen} of the file; "
                        "it was not imported again."
                    ),
                    "column_name": None,
                })
            else:
                seen[identity] = record["row_number"]

        if problems:
            for problem in problems:
                code = problem["error_code"]
                reason_counts[code] = reason_counts.get(code, 0) + 1
            rejected.append({
                "row_number": record["row_number"],
                "raw": record["raw"],
                "problems": problems,
            })
        else:
            ok.append(record)

    return {
        "ok": ok,
        "rejected": rejected,
        "counts": {
            "rows_total": len(records),
            "rows_ok": len(ok),
            "rows_quarantined": len(rejected),
            "by_reason": reason_counts,
        },
    }
