# Ingestion KPI results

Produced by `python3 -m pytest tests/test_ingestion_kpi.py -v`, started 2026-10-07T18:52:56+00:00.

Every row below is one of the 35 frozen fixtures in `tests/fixtures/`, uploaded to the cloud Supabase project the way `/imports` uploads a merchant's file and run through the real `buzzly_import_pipeline` DAG. Expected values are the declared intent in `tests/fixtures/MANIFEST.json`, written by reading the pipeline's rules and never by running it.

## Summary

- **KPI-2 — Ingestion Success: 20/20 (100.0%)** valid files that met their declared outcome in full (status, DLQ record, resolved dataset and storage).
- **KPI-3 — DLQ Capture: 12/12 (100.0%)** malformed files produced a dead-letter record, **12/12 (100.0%)** with the correct error code, **12/12 (100.0%)** with zero rows leaked into the fact tables and an empty staging buffer.
- `fix_13` is excluded from the KPI-3 denominator as a documented known failure (12 scored, not 13). See below.
- `aux/` files are excluded from both denominators: they parse but have no target table, and a file that succeeds while storing nothing is not an ingestion success (limitation L-2).

- **Rows leaked** into the fact tables from files that must store nothing: **0**, across all six tables `promote_batch` writes plus `ingestion_staging`.
- **Jobs whose status never settled** within 90s: **none**.
- **Fixtures that went through the status-settle wait** (their DagRun reached a terminal state before `import_jobs.status` did): `valid/ok_01_meta_en_iso_plain.csv` (0.3s), `valid/ok_20_duplicate_of_ok_01.csv` (0.5s), `valid/ok_02_meta_th_be_slash_baht.csv` (0.3s), `valid/ok_03_meta_th_month_name.csv` (0.3s), `valid/ok_04_tiktok_iso.csv` (0.3s), `valid/ok_05_shopee_ads_baht_word.csv` (0.3s), `valid/ok_06_minimal_columns.csv` (0.4s), `valid/ok_07_meta_en_utf8_bom.csv` (0.3s), `valid/ok_08_thai_invisibles_ict_column.csv` (0.3s), `valid/ok_09_semicolon_delimiter.csv` (0.3s), `valid/ok_10_tab_delimiter.csv` (0.3s), `valid/ok_11_title_banner_ict.csv` (0.3s), `valid/ok_12_blank_and_totals_rows.csv` (0.3s), `valid/ok_13_cp874_thai.csv` (0.3s), `valid/ok_14_unmapped_extra_columns.csv` (0.3s), `valid/ok_15_empty_optional_cells.csv` (0.3s), `valid/ok_16_large_120_rows.csv` (0.3s), `valid/ok_17_lf_line_endings.csv` (0.4s), `valid/ok_18_quoted_commas_in_thai.csv` (0.3s), `valid/ok_19_mixed_date_formats.csv` (0.3s), `malformed/fix_01_SCHEMA_MISMATCH.csv` (0.4s), `malformed/fix_02_SCHEMA_MISMATCH.csv` (0.3s), `malformed/fix_03_SCHEMA_MISMATCH.csv` (0.3s), `malformed/fix_04_TYPE_COERCION_FAILED.csv` (0.4s), `malformed/fix_05_TYPE_COERCION_FAILED.csv` (0.4s), `malformed/fix_06_TYPE_COERCION_FAILED.csv` (0.3s), `malformed/fix_07_EMPTY_PAYLOAD.csv` (0.6s), `malformed/fix_08_EMPTY_PAYLOAD.csv` (0.3s), `malformed/fix_09_EMPTY_PAYLOAD.csv` (0.3s), `malformed/fix_10_ROW_VALIDATION_FAILED.csv` (0.5s), `malformed/fix_11_ROW_VALIDATION_FAILED.csv` (0.8s), `malformed/fix_12_ROW_VALIDATION_FAILED.csv` (0.3s), `malformed/fix_13_ENCODING_ERROR.csv` (0.3s), `aux/aux_01_shopee_income.csv` (0.3s), `aux/aux_02_product_cogs.csv` (0.3s)

1 case(s) failed.

## Live data left untouched

Every write and delete this suite makes is scoped to one workspace it creates (`a469ee15-74f5-583e-bf96-7dedfb86c235`). These are the row counts *outside* that workspace, which are reserved for other measurements and must not move:

| Table (rows outside the test workspace) | Expected | At suite start | At suite end |
|---|---|---|---|
| `ad_insights` | 998 | 998 | 998 |
| `import_jobs` | 3 | 3 | 3 |
| `ingestion_dlq` | 2 | 2 | 2 |

