"""End to end: every file ends committed or quarantined — through the real DAG.

Runs four hand-built files (from ``airflow/tests/test_parse_guard.py``) through
Airflow against the KPI test workspace, the way ``test_ingestion_kpi`` does:

=====================  =========  ================  =============================
file                   job        DLQ code          rows stored (6 promote tables)
=====================  =========  ================  =============================
valid UTF-16 LE        succeeded  none              2 ad_insights rows (2 days)
valid UTF-16 BE        succeeded  none              0 new — same 2 rows, upserted
truncated UTF-16       failed     ENCODING_ERROR    0
oversized csv field    failed     UNKNOWN           0
=====================  =========  ================  =============================

Expectations are hand-declared from the two literal rows in the fixture.

**Why the LE file runs first, in the same method (CLAUDE.md §12, §13).** "Zero
rows stored" is a before/after count scoped through the workspace's ad
accounts, and a refused file never creates one — so on an empty workspace that
count is 0 whatever happens, and the check could not fail. The LE file must
first prove the scope sees rows (delta 2) before any refusal is measured
against it; the guard below aborts if it did not.

**The protected-count gate is relative here.** ``kpi.PROTECTED_BASELINE`` is
stale (L-7, unresolved), so this test snapshots the live counts when it starts
and holds the harness to *those* for the run — the gate's meaning ("nothing
outside the test workspace changes") is unchanged; the committed constant and
the KPI suite are not touched.

Needs the Airflow stack and the cloud project. Never run beside another
harness run: the test workspace id is a fixed constant (pgrep first).
"""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

import kpi_harness as kpi

_spec = importlib.util.spec_from_file_location(
    "parse_guard_fixtures",
    Path(__file__).resolve().parents[1] / "airflow" / "tests" / "test_parse_guard.py",
)
fixtures = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fixtures)

FILES = [
    ("utf16_le_valid.csv", fixtures.UTF16_LE),
    ("utf16_be_valid.csv", fixtures.UTF16_BE),
    ("utf16_truncated.csv", fixtures.UTF16_TRUNCATED),
    ("oversized_field.csv", fixtures.OVERSIZED_FIELD),
]


class ParseGuardEndToEnd(unittest.TestCase):
    def test_every_file_is_committed_or_quarantined(self):
        db = kpi.Supabase(*kpi.load_service_credentials())
        air = kpi.Airflow()
        air.assert_pipeline_unpaused()
        kpi.ensure_workspace(db)
        kpi.PROTECTED_BASELINE = kpi.protected_counts(db)
        kpi.reset_workspace(db, where="parse-guard start")

        seen = {}
        with tempfile.TemporaryDirectory() as tmp:
            for name, data in FILES:
                path = Path(tmp) / name
                path.write_bytes(data)
                seen[name] = kpi.run_fixture(db, air, {"filename": str(path), "platform": "meta"})
                print(f"{name}: dag={seen[name].dag_state} job={seen[name].job_status} "
                      f"dlq={seen[name].dlq_codes} delta={seen[name].table_delta} "
                      f"msg={seen[name].error_message!r}")

        le = seen["utf16_le_valid.csv"]
        self.assertEqual((le.job_status, le.rows_total, le.rows_ok, le.rows_quarantined),
                         ("succeeded", 2, 2, 0))
        self.assertEqual(le.dlq_codes, [])
        # Order guard + derivation proof: the scope must have seen the LE rows.
        if le.table_delta.get("ad_insights") != 2:
            self.fail(f"UTF-16 LE stored {le.table_delta} — the zero-row checks below "
                      "would be measuring an empty scope, so they are not run.")

        be = seen["utf16_be_valid.csv"]
        self.assertEqual((be.job_status, be.rows_total, be.rows_ok, be.rows_quarantined),
                         ("succeeded", 2, 2, 0))
        self.assertEqual(be.dlq_codes, [])

        for name, code in (("utf16_truncated.csv", "ENCODING_ERROR"),
                           ("oversized_field.csv", "UNKNOWN")):
            obs = seen[name]
            with self.subTest(file=name):
                self.assertEqual(obs.job_status, "failed")
                self.assertEqual(obs.dlq_codes, [code])
                self.assertEqual(obs.rows_landed, 0, obs.table_delta)
                self.assertEqual(obs.staged_rows, 0)

        kpi.reset_workspace(db, where="parse-guard end")


if __name__ == "__main__":
    unittest.main()
