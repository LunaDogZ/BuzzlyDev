"""The progress bar on /imports must name the stages the DAG actually runs.

`import_jobs.current_stage` is written by the pipeline in Python and read by
`IMPORT_STAGES` in `src/hooks/useImportJobs.tsx`. Nothing at either end fails
when they disagree: an unknown stage id makes `importStageProgress` return null
and the merchant simply stops seeing progress on a job that is progressing
fine. That silence is exactly why the mismatch would survive a release, so it
is checked here instead.

The TypeScript file is not present inside the Airflow image (only `dags/` and
`fixtures/` are mounted), so this test skips there and runs on the host, which
is where a stage gets renamed.
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

# Self-contained on purpose: `unittest discover` imports these modules in
# alphabetical order, so a module that relied on a sibling to put `dags/` on
# the path would fail or pass depending on its own name.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dags"))

from buzzly_common.pipeline import PROGRESS_STAGES  # noqa: E402

# airflow/tests/ -> airflow/ -> repo root
HOOK_FILE = Path(__file__).resolve().parents[2] / "src" / "hooks" / "useImportJobs.tsx"

_STAGE_BLOCK = re.compile(r"export const IMPORT_STAGES = \[(.*?)\] as const;", re.DOTALL)
_STAGE_ID = re.compile(r'\{\s*id:\s*"([^"]+)"')


def ui_stage_ids() -> list[str]:
    block = _STAGE_BLOCK.search(HOOK_FILE.read_text(encoding="utf-8"))
    if block is None:
        raise AssertionError(
            f"Could not find `export const IMPORT_STAGES = [...] as const;` in {HOOK_FILE}. "
            "If it was renamed or reformatted, update this test with it."
        )
    return _STAGE_ID.findall(block.group(1))


@unittest.skipUnless(HOOK_FILE.is_file(), f"{HOOK_FILE} is not mounted in this environment")
class StageContractTest(unittest.TestCase):
    def test_ui_lists_the_same_stages_in_the_same_order(self):
        self.assertEqual(
            list(PROGRESS_STAGES),
            ui_stage_ids(),
            "IMPORT_STAGES in src/hooks/useImportJobs.tsx has drifted from "
            "buzzly_common.pipeline.PROGRESS_STAGES. The order is the step number "
            "the merchant sees, so both the names and the sequence must match.",
        )

    def test_every_progress_stage_is_written_by_a_task(self):
        """A stage nobody sets is a step the bar can never reach."""
        dag_source = (
            Path(__file__).resolve().parents[1] / "dags" / "buzzly_import_pipeline.py"
        ).read_text(encoding="utf-8")
        for stage in PROGRESS_STAGES:
            with self.subTest(stage=stage):
                self.assertRegex(
                    dag_source,
                    rf'set_stage\([^)]*"{re.escape(stage)}"\)',
                    f"No task in buzzly_import_pipeline.py reports stage {stage!r}",
                )


if __name__ == "__main__":
    unittest.main()