The reset between fixtures counts every filter before it deletes anything and aborts the whole suite above 2000 rows in any one table — a hard stop between a scoping bug and live data, checked before the first delete rather than after the last.

## KPI-2 — Ingestion Success (20 valid files)

`ok_20` is the duplicate no-op: it succeeds for the merchant, writes a `DUPLICATE_BATCH` record for the engineer, and must store no second copy of `ok_01`'s rows. It runs immediately after `ok_01` with no reset in between, and the suite refuses to run it if that earlier import is not present.

| File | Expected — status / DLQ / dataset / storage | Actual | Verdict |
|---|---|---|---|
| `valid/ok_01_meta_en_iso_plain.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (12/12 rows, 45 table rows, 24.3s) | pass |
| `valid/ok_02_meta_th_be_slash_baht.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (12/12 rows, 45 table rows, 30.4s) | pass |
| `valid/ok_03_meta_th_month_name.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (12/12 rows, 45 table rows, 27.4s) | pass |
| `valid/ok_04_tiktok_iso.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (12/12 rows, 45 table rows, 24.3s) | pass |
| `valid/ok_05_shopee_ads_baht_word.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (10/10 rows, 26 table rows, 27.4s) | pass |
| `valid/ok_06_minimal_columns.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (10/10 rows, 36 table rows, 27.4s) | pass |
| `valid/ok_07_meta_en_utf8_bom.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (12/12 rows, 45 table rows, 24.3s) | pass |
| `valid/ok_08_thai_invisibles_ict_column.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (12/12 rows, 45 table rows, 24.3s) | pass |
| `valid/ok_09_semicolon_delimiter.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (10/10 rows, 39 table rows, 27.4s) | pass |
| `valid/ok_10_tab_delimiter.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (10/10 rows, 39 table rows, 30.4s) | pass |
| `valid/ok_11_title_banner_ict.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (12/12 rows, 45 table rows, 27.3s) | pass |
| `valid/ok_12_blank_and_totals_rows.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (10/10 rows, 39 table rows, 24.3s) | pass |
| `valid/ok_13_cp874_thai.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (10/10 rows, 39 table rows, 27.4s) | pass |
| `valid/ok_14_unmapped_extra_columns.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (12/12 rows, 42 table rows, 27.4s) | pass |
| `valid/ok_15_empty_optional_cells.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (12/12 rows, 45 table rows, 27.4s) | pass |
| `valid/ok_16_large_120_rows.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (120/120 rows, 249 table rows, 30.4s) | pass |
| `valid/ok_17_lf_line_endings.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (10/10 rows, 39 table rows, 24.3s) | pass |
| `valid/ok_18_quoted_commas_in_thai.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (10/10 rows, 39 table rows, 24.3s) | pass |
| `valid/ok_19_mixed_date_formats.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (12/12 rows, 45 table rows, 24.4s) | pass |
| `valid/ok_20_duplicate_of_ok_01.csv` | succeeded / DUPLICATE_BATCH / — / stores nothing | succeeded / DUPLICATE_BATCH / — / stores nothing (0/0 rows, 0 table rows, 18.3s) | pass |

## KPI-3 — DLQ Capture (12 scored malformed files)

Every file here must be refused with **zero** rows in the six tables `promote_batch` writes and an empty `ingestion_staging`. `fix_08` and `fix_09` end `succeeded` on purpose: nothing is wrong with an empty file, so the merchant is told so, and the DLQ still counts it.

| File | Expected — status / DLQ / dataset / storage | Actual | Verdict |
|---|---|---|---|
| `malformed/fix_01_SCHEMA_MISMATCH.csv` | failed / SCHEMA_MISMATCH / ad_performance / stores nothing | failed / SCHEMA_MISMATCH / ad_performance / stores nothing (0/8 rows, 0 table rows, 21.3s) | pass |
| `malformed/fix_02_SCHEMA_MISMATCH.csv` | failed / SCHEMA_MISMATCH / ad_performance / stores nothing | failed / SCHEMA_MISMATCH / ad_performance / stores nothing (0/8 rows, 0 table rows, 21.3s) | pass |
| `malformed/fix_03_SCHEMA_MISMATCH.csv` | failed / SCHEMA_MISMATCH / — / stores nothing | failed / SCHEMA_MISMATCH / — / stores nothing (0/0 rows, 0 table rows, 18.3s) | pass |
| `malformed/fix_04_TYPE_COERCION_FAILED.csv` | failed / TYPE_COERCION_FAILED / ad_performance / stores nothing | failed / TYPE_COERCION_FAILED / ad_performance / stores nothing (0/9 rows, 0 table rows, 27.4s) | pass |
| `malformed/fix_05_TYPE_COERCION_FAILED.csv` | failed / TYPE_COERCION_FAILED / ad_performance / stores nothing | failed / TYPE_COERCION_FAILED / ad_performance / stores nothing (0/9 rows, 0 table rows, 27.4s) | pass |
| `malformed/fix_06_TYPE_COERCION_FAILED.csv` | failed / TYPE_COERCION_FAILED / ad_performance / stores nothing | failed / TYPE_COERCION_FAILED / ad_performance / stores nothing (0/9 rows, 0 table rows, 24.3s) | pass |
| `malformed/fix_07_EMPTY_PAYLOAD.csv` | failed / EMPTY_PAYLOAD / — / stores nothing | failed / EMPTY_PAYLOAD / — / stores nothing (0/0 rows, 0 table rows, 21.3s) | pass |
| `malformed/fix_08_EMPTY_PAYLOAD.csv` | succeeded / EMPTY_PAYLOAD / ad_performance / stores nothing | succeeded / EMPTY_PAYLOAD / ad_performance / stores nothing (0/0 rows, 0 table rows, 21.3s) | pass |
| `malformed/fix_09_EMPTY_PAYLOAD.csv` | succeeded / EMPTY_PAYLOAD / ad_performance / stores nothing | succeeded / EMPTY_PAYLOAD / ad_performance / stores nothing (0/0 rows, 0 table rows, 21.3s) | pass |
| `malformed/fix_10_ROW_VALIDATION_FAILED.csv` | failed / ROW_VALIDATION_FAILED / ad_performance / stores nothing | failed / ROW_VALIDATION_FAILED / ad_performance / stores nothing (0/9 rows, 0 table rows, 36.5s) | pass |
| `malformed/fix_11_ROW_VALIDATION_FAILED.csv` | failed / ROW_VALIDATION_FAILED / ad_performance / stores nothing | failed / ROW_VALIDATION_FAILED / ad_performance / stores nothing (0/9 rows, 0 table rows, 27.4s) | pass |
| `malformed/fix_12_ROW_VALIDATION_FAILED.csv` | failed / ROW_VALIDATION_FAILED / ad_performance / stores nothing | failed / ROW_VALIDATION_FAILED / ad_performance / stores nothing (0/8 rows, 0 table rows, 30.5s) | pass |
| `malformed/fix_13_ENCODING_ERROR.csv` | failed / ENCODING_ERROR / — / stores nothing | failed / ENCODING_ERROR / — / stores nothing (0/0 rows, 0 table rows, 18.3s) | **FAIL** — XPASS — fix_13 now produces ENCODING_ERROR, so the reader bug appears fixed. Update MANIFEST.md and remove the xfail; do not leave this reporting a stale known failure. |

### The known failure

`fix_13` is a UTF-16 BOM with an odd byte count. `reader.py:76` calls `data.decode('utf-16')` outside any try block, so it raises a bare `UnicodeDecodeError` rather than `UnreadableFile`; `detect_format` catches only `UnreadableFile`, so the task crashes, `_write_dlq` is never reached and **no dead-letter row is written at all**. It is asserted against that actual behaviour and excluded from the KPI-3 denominator. The fix belongs to a separate, approved session, so that the write-up has a before and an after instead of an untested patch.

`ENCODING_ERROR` and `UNKNOWN` are unreachable from a merchant's file — the first because `reader.ENCODINGS` ends in `latin-1`, which decodes every possible byte sequence, and the second because it is only written when the commit itself throws. Four of the seven codes are reachable from a malformed file, and that is a finding rather than a gap in the corpus; the reachability table is in `tests/fixtures/MANIFEST.md`.

## Auxiliary — scored under neither KPI

| File | Expected — status / DLQ / dataset / storage | Actual | Verdict |
|---|---|---|---|
| `aux/aux_01_shopee_income.csv` | succeeded / — / shopee_income / stores nothing | succeeded / — / shopee_income / stores nothing (0/0 rows, 0 table rows, 21.3s) | pass |
| `aux/aux_02_product_cogs.csv` | succeeded / — / product_cogs / stores nothing | succeeded / — / product_cogs / stores nothing (0/0 rows, 0 table rows, 21.3s) | pass |

## Run history

The first execution of this suite **aborted**, and it is recorded here rather than quietly replaced, because what stopped it is a result.

The manifest's ordering rule is that `ok_20` runs *immediately* after `ok_01` with no reset in between. The first run took the order the corpus is **listed** in, where `ok_20` sits at the end of the valid group — so eighteen resets ran between the pair, each deleting the workspace's `import_jobs`, including the completed import that is the only reason `ok_20` is a duplicate at all. The order guard (open item A) caught it: `ok_01`–`ok_19` had all passed, and the suite stopped at `ok_20` rather than ingest it as a fresh file and score a KPI-2 pass for a reason with nothing to do with duplicate detection. No `RESULTS.md` was written, by design — a run that aborts in `setUpClass` never reaches the code that writes one, so there is no partial results file carrying a flattering number.

That run is **not** comparable with the ones below: it executed a different order and covered 19 of 35 fixtures. Re-runnability is evidenced by two *completed* runs under the corrected ordering, compared next.

## Re-runnability — this run against the previous one

No earlier archived run to compare against, so this run evidences the KPI numbers but **not** re-runnability. Run the suite once more: the next RESULTS.md compares the two and the comparison is the evidence.

## What `ingestion_staging` holds after a refusal

Step 0's inventory recorded that a refused file stages nothing, and that is **correct**. `stage_rows` has exactly one caller, `ingest_ad_performance`, and `upsert_target` reaches it only past two guards (`buzzly_import_pipeline.py:744-754`): a short-circuited or empty ledger returns at the first, and any quarantined row returns at the second. Every refusal shape in this corpus hits one of them, or fails earlier still in `detect_format` / `parse` and never runs `upsert_target` at all. Measured here: **0 staged rows for every one of the 35 fixtures**, asserted per fixture.

So the earlier concern resolves as **(b) — refused files do not leave orphaned rows, and the change was defensive**. But one half of it was not merely defensive, and it is worth stating plainly:

- **The assertion would have passed vacuously.** `ingestion_batches` rows are written *by* `promote_batch`, so a batch that never promoted has none. Scoping the check as `ingestion_staging WHERE batch_id IN (SELECT batch_id FROM ingestion_batches WHERE team_id = …)` returns the empty set for every refused file — it would have reported a clean buffer without ever looking at one. This suite derives the batch id from the job id instead (the same `uuid5` the pipeline uses), and proves that derivation against a genuinely promoted batch once per run, so an orphaned buffer would actually be seen.
- **The reset SQL had the same blind spot, and there its trigger is real.** A buffer can survive a run that dies between `stage_rows` returning and `promote_batch` committing — a killed container, an OOM. `promote_batch` drops the buffer inside its own transaction and `upsert_target`'s except clause calls `discard_staging_batch`; neither runs if the process disappears between them, and nothing else cleans up. No fixture produces that, so it is recorded as a gap in the reset scoping rather than as a finding about refusals.

## Harness deviations from the production path

Everything this suite does differently from a merchant uploading a file, and why. None of them changes what the pipeline does to a file; they are listed so a reader can check that for themselves.

| Deviation | Why | Effect on the measurement |
|---|---|---|
| The harness claims the job itself (`pending` -> `queued`) between inserting the row and triggering the DAG | Both production trigger paths already do this — the `airflow-trigger` Edge Function and `buzzly_import_sensor` each claim before they trigger. Skipping it would leave the row visible to the sensor for as long as the DagRun took to start, and **two runs would process one file** | None. It is faithfulness to the upload contract, not a shortcut around it |
| The DAG is triggered directly rather than through the webhook or the sensor | The webhook is inert in local development (a Supabase Edge Function cannot reach an Airflow on `localhost`), and the sensor polls every two minutes | Changes when a run starts, never what it does |
| The test workspace is created by the harness, borrowing `owner_id` from an existing workspace | `workspaces.owner_id` is NOT NULL and references a real auth user; a test harness has no business minting users | None. The borrowed value only satisfies a foreign key — nothing else of that owner's is read or written |
| After the DagRun reaches a terminal state, the harness waits up to 90s for `import_jobs.status` to settle | **A measurement artifact, not a pipeline defect.** A DagRun reaching `failed` is not the moment the job reaches its terminal status: when a task crashes without writing one itself, the status comes from the DAG-level `on_failure_callback`, which Airflow runs *after* it marks the run failed — about five seconds on this instance. Reading `import_jobs` the instant the run ended caught `fix_13` still at `running` | A fixture whose status has not settled inside the grace is scored **FAIL** and **stays in its denominator**. It is never skipped and never excluded, because an inconclusive fixture dropping out would inflate the KPI |

## Evidence

- `tests/evidence/dlq_dump.csv` — every dead-letter row this run produced, assembled per fixture (the reset between fixtures clears the table, so the dump is collected as the run goes rather than read at the end).
- `tests/fixtures/MANIFEST.md` — the declared spec, its per-file reasoning, the error-code reachability analysis and limitations L-1 to L-3.
