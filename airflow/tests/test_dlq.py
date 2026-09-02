"""The dead-letter vocabulary: seven codes, and picking the right one.

Landing a refused file in the queue is easy. Naming the reason correctly is the
part that is measured, so most of what follows is about the difference between
"we could not read your cells" and "we read them and the rules refused the row".
"""

from __future__ import annotations

import ast
import re
import sys
import unittest
from pathlib import Path

# Self-contained on purpose: `unittest discover` imports these modules in
# alphabetical order, so a module that relied on a sibling to put `dags/` on
# the path would fail or pass depending on its own name.
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "airflow" / "dags"))

from buzzly_common import dlq  # noqa: E402
from buzzly_common import reader  # noqa: E402

MIGRATION = ROOT / "supabase" / "migrations" / "20260805150000_ingestion_dlq_and_atomic_promote.sql"

JOB = {
    "import_job_id": "11111111-1111-1111-1111-111111111111",
    "team_id": "b022da17-32cb-4694-bd72-0087bf427d79",
    "platform": "meta",
    "original_filename": "ads-export.csv",
    "file_hash": "abc123",
}


def rejection(row_number: int, *codes: str) -> dict:
    return {
        "row_number": row_number,
        "raw": {},
        "problems": [{"error_code": code, "error_message": code} for code in codes],
    }


class TestTheCodesMatchTheDatabase(unittest.TestCase):
    """A code Python can emit but the CHECK constraint rejects is the worst case.

    The DLQ write would fail, so the one record explaining a refusal is the
    record that goes missing — and the write is deliberately non-fatal, so
    nothing else would report it either. Nothing but this test would catch it.
    """

    def migration_codes(self) -> set[str]:
        sql = MIGRATION.read_text(encoding="utf-8")
        block = re.search(r"error_code TEXT NOT NULL CHECK \(error_code IN \((.*?)\)\)", sql, re.S)
        self.assertIsNotNone(block, "the CHECK constraint on error_code has moved or changed shape")
        # Strip line comments first: the constraint documents each code inline.
        body = "\n".join(line.split("--")[0] for line in block.group(1).splitlines())
        return set(re.findall(r"'([A-Z_]+)'", body))

    def test_python_and_sql_agree_exactly(self):
        self.assertEqual(set(dlq.ERROR_CODES), self.migration_codes())

    def test_there_are_seven_of_them(self):
        self.assertEqual(len(dlq.ERROR_CODES), 7)
        self.assertEqual(len(set(dlq.ERROR_CODES)), 7)


class TestFileLevelFaults(unittest.TestCase):
    def test_an_empty_file_is_an_empty_payload(self):
        self.assertEqual(
            dlq.classify_unreadable("The file is empty (0 bytes)."), dlq.EMPTY_PAYLOAD)

    def test_a_file_with_no_rows_is_an_empty_payload(self):
        self.assertEqual(
            dlq.classify_unreadable("The file contains no rows."), dlq.EMPTY_PAYLOAD)

    def test_undecodable_bytes_are_an_encoding_error(self):
        self.assertEqual(
            dlq.classify_unreadable("The file's text encoding could not be determined."),
            dlq.ENCODING_ERROR)

    def test_a_format_we_refuse_is_a_schema_mismatch(self):
        self.assertEqual(
            dlq.classify_unreadable(
                "This is a legacy Excel (.xls) file. Please re-save it as .xlsx or .csv "
                "and upload again."),
            dlq.SCHEMA_MISMATCH)

    def test_an_unrecognised_message_is_not_guessed_at(self):
        self.assertEqual(dlq.classify_unreadable("something new went wrong"), dlq.UNKNOWN)

    def test_every_message_reader_can_raise_is_classified(self):
        """The mapping keys off message text, so it rots the moment one changes.

        `reader.UnreadableFile` is one class raised from seven places; giving it
        subclasses would be the cleaner fix, but that means editing the measured
        research artifact mid-sprint. This is the guard rail instead.
        """
        tree = ast.parse(Path(reader.__file__).read_text(encoding="utf-8"))
        messages = [
            "".join(part.value for part in node.args[0].values
                    if isinstance(part, ast.Constant))
            if isinstance(node.args[0], ast.JoinedStr)
            else node.args[0].value
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and getattr(node.func, "id", None) == "UnreadableFile"
            and node.args and isinstance(node.args[0], (ast.Constant, ast.JoinedStr))
        ]
        self.assertGreaterEqual(len(messages), 6, "did reader.py stop raising UnreadableFile?")
        unmatched = [m for m in messages if dlq.classify_unreadable(m) == dlq.UNKNOWN]
        self.assertEqual(unmatched, [], "these UnreadableFile messages have no DLQ code")


