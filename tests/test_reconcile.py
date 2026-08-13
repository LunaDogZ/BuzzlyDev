"""Unit tests for the KPI-1 reconciliation harness.

No network, no database, no Meta token: everything here runs against the frozen
fixtures in ``tests/fixtures/reconcile/``. That is deliberate — the harness has
to be testable *before* the real Ads Manager export exists, which is why the
reader takes a path rather than knowing where the export lives.

Every expectation is hand-declared. Nothing in this file was produced by running
the code it tests (CLAUDE.md §11).
"""

from __future__ import annotations

import unittest
from decimal import Decimal
from pathlib import Path

from reconcile_lib import (
    ExportFormatError,
    ReconcileRow,
    compare,
    read_export,
    render_markdown,
    to_json,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "reconcile"

# The three rows both English and Thai fixtures encode, written out by hand.
EXPECTED_EXPORT = [
    ("120400000000001", "2026-08-10", 1200, 34, Decimal("15.90"), 2),
    ("120400000000002", "2026-08-10", 800, 12, Decimal("9.10"), 0),
    ("120400000000001", "2026-08-11", 369, 5, Decimal("52.05"), 1),
]


def as_tuples(rows: list[ReconcileRow]) -> list[tuple]:
    return [(r.ad_id, r.date, r.impressions, r.clicks, r.spend, r.conversions) for r in rows]


def db_rows(rows: list[tuple]) -> list[ReconcileRow]:
    """Build the database side by hand, in the same shape the reader returns."""
    return [
        ReconcileRow(ad_id=a, date=d, impressions=i, clicks=c, spend=s, conversions=v)
        for a, d, i, c, s, v in rows
    ]


class TestReader(unittest.TestCase):
    def test_reads_english_headers(self):
        rows = read_export(FIXTURES / "export-en.csv").rows
        self.assertEqual(as_tuples(rows), EXPECTED_EXPORT)

    def test_thai_headers_produce_identical_rows(self):
        # Same numbers, Thai column names, thousands separators. If the two
        # disagree the reader is reading the locale, not the data.
        english = read_export(FIXTURES / "export-en.csv").rows
        thai = read_export(FIXTURES / "export-th.csv").rows
        self.assertEqual(as_tuples(thai), as_tuples(english))

    def test_real_ads_manager_thai_headings_produce_identical_rows(self):
        # `export-th.csv` uses the Thai headings this harness *guessed* before a
        # real export existed. Every one of them was wrong, and the fixture
        # agreeing with the guess is exactly why the suite was green against a
        # locale Meta does not emit. This fixture carries the headings measured
        # off the founder's 2026-08-12 export instead: `ID โฆษณา`, `อิมเพรสชัน`,
        # `จำนวนเงินที่ใช้จ่ายไป (THB)`.
        #
        # Honest limit: that export was account-level and carried no clicks
        # column, so `การคลิก (ทั้งหมด)` here is still the unverified guess.
        # Confirm it against the first export that includes 'Clicks (all)'.
        english = read_export(FIXTURES / "export-en.csv").rows
        measured = read_export(FIXTURES / "export-th-ads-manager.csv").rows
        self.assertEqual(as_tuples(measured), as_tuples(english))

    def test_account_level_export_is_refused_not_reconciled(self):
        # The shape the founder's first export actually had: every dimension
        # column present as a heading and empty in the cells, one row holding
        # the range's totals. Each such row is skipped for having no ad id, so
        # the table comes out empty — and an empty table would reconcile nothing
        # against nothing and report 0.0000% error over zero cells.
        with self.assertRaises(ExportFormatError) as ctx:
            read_export(FIXTURES / "export-account-level.csv")
        message = str(ctx.exception)
        self.assertIn("no ad × day rows", message)
        self.assertIn("Day", message)

    def test_totals_row_is_skipped_and_reported(self):
        # The Thai fixture carries a `รวมทั้งหมด` summary row, as Thai exports
        # do. Ingesting it would double every total; dropping it silently would
        # hide a reader that is quietly discarding real rows too.
        table = read_export(FIXTURES / "export-th.csv")
        self.assertEqual(len(table.rows), 3)
        self.assertEqual(len(table.skipped), 1)
        self.assertIn("รวมทั้งหมด", table.skipped[0].raw)

    def test_spend_is_decimal_not_float(self):
        row = read_export(FIXTURES / "export-en.csv").rows[0]
        self.assertIsInstance(row.spend, Decimal)
        # 15.90 as a float is 15.9000000000000003552713678800500929355621337890625
        self.assertEqual(row.spend, Decimal("15.90"))

    def test_utf8_bom_is_tolerated(self):
        rows = read_export(FIXTURES / "export-bom.csv").rows
        self.assertEqual(rows[0].ad_id, "120400000000001")

    def test_buddhist_era_and_slash_dates(self):
        # 10/08/2569 BE is 2026-08-10 CE. A year above 2400 is unambiguously BE.
        rows = read_export(FIXTURES / "export-buddhist-date.csv").rows
        self.assertEqual(rows[0].date, "2026-08-10")

    def test_missing_ad_id_is_refused_by_name(self):
        with self.assertRaises(ExportFormatError) as ctx:
            read_export(FIXTURES / "export-no-adid.csv")
        self.assertIn("Ad ID", str(ctx.exception))

    def test_link_clicks_only_is_refused(self):
        # The connector stores ALL clicks, by the approved mapping, so that it
        # agrees with the CTR and CPC Meta computes. Reconciling against link
        # clicks would compare two different metrics and call the difference a
        # pipeline defect.
        with self.assertRaises(ExportFormatError) as ctx:
            read_export(FIXTURES / "export-link-clicks-only.csv")
        message = str(ctx.exception)
        self.assertIn("Clicks (all)", message)
        self.assertIn("Link clicks", message)


class TestCoverageGate(unittest.TestCase):
    """Coverage is a precondition, not a footnote.

    A harness that scores only the rows present on both sides gives a perfect
    result to a connector that dropped nine rows out of ten. That is the
    can-never-fail check CLAUDE.md §12 is about.
    """

    def setUp(self):
        self.export = read_export(FIXTURES / "export-en.csv").rows

    def test_identical_sides_pass(self):
        result = compare(self.export, db_rows(EXPECTED_EXPORT))
        self.assertEqual(result.only_in_export, [])
        self.assertEqual(result.only_in_db, [])
        self.assertEqual(result.exact_cells, 9)  # 3 rows x 3 tier-A metrics
        self.assertEqual(result.total_cells, 9)
        self.assertTrue(result.passed)

    def test_row_missing_from_db_fails_despite_perfect_matches(self):
        result = compare(self.export, db_rows(EXPECTED_EXPORT[:2]))
        # Every row that IS present matches perfectly...
        self.assertEqual(result.exact_cells, result.total_cells)
        # ...and the verdict is still FAIL, because one row was never ingested.
        self.assertEqual(result.only_in_export, [("120400000000001", "2026-08-11")])
        self.assertFalse(result.passed)

    def test_row_only_in_db_fails(self):
        extra = EXPECTED_EXPORT + [("120400000000009", "2026-08-12", 1, 1, Decimal("1.00"), 0)]
        result = compare(self.export, db_rows(extra))
        self.assertEqual(result.only_in_db, [("120400000000009", "2026-08-12")])
        self.assertFalse(result.passed)


class TestTierA(unittest.TestCase):
    def setUp(self):
        self.export = read_export(FIXTURES / "export-en.csv").rows

    def test_offsetting_errors_do_not_hide_behind_the_aggregate(self):
        # +5 impressions on one row, -5 on another. The aggregate error is
        # exactly 0%, which is why the aggregate alone cannot be the gate.
        skewed = [
            ("120400000000001", "2026-08-10", 1205, 34, Decimal("15.90"), 2),
            ("120400000000002", "2026-08-10", 795, 12, Decimal("9.10"), 0),
            ("120400000000001", "2026-08-11", 369, 5, Decimal("52.05"), 1),
        ]
        result = compare(self.export, db_rows(skewed))
        impressions = result.tier_a["impressions"]
        self.assertEqual(impressions.aggregate_error_pct, Decimal("0"))
        self.assertEqual(impressions.exact_rows, 1)  # only the untouched row
        self.assertGreater(impressions.max_row_error_pct, Decimal("0"))
        self.assertFalse(result.passed)

    def test_spend_compares_by_value_not_by_text(self):
        # "15.9" and "15.90" are the same amount of money.
        same = [
            ("120400000000001", "2026-08-10", 1200, 34, Decimal("15.9"), 2),
            ("120400000000002", "2026-08-10", 800, 12, Decimal("9.1"), 0),
            ("120400000000001", "2026-08-11", 369, 5, Decimal("52.05"), 1),
        ]
        self.assertTrue(compare(self.export, db_rows(same)).passed)

    def test_a_zero_row_matching_zero_is_a_match(self):
        export = [ReconcileRow("a1", "2026-08-01", 0, 0, Decimal("0"), 0)]
        result = compare(export, db_rows([("a1", "2026-08-01", 0, 0, Decimal("0"), 0)]))
        self.assertTrue(result.passed)
        self.assertEqual(result.exact_cells, 3)

    def test_a_zero_in_the_export_against_a_non_zero_in_the_db_fails(self):
        # Relative error is undefined here; it must not silently become 0%.
        export = [ReconcileRow("a1", "2026-08-01", 0, 0, Decimal("0"), 0)]
        result = compare(export, db_rows([("a1", "2026-08-01", 12, 0, Decimal("0"), 0)]))
        self.assertFalse(result.passed)
        self.assertEqual(result.tier_a["impressions"].undefined_rows, 1)

    def test_a_difference_inside_tolerance_still_fails_the_exact_gate(self):
        # 0.08% is well under the 0.5% aggregate tolerance, but there is no
        # legitimate reason for a delivery metric to differ at all, so the
        # cell-level gate is what decides.
        near = [
            ("120400000000001", "2026-08-10", 1201, 34, Decimal("15.90"), 2),
            ("120400000000002", "2026-08-10", 800, 12, Decimal("9.10"), 0),
            ("120400000000001", "2026-08-11", 369, 5, Decimal("52.05"), 1),
        ]
        result = compare(self.export, db_rows(near))
        self.assertLess(result.tier_a["impressions"].aggregate_error_pct, Decimal("0.5"))
        self.assertEqual(result.tier_a["impressions"].exact_rows, 2)
        self.assertFalse(result.passed)


class TestTierBAndC(unittest.TestCase):
    def setUp(self):
        self.export = read_export(FIXTURES / "export-en.csv").rows

    def test_derived_metrics_are_recomputed_from_both_sides(self):
        # Row 1: 34 clicks / 1200 impressions = 2.8333…%, and ฿15.90/34 = ฿0.4676…
        # Compared as recomputed values, never as the two surfaces' own rounding.
        result = compare(self.export, db_rows(EXPECTED_EXPORT))
        self.assertEqual(result.tier_b["ctr"].exact_rows, 3)
        self.assertEqual(result.tier_b["cpc"].exact_rows, 3)

    def test_derived_metrics_add_no_independent_information(self):
        # If tier A matches exactly, tier B matches by construction. Stating it
        # keeps the table honest about what the extra rows are worth.
        result = compare(self.export, db_rows(EXPECTED_EXPORT))
        self.assertTrue(result.tier_b_is_implied_by_tier_a)

    def test_a_rate_total_is_the_rate_over_the_totals(self):
        # Adding up per-row CTRs is meaningless — the fixture's three rows are
        # 2.833%, 1.5% and 1.355%, and summing them gives 5.688, a number with
        # no interpretation that would nonetheless be printed in a results
        # table. The overall CTR is 51 clicks / 2369 impressions = 2.1528…%.
        result = compare(self.export, db_rows(EXPECTED_EXPORT))
        ctr = result.tier_b["ctr"]
        self.assertEqual(
            ctr.export_total.quantize(Decimal("0.0001")), Decimal("2.1528")
        )
        # ฿77.05 / 51 clicks = ฿1.5108…
        self.assertEqual(
            result.tier_b["cpc"].export_total.quantize(Decimal("0.0001")),
            Decimal("1.5108"),
        )

    def test_rows_with_no_denominator_leave_the_derived_comparison(self):
        # A day with zero impressions has no CTR. It is dropped from the derived
        # comparison rather than counted as 0%, and the row count says so.
        export = [
            ReconcileRow("a1", "2026-08-01", 0, 0, Decimal("0"), 0),
            ReconcileRow("a1", "2026-08-02", 100, 5, Decimal("1.00"), 0),
        ]
        result = compare(export, db_rows([
            ("a1", "2026-08-01", 0, 0, Decimal("0"), 0),
            ("a1", "2026-08-02", 100, 5, Decimal("1.00"), 0),
        ]))
        self.assertEqual(len(result.matched_keys), 2)
        self.assertEqual(result.tier_b["ctr"].compared_rows, 1)
        self.assertTrue(result.passed)

    def test_conversions_are_reported_but_never_gate(self):
        # Attribution windows differ between Ads Manager and the API, so a
        # difference here is not a pipeline defect. See L-5.
        differing = [
            ("120400000000001", "2026-08-10", 1200, 34, Decimal("15.90"), 99),
            ("120400000000002", "2026-08-10", 800, 12, Decimal("9.10"), 0),
            ("120400000000001", "2026-08-11", 369, 5, Decimal("52.05"), 1),
        ]
        result = compare(self.export, db_rows(differing))
        self.assertTrue(result.passed)
        self.assertEqual(result.tier_c["conversions"].exact_rows, 2)


class TestReport(unittest.TestCase):
    def setUp(self):
        self.export_table = read_export(FIXTURES / "export-en.csv")
        self.result = compare(self.export_table.rows, db_rows(EXPECTED_EXPORT))

    def test_json_carries_the_provenance_guard(self):
        payload = to_json(self.result, self.export_table, source="meta_ads_manager")
        # The guard agreed at sprint day 0: a synthetic ground truth can never
        # be pasted into the thesis unlabelled.
        self.assertEqual(payload["ground_truth_source"], "meta_ads_manager")
        self.assertEqual(len(payload["export_sha256"]), 64)
        self.assertIn("window", payload)

    def test_json_refuses_an_unknown_provenance_label(self):
        with self.assertRaises(ValueError):
            to_json(self.result, self.export_table, source="whatever")

    def test_markdown_states_coverage_before_the_metrics(self):
        markdown = render_markdown(self.result, self.export_table, source="meta_ads_manager")
        self.assertLess(markdown.index("COVERAGE"), markdown.index("A. DELIVERY"))
        self.assertIn("meta_ads_manager", markdown)

    def test_markdown_shows_worst_rows_even_when_passing(self):
        # A table of zeros with nothing behind it is indistinguishable from a
        # harness that compared nothing.
        markdown = render_markdown(self.result, self.export_table, source="meta_ads_manager")
        self.assertIn("WORST", markdown.upper())


if __name__ == "__main__":
    unittest.main()
