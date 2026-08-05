"""Tests for the measurement harness.

A harness has a failure mode ordinary code does not: it can go on producing
numbers after it has stopped measuring anything. A scoring function that
returns "correct" for a cell nobody read, a stage-name typo that quietly drops
the orchestration comparison, a baseline generous enough to flatter itself —
each of those yields a clean run and a report that is wrong. So these tests aim
at the scoring and the wiring rather than at the arithmetic.

The fixture cases at the bottom pin the headline results. If a change to the
cleaning rules moves them, a test fails here before the write-up quietly
becomes wrong.
"""

from __future__ import annotations

import sys
import unittest
from decimal import Decimal
from pathlib import Path

# Self-contained, like every other module here: `unittest discover` imports
# alphabetically, so relying on a sibling to set the path makes a test's outcome
# depend on its own name.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dags"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from buzzly_common.pipeline import PROGRESS_STAGES  # noqa: E402
from research import baseline, measure, report, truth  # noqa: E402
from research.orchestration import COMPUTE_STAGES, STAGE_TO_PHASE, _summarise  # noqa: E402


class TestBaseline(unittest.TestCase):
    """The comparison is only worth something if the baseline is honest."""

    CLEAN = (
        b"Reporting starts,Campaign name,Impressions,Link clicks\r\n"
        b"2026-07-01,Summer,1000,20\r\n"
    )

    def test_reads_a_plain_english_file(self):
        result = baseline.naive_parse(self.CLEAN)
        self.assertEqual(len(result["ok"]), 1)
        self.assertEqual(result["ok"][0]["values"]["impressions"], 1000)
        self.assertEqual(result["ok"][0]["values"]["campaign_name"], "Summer")

    def test_is_not_a_strawman(self):
        """It must map the headings it can see, or the comparison proves nothing."""
        result = baseline.naive_parse(self.CLEAN)
        self.assertEqual(
            set(result["columns"]), {"date", "campaign_name", "impressions", "clicks"}
        )

    def test_loses_a_thai_encoded_file_entirely(self):
        """CP874 is what Thai Excel writes; UTF-8 cannot decode it."""
        data = "วันที่,ชื่อแคมเปญ\r\n2026-07-01,ซัมเมอร์\r\n".encode("cp874")
        result = baseline.naive_parse(data)
        self.assertIsNotNone(result["failure"])
        self.assertEqual(result["ok"], [])

    def test_cannot_read_a_buddhist_era_date(self):
        data = (
            b"Reporting starts,Campaign name\r\n"
            + "01/07/2569,ซัมเมอร์".encode()
            + b"\r\n"
        )
        self.assertEqual(baseline.naive_parse(data)["ok"], [])

    def test_drops_a_row_for_a_blank_optional_cell(self):
        """The distinction it cannot make: absent versus unreadable."""
        data = (
            b"Reporting starts,Campaign name,Results\r\n"
            b"2026-07-01,Summer,\r\n"
        )
        self.assertEqual(baseline.naive_parse(data)["ok"], [])


class TestScoring(unittest.TestCase):
    """Four outcomes, and the arithmetic that must not blur them."""

    def test_correct_across_representations(self):
        self.assertEqual(truth.score_cell("spend", Decimal("1234.56"), "1234.56"), "correct")
        self.assertEqual(truth.score_cell("spend", 1234.56, "1234.56"), "correct")
        self.assertEqual(truth.score_cell("impressions", 1000, 1000), "correct")

    def test_date_forms_agree(self):
        import datetime as dt

        self.assertEqual(truth.score_cell("date", dt.date(2026, 7, 1), "2026-07-01"), "correct")

    def test_missing_is_not_fabricated(self):
        self.assertEqual(truth.score_cell("clicks", None, 20), "missing")
        self.assertEqual(truth.score_cell("clicks", 0, None), "fabricated")

    def test_a_blank_read_as_zero_is_caught(self):
        """The error this whole scoring split exists to expose."""
        self.assertEqual(truth.score_cell("conversions", 0, None), "fabricated")
        self.assertNotEqual(truth.score_cell("conversions", 0, None), "correct")

    def test_wrong_value(self):
        self.assertEqual(truth.score_cell("impressions", 999, 1000), "wrong")

    def test_money_is_not_compared_as_float(self):
        """0.1 + 0.2 must not decide a parser is wrong."""
        total = Decimal("0.1") + Decimal("0.2")
        self.assertEqual(truth.score_cell("spend", total, "0.3"), "correct")

    def test_unread_rows_score_as_missing_not_absent(self):
        rows = [{"row_number": 2, "values": {"impressions": 10, "clicks": 1}}]
        scored = truth.score_rows({}, rows)
        self.assertEqual(scored["missing"], 2)
        self.assertEqual(scored["rows_matched"], 0)
        self.assertEqual(scored["accuracy"], 0.0)

    def test_blank_agreements_cannot_inflate_value_accuracy(self):
        """A parser that read nothing must not score above zero on real values."""
        rows = [{"row_number": 2, "values": {"impressions": 10, "conversions": None}}]
        scored = truth.score_rows({}, rows)
        self.assertEqual(scored["correct"], 1)          # agreed the blank was blank
        self.assertEqual(scored["blank_agreements"], 1)
        self.assertEqual(scored["value_accuracy"], 0.0)  # and recovered nothing

    def test_rate_does_not_divide_by_zero(self):
        self.assertEqual(truth.rate(0, 0), 0.0)


