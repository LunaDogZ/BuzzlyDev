"""Unit tests for the pipeline stage contract (`buzzly_common.pipeline`).

Plain `unittest` on purpose: neither the Airflow image nor the host has pytest,
and `buzzly_common.pipeline` imports nothing outside the standard library, so
these run anywhere with no install step:

    python3 -m unittest discover -s airflow/tests -v

The stages themselves are placeholders until steps 5-7, but the accounting they
hand to `finalize` is what decides whether a merchant sees "imported" or
"failed" — that logic is worth testing before it has any callers that matter.
"""

from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dags"))

from buzzly_common import pipeline  # noqa: E402
from buzzly_common.pipeline import (  # noqa: E402
    STAGES,
    assert_consistent,
    clear_staging,
    new_ledger,
    read_staged,
    run_stage,
    short_circuit,
    staging_dir,
    staging_path,
    terminal_status,
    write_staged,
)

JOB = {
    "import_job_id": "11111111-1111-1111-1111-111111111111",
    "team_id": "22222222-2222-2222-2222-222222222222",
    "platform": "shopee_income",
    "original_filename": "รายงาน รายได้.xlsx",
}


def seeded() -> dict:
    return new_ledger(JOB, staging_path="/tmp/x/file.csv", size_bytes=42, sha256="abc123")


class LedgerTests(unittest.TestCase):
    def test_new_ledger_starts_empty_and_unskipped(self):
        ledger = seeded()
        self.assertEqual(ledger["import_job_id"], JOB["import_job_id"])
        self.assertEqual(ledger["platform"], "shopee_income")
        self.assertEqual((ledger["rows_total"], ledger["rows_ok"], ledger["rows_quarantined"]),
                         (0, 0, 0))
        self.assertIsNone(ledger["skipped"])
        self.assertEqual(ledger["trail"], [])

    def test_run_stage_does_not_mutate_its_input(self):
        """XCom values are shared with retries of sibling tasks — copy, never edit."""
        ledger = seeded()
        run_stage("parse", ledger, rows_total=10)
        self.assertEqual(ledger["rows_total"], 0)
        self.assertEqual(ledger["trail"], [])

    def test_run_stage_records_counts_in_the_trail(self):
        ledger = run_stage("parse", seeded(), rows_total=10, note="read 10 rows")
        entry = ledger["trail"][-1]
        self.assertEqual(entry["stage"], "parse")
        self.assertEqual(entry["note"], "read 10 rows")
        self.assertEqual(entry["rows_total"], 10)

    def test_run_stage_default_note_marks_unimplemented_stages(self):
        ledger = run_stage("detect_format", seeded(), todo="step 5 — format detection")
        self.assertTrue(ledger["trail"][-1]["note"].startswith("TODO step 5"))

    def test_run_stage_rejects_a_name_that_is_not_a_stage(self):
        with self.assertRaises(ValueError):
            run_stage("upsert", seeded())

    def test_run_stage_rejects_an_unknown_field(self):
        """A typo would otherwise write a field nobody reads and lose the value."""
        with self.assertRaises(KeyError):
            run_stage("parse", seeded(), row_total=10)


class ShortCircuitTests(unittest.TestCase):
    def test_short_circuit_flags_the_ledger_and_is_recorded(self):
        ledger = short_circuit("hash_dedupe", seeded(), "identical to import 99")
        self.assertEqual(ledger["skipped"], "identical to import 99")
        self.assertIn("short-circuit", ledger["trail"][-1]["note"])

    def test_later_stages_pass_through_without_writing_anything(self):
        ledger = short_circuit("hash_dedupe", seeded(), "duplicate")
        ledger = run_stage("parse", ledger, rows_total=999)
        self.assertEqual(ledger["rows_total"], 0, "a skipped run must not gain rows")
        self.assertEqual(ledger["trail"][-1]["note"], "not run — duplicate")

    def test_every_stage_still_appears_in_the_trail_of_a_skipped_run(self):
        """The trail is the audit log — a stage that did nothing must say so."""
        ledger = short_circuit("hash_dedupe", seeded(), "duplicate")
        for stage in STAGES[1:]:
            ledger = run_stage(stage, ledger)
        self.assertEqual([entry["stage"] for entry in ledger["trail"]], list(STAGES))


