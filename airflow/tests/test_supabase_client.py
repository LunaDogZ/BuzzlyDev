"""`SupabaseClient` request shapes that a wrong answer would hide.

Only the quarantine write is covered here, and deliberately so: it is the one
method whose correctness is a property of *how many requests it makes and in
what order*, which no amount of reading the row back would reveal. Everything
else in the client is a single request whose behaviour is PostgREST's.

The client is exercised through a subclass that records `_request` instead of
sending it. That is the seam worth stubbing — below it is `requests`, above it
is the batching, capping and ordering logic that is ours.
"""

from __future__ import annotations

import os
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "dags"))

from buzzly_common.supabase import ROW_ERRORS_TABLE, SupabaseClient  # noqa: E402


class RecordingClient(SupabaseClient):
    """A client that records requests rather than sending them."""

    def __init__(self) -> None:
        super().__init__("https://example.supabase.co", "service-role-key")
        self.calls: list[tuple[str, str, object]] = []

    def _request(self, method, path, **kwargs):  # type: ignore[override]
        self.calls.append((method, path, kwargs.get("json")))
        return SimpleNamespace(json=lambda: [], content=b"")


def _errors(count: int) -> list[dict]:
    return [
        {
            "row_number": number,
            "raw_row": {"campaign_name": f"row {number}"},
            "column_name": "spend",
            "error_code": "unreadable_number",
            "error_message": "'N/A' is not a number we can read.",
        }
        for number in range(2, count + 2)
    ]


JOB = "11111111-2222-3333-4444-555555555555"


class InsertRowErrorsTests(unittest.TestCase):
    def test_the_jobs_rows_are_deleted_before_any_are_written(self):
        """A retry replaces its own rows; it does not add a second copy.

        `quarantine_bad_rows` carries the DAG's `retries: 2` and rebuilds an
        identical list from the same staged payload, so without this the second
        attempt doubles every rejected row the merchant sees — against a job row
        whose `rows_quarantined` still states the true count.
        """
        client = RecordingClient()
        client.insert_row_errors(JOB, _errors(3))

        methods = [method for method, _, _ in client.calls]
        self.assertEqual(methods, ["DELETE", "POST"])

        _, path, _ = client.calls[0]
        self.assertEqual(path, f"/rest/v1/{ROW_ERRORS_TABLE}?import_job_id=eq.{JOB}")

    def test_the_delete_is_scoped_to_one_job(self):
        """The filter is the whole safety argument — an unscoped DELETE here
        would erase every other import's diagnosis in the workspace."""
        client = RecordingClient()
        client.insert_row_errors(JOB, _errors(1))

        _, path, _ = client.calls[0]
        self.assertIn("?import_job_id=eq.", path)
        self.assertTrue(path.endswith(JOB))

    def test_a_second_identical_call_leaves_the_same_number_of_rows(self):
        """Two attempts, two replacements — not one write and one append."""
        client = RecordingClient()
        first = client.insert_row_errors(JOB, _errors(4))
        second = client.insert_row_errors(JOB, _errors(4))

        self.assertEqual(first, second)
        self.assertEqual([method for method, _, _ in client.calls],
                         ["DELETE", "POST", "DELETE", "POST"])

    def test_no_rejected_rows_sends_nothing_at_all(self):
        """Including no DELETE. The caller guards on `rows_quarantined`, but a
        method that wipes a job's errors when handed an empty list is one
        refactor away from doing it on a file that had none."""
        client = RecordingClient()
        self.assertEqual(client.insert_row_errors(JOB, []), 0)
        self.assertEqual(client.calls, [])

    def test_batching_survives_the_delete(self):
        """One DELETE, then one POST per batch — the cap and the chunking are
        unchanged by the replacement semantics."""
        client = RecordingClient()
        written = client.insert_row_errors(JOB, _errors(client.ERROR_BATCH_SIZE + 1))

        self.assertEqual(written, client.ERROR_BATCH_SIZE + 1)
        self.assertEqual([method for method, _, _ in client.calls],
                         ["DELETE", "POST", "POST"])
        _, _, first_batch = client.calls[1]
        _, _, second_batch = client.calls[2]
        self.assertEqual(len(first_batch), client.ERROR_BATCH_SIZE)
        self.assertEqual(len(second_batch), 1)

    def test_stored_rows_are_capped_but_the_delete_still_runs(self):
        client = RecordingClient()
        written = client.insert_row_errors(JOB, _errors(client.MAX_STORED_ERRORS + 10))

        self.assertEqual(written, client.MAX_STORED_ERRORS)
        self.assertEqual(client.calls[0][0], "DELETE")

    def test_every_written_row_carries_the_job_id(self):
        client = RecordingClient()
        client.insert_row_errors(JOB, _errors(2))

        _, _, batch = client.calls[1]
        self.assertTrue(all(row["import_job_id"] == JOB for row in batch))

    def test_a_long_error_message_is_truncated_to_the_column_width(self):
        client = RecordingClient()
        client.insert_row_errors(JOB, [{"row_number": 2, "error_message": "x" * 900}])

        _, _, batch = client.calls[1]
        self.assertEqual(len(batch[0]["error_message"]), 500)


if __name__ == "__main__":
    unittest.main()
