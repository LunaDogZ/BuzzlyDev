# KPI-2 / KPI-3 re-measure — 2026-10-08

A new dated result set. The 2026-08-10 evidence (`tests/RESULTS.md`,
`tests/evidence/dlq_dump.csv`, `tests/evidence/runs/`) is untouched; this run
wrote here via `KPI_EVIDENCE_DIR`.

**Code under test:** `chore/security-deps` at `ff9acc1` — includes Set B
(B-1/B-2/B-3) and B-4 (`372bd13` reader, `d37f091` DAG parse guard).
**Baseline:** `PROTECTED_BASELINE` re-baselined to 998/3/2 (`ff9acc1`, L-7 open);
held exactly at suite start and end in both runs.

| | Run 1 (18:52:56Z) | Run 2 (19:19:07Z) |
|---|---|---|
| KPI-2 Ingestion Success | **20/20** | **20/20** |
| KPI-3 DLQ Capture (record / correct code / zero leak) | **12/12 · 12/12 · 12/12** | **12/12 · 12/12 · 12/12** |
| fix_13 (excluded, spec frozen) | failed · ENCODING_ERROR · 0 rows → **XPASS** | same |
| pytest | 34 passed, 1 failed (`test_32_fix_13_ENCODING_ERROR`) | same |
| Run-to-run | — | **35/35 fixtures identical** |

**Before → after for fix_13:** 2026-08-10 — task crashed, **no DLQ record**.
2026-10-08 — refused with `ENCODING_ERROR`, job failed, 0 rows written. The
spec still pins the crash, so the suite reports a strict XPASS by design; scored
as the manifest declares it, KPI-3 would read 13/13.

Files: `PER_FILE.md` (per-file table, both runs) · `RESULTS_run1.md`,
`dlq_dump_run1.csv`, `run1.log` · `RESULTS.md`, `dlq_dump.csv`, `run2.log`
(run 2, includes the run-to-run comparison) · `runs/` (both archives).