class TestRowLevelRollUp(unittest.TestCase):
    """Who failed — our reader, or their data?"""

    def test_unreadable_cells_are_a_coercion_failure(self):
        self.assertEqual(
            dlq.classify_rejections([
                rejection(2, "unreadable_date"),
                rejection(3, "unreadable_number"),
            ]),
            dlq.TYPE_COERCION_FAILED)

    def test_a_structurally_short_row_is_a_coercion_failure(self):
        self.assertEqual(
            dlq.classify_rejections([rejection(2, "short_row")]), dlq.TYPE_COERCION_FAILED)

    def test_rule_breaches_are_a_validation_failure(self):
        """The seventh code exists for exactly these.

        Filing a negative spend under TYPE_COERCION_FAILED would blame our
        parser for the merchant's data, and error-code accuracy is the metric
        that is hard to game.
        """
        for code in ("negative_value", "clicks_exceed_impressions",
                     "duplicate_row", "missing_required", "value_out_of_range"):
            with self.subTest(code=code):
                self.assertEqual(
                    dlq.classify_rejections([rejection(2, code)]), dlq.ROW_VALIDATION_FAILED)

    def test_the_majority_reason_wins(self):
        self.assertEqual(
            dlq.classify_rejections([
                rejection(2, "unreadable_date"),
                rejection(3, "unreadable_date"),
                rejection(4, "negative_value"),
            ]),
            dlq.TYPE_COERCION_FAILED)

    def test_a_tie_goes_to_the_reading_that_stays_true(self):
        """A coercion failure is also a validation failure; the reverse is not."""
        self.assertEqual(
            dlq.classify_rejections([
                rejection(2, "unreadable_date"),
                rejection(3, "negative_value"),
            ]),
            dlq.ROW_VALIDATION_FAILED)

    def test_a_row_counts_once_per_distinct_reason(self):
        counts = dlq.reason_summary([
            rejection(2, "negative_value", "duplicate_row"),
            rejection(3, "negative_value"),
        ])
        self.assertEqual(counts, {"negative_value": 2, "duplicate_row": 1})

    def test_an_unlisted_reason_rolls_up_as_a_rule_failure(self):
        """A new row-level code must not silently become UNKNOWN."""
        self.assertEqual(
            dlq.classify_rejections([rejection(2, "some_future_rule")]),
            dlq.ROW_VALIDATION_FAILED)

    def test_no_rejections_still_names_a_code(self):
        self.assertEqual(dlq.classify_rejections([]), dlq.ROW_VALIDATION_FAILED)


class TestBuildRecord(unittest.TestCase):
    def test_the_identifying_details_are_copied_not_joined(self):
        """The FK is ON DELETE SET NULL, so the record must stand on its own."""
        record = dlq.build_record(
            job=JOB, error_code=dlq.EMPTY_PAYLOAD, error_message="no rows", stage="finalize")
        self.assertEqual(record["original_filename"], "ads-export.csv")
        self.assertEqual(record["file_hash"], "abc123")
        self.assertEqual(record["platform"], "meta")
        self.assertEqual(record["import_job_id"], JOB["import_job_id"])

    def test_an_invented_code_is_refused_here_rather_than_by_the_database(self):
        with self.assertRaises(ValueError):
            dlq.build_record(job=JOB, error_code="NOPE", error_message="x", stage="validate")

    def test_the_detail_summarises_rather_than_copying_the_file(self):
        rows = [rejection(n, "negative_value") for n in range(2, 20)]
        record = dlq.build_record(
            job=JOB, error_code=dlq.ROW_VALIDATION_FAILED, error_message="18 rows",
            stage="validate", rows_attempted=20, rows_rejected=18, rejected=rows)
        self.assertEqual(record["detail"]["by_reason"], {"negative_value": 18})
        self.assertEqual(len(record["detail"]["sample_rows"]), dlq.SAMPLE_ROWS)
        self.assertEqual(record["detail"]["sample_truncated_from"], 18)

    def test_a_clean_refusal_carries_no_detail(self):
        record = dlq.build_record(
            job=JOB, error_code=dlq.DUPLICATE_BATCH, error_message="already imported",
            stage="hash_dedupe")
        self.assertIsNone(record["detail"])

    def test_a_long_message_is_truncated_not_rejected(self):
        record = dlq.build_record(
            job=JOB, error_code=dlq.UNKNOWN, error_message="x" * 5000, stage="upsert_target")
        self.assertEqual(len(record["error_message"]), 2000)


if __name__ == "__main__":
    unittest.main()
