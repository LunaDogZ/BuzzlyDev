#!/usr/bin/env python3
"""KPI-1 — reconcile stored Meta rows against a Meta Ads Manager CSV export.

    python3 tests/verify_reconcile.py --export path/to/export.csv

Writes `reports/reconciliation-<ts>.json` and `tests/RECONCILIATION.md`, and
exits non-zero when the reconciliation fails. The comparison itself lives in
`reconcile_lib`, which has no network access; this file is the part that reads
the two sides and files the evidence.

**Why a CSV and not the API twice.** Reconciling the Graph API against the Graph
API is circular — the same service, the same attribution, the same rounding, so
a mapping bug agrees with itself. The export passes through Meta's own reporting
and rendering layer, which is a genuinely different path to the same facts.

**Negative controls run by default, and there are three.** A table of 0.0000%
errors is indistinguishable from a harness that compared nothing, so every run
also perturbs its own input and requires the verdict to change: one impression
+1 (the metric gate must fire while coverage still passes), one row removed (the
coverage gate must fire while every remaining cell is still exact), and the same
export against fixture rows. If any control passes, this program aborts — a
check that cannot fail is worse than no check, it is a claim (CLAUDE.md §12).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import zoneinfo
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from kpi_harness import Supabase, load_service_credentials  # noqa: E402
from reconcile_lib import (  # noqa: E402
    ExportFormatError,
    ReconcileRow,
    Reconciliation,
    compare,
    read_export,
    render_markdown,
    to_json,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
REPORTS_DIR = REPO_ROOT / "reports"
MARKDOWN_PATH = REPO_ROOT / "tests" / "RECONCILIATION.md"

# The workspace the live connector writes into. Overridable, but defaulted so a
# re-measurement is one command with no arguments to get wrong.
DEFAULT_WORKSPACE = "b022da17-32cb-4694-bd72-0087bf427d79"
DEFAULT_AD_ACCOUNT = "336e1785-367f-4559-8ee8-2c38e2261e13"

ACCOUNT_TIMEZONE = "Asia/Bangkok"
META_PREFIX = "meta:"


class ReconcileAbort(RuntimeError):
    """The run cannot produce an honest number. Stop; do not write a report."""


def fetch_db_rows(
    db: Supabase, *, ad_account_id: str, source: str, window: tuple[str, str],
    require_meta_prefix: bool = True,
) -> list[ReconcileRow]:
    """The stored side, at ad × day grain.

    `ads.platform_ad_id` is the join key back to Meta: the connector stamps
    `meta:<ad_id>` on every ad it writes, and that prefix is also what protects
    these rows from the fixture sync's delete. Rows whose ad carries no such
    prefix are NOT silently dropped — they are a real inconsistency and the run
    refuses rather than reconcile a subset it chose for itself.

    `require_meta_prefix=False` is for the fixture control, where the rows are
    supposed to be unrelated to Meta and are keyed by their own ad id instead.

    **Scoped to the export's own date window, and this is not optional.** The
    database holds every day the connector has ever fetched; an export covers
    the range the operator asked Ads Manager for. Comparing the two unscoped
    reports every day outside the export as a row the export is missing, so the
    coverage gate fails for a reason that has nothing to do with the pipeline —
    reliably, because the sensible export ends yesterday while the database
    already has today. Like is compared with like, or the number means nothing.
    """
    since, until = window
    records = db.select(
        "ad_insights",
        "select=date,impressions,clicks,spend,conversions,ads(id,platform_ad_id)"
        f"&ad_account_id=eq.{ad_account_id}&data_source=eq.{source}"
        f"&date=gte.{since}&date=lte.{until}&limit=5000",
    )

    rows: list[ReconcileRow] = []
    unlabelled: list[str] = []
    for record in records:
        ad = record.get("ads") or {}
        ad = ad if isinstance(ad, dict) else {}
        platform_ad_id = ad.get("platform_ad_id") or ""
        if platform_ad_id.startswith(META_PREFIX):
            ad_id = platform_ad_id[len(META_PREFIX):]
        elif require_meta_prefix:
            unlabelled.append(f"{record.get('date')} ({platform_ad_id or 'no ad'})")
            continue
        else:
            ad_id = platform_ad_id or str(ad.get("id") or "unknown")
        rows.append(
            ReconcileRow(
                ad_id=ad_id,
                date=str(record["date"]),
                impressions=int(record["impressions"] or 0),
                clicks=int(record["clicks"] or 0),
                # str() first: PostgREST hands numeric back as a JSON number, and
                # Decimal(float) would carry the binary representation's noise
                # into a comparison whose whole purpose is exactness.
                spend=_decimal(record["spend"]),
                conversions=None if record["conversions"] is None else int(record["conversions"]),
            )
        )

    if unlabelled:
        raise ReconcileAbort(
            f"{len(unlabelled)} rows labelled '{source}' are attached to an ad with no "
            f"'{META_PREFIX}' prefix: {unlabelled[:5]}. Reconciling the rest would "
            f"measure a subset this harness picked for itself."
        )
    return rows


def _decimal(value) -> Decimal:
    return Decimal(str(value if value is not None else 0))


def guard_export_window(export, *, allow_today: bool) -> None:
    """Refuse an export that includes today, unless told otherwise.

    The connected account is live. Measured on 2026-08-12, its total moved
    ฿1,316.13 → ฿1,316.30 → ฿1,316.41 within minutes. An export taken at one
    moment and a sync taken at another will disagree on the current day for the
    one reason that is not a defect, and a KPI that fails for that reason
    teaches nobody anything.
    """
    if not export.rows:
        raise ReconcileAbort(f"{export.path} produced no rows to reconcile")
    _, until = export.window
    today = dt.datetime.now(zoneinfo.ZoneInfo(ACCOUNT_TIMEZONE)).date().isoformat()
    if until >= today and not allow_today:
        raise ReconcileAbort(
            f"the export runs to {until}, which is today in {ACCOUNT_TIMEZONE}. "
            f"Today's numbers are still moving on both sides. Re-export ending "
            f"yesterday, or pass --allow-today and say so in the write-up."
        )


def negative_controls(
    db: Supabase, export, db_rows: list[ReconcileRow], *,
    ad_account_id: str, control_source: str,
) -> tuple[str, dict]:
    """Prove this harness can fail, three independent ways.

    The version of this originally sketched only compared the export against
    fixture rows. That turned out to be the weakest of the three: unrelated ads
    fail on *coverage* alone, so it never exercises the arithmetic gate at all —
    a harness whose metric comparison was stubbed out to `return True` would
    still pass that control. So the two mutation controls below carry the real
    weight, and they are mutation tests in the ordinary sense: perturb the
    input by the smallest possible amount and require the result to change.

      M1  one impression +1        → coverage still PASSES, tier A must FAIL
      M2  one row removed          → tier A still exact, coverage must FAIL
      F   fixture rows for truth   → both must fail

    M1 and M2 are deterministic and always available, because they are derived
    from whatever the run just read. Aborting when any control passes is the
    point: an absent or toothless negative control is not a neutral omission,
    it is the difference between evidence and assertion (CLAUDE.md §12).
    """
    if not db_rows:
        raise ReconcileAbort("nothing to mutate — no stored rows were read")

    lines: list[str] = []
    summary: dict = {}

    # A run whose own coverage already fails cannot host M1: every mutated
    # comparison would fail on coverage too, telling us nothing about the
    # arithmetic gate. That is not a reason to abort — the failing run is a
    # RESULT and must be filed as evidence, with the controls reported as what
    # they are. Aborting here would delete the finding.
    baseline = compare(export.rows, db_rows)
    if not baseline.coverage_passed:
        lines.append(
            f"**M1 — not applicable.** This run's own coverage already fails "
            f"({len(baseline.only_in_export)} rows only in the export, "
            f"{len(baseline.only_in_db)} only in the database), so a corrupted value "
            f"could not be told apart from the rows that are simply absent. The "
            f"coverage failure is itself the demonstration that the gate fires."
        )
        summary["m1_one_impression"] = {"verdict": "N/A", "reason": "baseline coverage fails"}

    # ── M1: smallest possible corruption of a value ──────────────────────────
    victim = min(db_rows, key=lambda r: (r.date, r.ad_id))
    mutated = [
        ReconcileRow(r.ad_id, r.date, r.impressions + 1, r.clicks, r.spend, r.conversions)
        if r.key == victim.key else r
        for r in db_rows
    ]
    if baseline.coverage_passed:
        m1 = compare(export.rows, mutated)
        if m1.passed:
            raise ReconcileAbort(
                "M1 negative control PASSED: adding 1 impression to a stored row did not "
                "change the verdict. The metric gate is not measuring anything."
            )
        if not m1.coverage_passed:
            raise ReconcileAbort(
                "M1 negative control failed on COVERAGE rather than on the metric it "
                "corrupted, so it does not prove the arithmetic gate is live."
            )
        lines.append(
            f"**M1 — one value corrupted.** Added 1 impression to ad `{victim.ad_id}` on "
            f"{victim.date} ({victim.impressions} → {victim.impressions + 1}). Coverage "
            f"still passes; tier A drops to "
            f"{m1.tier_a['impressions'].exact_rows}/{m1.tier_a['impressions'].compared_rows} "
            f"exact rows and the verdict becomes **FAIL**. ✔ the metric gate is live."
        )
        summary["m1_one_impression"] = {"verdict": "FAIL", "coverage_passed": True}

    # ── M2: smallest possible loss of a row ──────────────────────────────────
    dropped = [r for r in db_rows if r.key != victim.key]
    m2 = compare(export.rows, dropped)
    if m2.passed:
        raise ReconcileAbort(
            "M2 negative control PASSED: deleting a stored row did not change the "
            "verdict. The coverage gate is not measuring anything."
        )
    lines.append(
        f"**M2 — one row lost.** Removed ad `{victim.ad_id}` on {victim.date} from the "
        f"stored side. Every remaining row still matches exactly "
        f"({m2.exact_cells}/{m2.total_cells} cells), and the verdict is still "
        f"**FAIL** because the row is missing. ✔ perfect arithmetic over a subset "
        f"does not earn a pass."
    )
    summary["m2_one_row_dropped"] = {"verdict": "FAIL", "exact_cells": m2.exact_cells}

    # ── F: fixture data as the stored side ───────────────────────────────────
    fixture_rows = fetch_db_rows(
        db, ad_account_id=ad_account_id, source=control_source,
        window=export.window, require_meta_prefix=False,
    )
    if fixture_rows:
        f = compare(export.rows, fixture_rows)
        if f.passed:
            raise ReconcileAbort(
                f"fixture control PASSED against '{control_source}' rows — the "
                f"comparison cannot tell real data from simulated data."
            )
        lines.append(
            f"**F — fixtures as the source of truth.** Same export against "
            f"`data_source='{control_source}'` on the same ad account: "
            f"{len(f.only_in_export)} rows only in the export, {len(f.only_in_db)} only "
            f"in the database, verdict **FAIL**."
        )
        summary["f_fixture_source"] = {"verdict": "FAIL", "rows": len(fixture_rows)}
    else:
        lines.append(
            f"**F — skipped**: no `{control_source}` rows on this account to compare "
            f"against. M1 and M2 above are unaffected."
        )
        summary["f_fixture_source"] = {"verdict": "SKIPPED", "rows": 0}

    return "\n\n".join(lines), summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--export", required=True, type=Path,
                        help="CSV exported from Meta Ads Manager (level=Ad, breakdown=Day, "
                             "must include the Ad ID and 'Clicks (all)' columns)")
    parser.add_argument("--workspace", default=DEFAULT_WORKSPACE)
    parser.add_argument("--ad-account", default=DEFAULT_AD_ACCOUNT)
    parser.add_argument("--source", default="meta_live",
                        help="data_source under test (default: meta_live)")
    parser.add_argument("--control-source", default="mock",
                        help="data_source the negative control compares against")
    parser.add_argument("--ground-truth", default="meta_ads_manager",
                        choices=("meta_ads_manager", "generated"),
                        help="labels the report; a synthetic truth can never be unlabelled")
    parser.add_argument("--allow-today", action="store_true",
                        help="permit an export that runs to today (both sides still moving)")
    parser.add_argument("--skip-negative-control", action="store_true",
                        help="not for published results — the control is the evidence "
                             "that a passing table means anything")
    args = parser.parse_args(argv)

    try:
        export = read_export(args.export)
        guard_export_window(export, allow_today=args.allow_today)

        url, key = load_service_credentials()
        db = Supabase(url, key)

        db_rows = fetch_db_rows(db, ad_account_id=args.ad_account, source=args.source,
                                window=export.window)
        if not db_rows:
            raise ReconcileAbort(
                f"no '{args.source}' rows on ad account {args.ad_account}. Run the "
                f"connector first: POST /api/meta/sync."
            )
        result = compare(export.rows, db_rows)

        control_line = None
        control_summary = None
        if not args.skip_negative_control:
            control_line, control_summary = negative_controls(
                db, export, db_rows, ad_account_id=args.ad_account,
                control_source=args.control_source,
            )
    except (ExportFormatError, ReconcileAbort) as exc:
        # No artifacts are written on an abort, deliberately: a partial
        # RECONCILIATION.md carrying a flattering half-measurement is worse than
        # none, because it looks like a result.
        print(f"ABORT: {exc}", file=sys.stderr)
        return 2

    payload = to_json(result, export, source=args.ground_truth)
    payload["workspace_id"] = args.workspace
    payload["ad_account_id"] = args.ad_account
    payload["data_source"] = args.source
    payload["negative_controls"] = control_summary
    payload["measured_at"] = dt.datetime.now(dt.timezone.utc).isoformat()

    REPORTS_DIR.mkdir(exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    json_path = REPORTS_DIR / f"reconciliation-{stamp}.json"
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    MARKDOWN_PATH.write_text(
        render_markdown(result, export, source=args.ground_truth,
                        negative_control=control_line),
        encoding="utf-8",
    )

    print(f"coverage      : {len(result.only_in_export)} only in export, "
          f"{len(result.only_in_db)} only in database")
    print(f"cell exact    : {result.exact_cells}/{result.total_cells}")
    for metric in result.tier_a.values():
        print(f"  {metric.name:<12}: agg {metric.aggregate_error_pct:.4f}%  "
              f"exact {metric.exact_rows}/{metric.compared_rows}")
    print(f"negative ctrl : {'FAIL (as required)' if control_line else 'SKIPPED'}")
    print(f"VERDICT       : {'PASS' if result.passed else 'FAIL'}")
    print(f"\nwrote {json_path.relative_to(REPO_ROOT)} and "
          f"{MARKDOWN_PATH.relative_to(REPO_ROOT)}")
    return 0 if result.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