class TestOrchestrationWiring(unittest.TestCase):
    """The failure here is silent: a renamed stage makes the comparison vanish."""

    def test_compute_stages_are_real_stages(self):
        for stage in COMPUTE_STAGES:
            self.assertIn(stage, PROGRESS_STAGES, f"{stage!r} is not a stage of the DAG")

    def test_every_compute_stage_maps_to_phases(self):
        self.assertEqual(set(STAGE_TO_PHASE), set(COMPUTE_STAGES))

    def test_summarise_handles_an_empty_history(self):
        self.assertEqual(_summarise([]), {"n": 0})

    def test_summarise_reports_the_tail(self):
        summary = _summarise([1.0, 2.0, 3.0, 100.0])
        self.assertEqual(summary["median"], 2.5)
        self.assertEqual(summary["max"], 100.0)


class TestAgainstFixtures(unittest.TestCase):
    """The headline numbers, pinned. These are what the write-up quotes."""

    @classmethod
    def setUpClass(cls):
        cls.root = truth.fixtures_root()
        cls.truth = truth.load_truth(cls.root)

    def test_ground_truth_covers_the_labelled_file(self):
        entry = self.truth["files"][measure.LABELLED]
        self.assertEqual(len(entry["rows"]), 30)
        self.assertEqual(len(entry["header_fields"]), 15)

    def test_pipeline_reads_the_dirty_file_perfectly(self):
        result = measure.measure_accuracy(
            self.root / measure.LABELLED, "meta", self.truth["files"][measure.LABELLED]
        )
        pipeline = result["pipeline"]
        self.assertEqual(pipeline["rows_matched"], 30)
        self.assertEqual(pipeline["wrong"], 0)
        self.assertEqual(pipeline["missing"], 0)
        self.assertEqual(pipeline["fabricated"], 0)
        self.assertEqual(pipeline["value_accuracy"], 1.0)

    def test_baseline_recovers_nothing_from_the_dirty_file(self):
        """If this ever passes rows, the baseline has been made unfairly weak or
        the fixture has stopped being a Thai export."""
        result = measure.measure_accuracy(
            self.root / measure.LABELLED, "meta", self.truth["files"][measure.LABELLED]
        )
        self.assertEqual(result["baseline"]["value_accuracy"], 0.0)

    def test_quarantine_is_exact_and_gives_the_right_reasons(self):
        result = measure.measure_quarantine(
            self.root / measure.QUARANTINE_LABELLED,
            "meta",
            self.truth["files"][measure.QUARANTINE_LABELLED],
        )
        self.assertEqual(result["precision"], 1.0)
        self.assertEqual(result["recall"], 1.0)
        self.assertEqual(result["reason_accuracy"], 1.0)
        self.assertEqual(result["mistakes"], [])

    def test_baseline_ingests_defects_the_pipeline_refuses(self):
        """Row recovery is not a score — this is the measurement that says so."""
        result = measure.measure_quarantine(
            self.root / measure.QUARANTINE_LABELLED,
            "meta",
            self.truth["files"][measure.QUARANTINE_LABELLED],
        )
        self.assertGreater(result["baseline"]["false_accept"], 0)
        self.assertGreater(result["baseline"]["rows_kept"], result["true_accept"])

    def test_totals_reconcile_within_row_rounding(self):
        result = measure.measure_totals(self.root / measure.LABELLED, "meta")
        self.assertTrue(result["all_reconciled"])
        # Integer columns have no rounding to hide behind and must land exactly.
        self.assertTrue(result["fields"]["impressions"]["exact"])
        self.assertTrue(result["fields"]["clicks"]["exact"])

    def test_a_reimport_would_update_not_duplicate(self):
        result = measure.measure_idempotency(self.root / measure.LABELLED, "meta")
        self.assertTrue(result["stable_ids"])
        self.assertTrue(result["stable_rows"])
        self.assertTrue(result["order_independent_rows"])
        self.assertEqual(result["duplicate_keys"], 0)

    def test_the_empty_file_is_refused_with_a_usable_sentence(self):
        result = measure.measure_file(
            self.root / "edge-cases/empty.csv", "edge-cases/empty.csv", "meta", None
        )
        self.assertIn("empty", result["refused"]["reason"].lower())


class TestReport(unittest.TestCase):
    """The renderer must survive a run in which the live half was skipped."""

    def test_renders_without_orchestration(self):
        offline = measure.measure_all()
        rendered = report.render({
            "meta": {"generated_at": "now", "commit": "abc1234"},
            "offline": offline,
            "orchestration": {"available": False, "reason": "not running", "hint": "up -d"},
        })
        self.assertIn("Reading accuracy against a known answer key", rendered)
        self.assertIn("Not measured", rendered)
        # Every denominator the prose promises must actually be printed.
        self.assertIn("450 cells", rendered)


if __name__ == "__main__":
    unittest.main()