class TerminalStatusTests(unittest.TestCase):
    def status_for(self, **counts) -> tuple[str, str | None]:
        return terminal_status({**seeded(), **counts})

    def test_clean_file_succeeds_with_no_message(self):
        self.assertEqual(self.status_for(rows_total=10, rows_ok=10), ("succeeded", None))

    def test_some_bad_rows_is_partial_not_failure(self):
        status, message = self.status_for(rows_total=10, rows_ok=7, rows_quarantined=3)
        self.assertEqual(status, "partial")
        self.assertIn("7 of 10", message)

    def test_every_row_rejected_is_a_failure(self):
        status, message = self.status_for(rows_total=10, rows_quarantined=10)
        self.assertEqual(status, "failed")
        self.assertIn("10", message)

    def test_empty_file_succeeds_and_says_so(self):
        status, message = self.status_for()
        self.assertEqual(status, "succeeded")
        self.assertIn("No data rows", message)

    def test_duplicate_upload_succeeds_and_names_the_earlier_import(self):
        status, message = self.status_for(skipped="identical to import 99")
        self.assertEqual(status, "succeeded")
        self.assertIn("import 99", message)


class ConsistencyTests(unittest.TestCase):
    def test_balanced_counts_pass(self):
        assert_consistent({**seeded(), "rows_total": 10, "rows_ok": 7, "rows_quarantined": 3})

    def test_unbalanced_counts_raise_rather_than_report_wrong_numbers(self):
        with self.assertRaises(ValueError) as caught:
            assert_consistent({**seeded(), "rows_total": 10, "rows_ok": 7, "rows_quarantined": 1})
        self.assertIn("does not balance", str(caught.exception))

    def test_negative_counts_raise(self):
        with self.assertRaises(ValueError):
            assert_consistent({**seeded(), "rows_total": 1, "rows_ok": -1, "rows_quarantined": 2})

    def test_a_skipped_run_is_consistent(self):
        assert_consistent(short_circuit("hash_dedupe", seeded(), "duplicate"))


class StagingTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="buzzly-staging-test-"))
        self._real_root = pipeline.STAGING_ROOT
        pipeline.STAGING_ROOT = self.root
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.addCleanup(setattr, pipeline, "STAGING_ROOT", self._real_root)

    def test_write_then_read_round_trips(self):
        path = write_staged(staging_path("manual__2026-07-23", "report.csv"), b"a,b\n1,2\n")
        self.assertEqual(read_staged(path), b"a,b\n1,2\n")

    def test_reading_a_missing_file_returns_none_so_the_caller_redownloads(self):
        self.assertIsNone(read_staged(self.root / "gone" / "nothing.csv"))

    def test_paths_are_sanitised(self):
        """Run ids carry `:` and `+`; merchant filenames carry Thai and spaces."""
        path = staging_path("manual__2026-07-23T06:00:00+00:00", JOB["original_filename"])
        self.assertTrue(path.is_relative_to(self.root))
        for segment in path.relative_to(self.root).parts:
            self.assertRegex(segment, r"^[A-Za-z0-9._-]+$")

    def test_concurrent_runs_do_not_share_a_directory(self):
        self.assertNotEqual(staging_dir("run-a"), staging_dir("run-b"))

    def test_clear_staging_removes_the_run_and_is_safe_to_repeat(self):
        write_staged(staging_path("run-a", "f.csv"), b"x")
        self.assertTrue(clear_staging("run-a"))
        self.assertFalse(clear_staging("run-a"))
        self.assertFalse(staging_dir("run-a").exists())


class FullChainTests(unittest.TestCase):
    """What step 4 exists to prove: counts survive all seven stages intact."""

    def run_all(self, **stage_updates) -> dict:
        ledger = seeded()
        for stage in STAGES:
            ledger = run_stage(stage, ledger, **stage_updates.get(stage, {}))
        return ledger

    def test_placeholder_stages_finish_as_an_empty_success(self):
        ledger = self.run_all()
        assert_consistent(ledger)
        self.assertEqual(terminal_status(ledger)[0], "succeeded")
        self.assertEqual(len(ledger["trail"]), len(STAGES))

    def test_a_realistic_partial_run_survives_the_whole_chain(self):
        ledger = self.run_all(
            detect_format={"file_format": "xlsx"},
            parse={"rows_total": 100},
            validate={"rows_ok": 97, "rows_quarantined": 3},
            quarantine_bad_rows={"error_report_path": "team/job/errors.csv"},
        )
        assert_consistent(ledger)
        status, message = terminal_status(ledger)
        self.assertEqual(status, "partial")
        self.assertIn("97 of 100", message)
        self.assertEqual(ledger["file_format"], "xlsx")
        self.assertEqual(ledger["error_report_path"], "team/job/errors.csv")


if __name__ == "__main__":
    unittest.main()
