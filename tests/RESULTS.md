# KPI results

This file holds **two independent measurements** with different provenance. Do not read a number from one as evidence for the other.

| | Command | Measures |
|---|---|---|
| **KPI-1** | `python3 tests/verify_reconcile.py --export <csv>` | whether stored `meta_live` rows equal what Meta's own reporting layer prints |
| **KPI-2 / KPI-3** | `python3 -m pytest tests/test_ingestion_kpi.py -v` | whether the file-upload pipeline ingests valid files and dead-letters malformed ones |

The ingestion run below started 2026-08-10T09:52:08+00:00. Every row in its tables is one of the 35 frozen fixtures in `tests/fixtures/`, uploaded to the cloud Supabase project the way `/imports` uploads a merchant's file and run through the real `buzzly_import_pipeline` DAG. Expected values are the declared intent in `tests/fixtures/MANIFEST.json`, written by reading the pipeline's rules and never by running it.

## Summary

- **KPI-1 — Reconciliation vs Meta Ads Manager: verdict FAIL, on coverage alone.** Every metric compared is exact — **0.0000% aggregate error on all five** (impressions, clicks, spend, CTR, CPC) against a ≤0.5% gate, **81/81 cells exact across 27/27 matched rows**. The run fails because the database holds **4 rows the export does not**. All four carry zero in every KPI-1 metric, so no delivery is unaccounted for; the failure is a row-set disagreement, not an arithmetic one. Details and the open decision below.
- **KPI-2 — Ingestion Success: 20/20 (100.0%)** valid files that met their declared outcome in full (status, DLQ record, resolved dataset and storage).
- **KPI-3 — DLQ Capture: 12/12 (100.0%)** malformed files produced a dead-letter record, **12/12 (100.0%)** with the correct error code, **12/12 (100.0%)** with zero rows leaked into the fact tables and an empty staging buffer.
- `fix_13` is excluded from the KPI-3 denominator as a documented known failure (12 scored, not 13). See below.
- `aux/` files are excluded from both denominators: they parse but have no target table, and a file that succeeds while storing nothing is not an ingestion success (limitation L-2).

- **Rows leaked** into the fact tables from files that must store nothing: **0**, across all six tables `promote_batch` writes plus `ingestion_staging`.
- **Jobs whose status never settled** within 90s: **none**.
- **Fixtures that went through the status-settle wait** (their DagRun reached a terminal state before `import_jobs.status` did): `valid/ok_01_meta_en_iso_plain.csv` (0.2s), `valid/ok_20_duplicate_of_ok_01.csv` (0.2s), `valid/ok_02_meta_th_be_slash_baht.csv` (0.2s), `valid/ok_03_meta_th_month_name.csv` (0.2s), `valid/ok_04_tiktok_iso.csv` (0.3s), `valid/ok_05_shopee_ads_baht_word.csv` (0.2s), `valid/ok_06_minimal_columns.csv` (0.2s), `valid/ok_07_meta_en_utf8_bom.csv` (0.2s), `valid/ok_08_thai_invisibles_ict_column.csv` (0.2s), `valid/ok_09_semicolon_delimiter.csv` (0.2s), `valid/ok_10_tab_delimiter.csv` (0.2s), `valid/ok_11_title_banner_ict.csv` (0.2s), `valid/ok_12_blank_and_totals_rows.csv` (0.2s), `valid/ok_13_cp874_thai.csv` (0.2s), `valid/ok_14_unmapped_extra_columns.csv` (0.3s), `valid/ok_15_empty_optional_cells.csv` (0.2s), `valid/ok_16_large_120_rows.csv` (0.2s), `valid/ok_17_lf_line_endings.csv` (0.2s), `valid/ok_18_quoted_commas_in_thai.csv` (0.2s), `valid/ok_19_mixed_date_formats.csv` (0.6s), `malformed/fix_01_SCHEMA_MISMATCH.csv` (0.2s), `malformed/fix_02_SCHEMA_MISMATCH.csv` (0.3s), `malformed/fix_03_SCHEMA_MISMATCH.csv` (0.2s), `malformed/fix_04_TYPE_COERCION_FAILED.csv` (0.2s), `malformed/fix_05_TYPE_COERCION_FAILED.csv` (0.2s), `malformed/fix_06_TYPE_COERCION_FAILED.csv` (0.2s), `malformed/fix_07_EMPTY_PAYLOAD.csv` (0.3s), `malformed/fix_08_EMPTY_PAYLOAD.csv` (0.2s), `malformed/fix_09_EMPTY_PAYLOAD.csv` (0.2s), `malformed/fix_10_ROW_VALIDATION_FAILED.csv` (0.2s), `malformed/fix_11_ROW_VALIDATION_FAILED.csv` (0.3s), `malformed/fix_12_ROW_VALIDATION_FAILED.csv` (0.2s), `malformed/fix_13_ENCODING_ERROR.csv` (0.3s), `aux/aux_01_shopee_income.csv` (0.2s), `aux/aux_02_product_cogs.csv` (0.3s)

All cases passed.

## KPI-1 — Reconciliation against Meta Ads Manager

Measured **2026-08-13T05:48:23+00:00**.

```
python3 tests/verify_reconcile.py --export "RealCSV/รายงานที่ไม่มีชื่อ-ก.ค.-10-2025-ถึง-ส.ค.-12-2026.csv"
```

Report: `reports/reconciliation-20260813T054823Z.json` · `tests/RECONCILIATION.md` · exit **1**.

| | |
|---|---|
| Ground truth | Ads Reporting pivot export, level = Ad, time breakdown = Day |
| Export sha256 | `c3165f75f286d2707a3ba65fbb49f502bfcbc31ff357536aa0cc6a1531439646` |
| Header language | th |
| Window | 2025-07-10 → 2026-08-12 |
| Grain | ad × day |
| Compared against | `ad_insights` where `data_source = 'meta_live'`, ad account `336e1785…` |
| Tolerance gate | ≤ 0.5% aggregate error |

The database side was synced from the Graph API at 05:06Z, **40 minutes before** the export was pulled. That ordering is load-bearing, not incidental — see L-6 and "Why the sitting matters" below.

### Tier A — delivery (gates the verdict)

| Metric | Export | Database | Aggregate error | Gate ≤0.5% | Rows exact |
|---|---|---|---|---|---|
| impressions | 16,893 | 16,893 | **0.0000%** | pass | 27/27 |
| clicks | 1,530 | 1,530 | **0.0000%** | pass | 27/27 |
| spend | ฿1,350.08 | ฿1,350.08 | **0.0000%** | pass | 27/27 |

Max per-row error 0.0000% on all three. Undefined rows: 0. **Cells exact: 81/81.**

### Tier B — derived (gates the verdict)

| Metric | Export | Database | Aggregate error | Gate ≤0.5% | Rows exact |
|---|---|---|---|---|---|
| CTR | 9.057005860415556739477890250 | 9.057005860415556739477890250 | **0.0000%** | pass | 24/24 |
| CPC | 0.8824052287581699346405228758 | 0.8824052287581699346405228758 | **0.0000%** | pass | 22/22 |

**Both sides are recomputed from raw `clicks` / `impressions` / `spend` in `Decimal`; neither reads the export's `CTR (ทั้งหมด)` or `CPC (ทั้งหมด)` columns.** This is structural rather than a policy that could drift: `ReconcileRow` (`reconcile_lib.py:64`) declares only `ad_id, date, impressions, clicks, spend, conversions` — the export's pre-rounded rate columns have nowhere to land and cannot reach the comparison. `_rate` divides `Decimal` by `Decimal` and returns `None` on a zero denominator, which is why the row counts differ from tier A's 27: three rows have zero impressions (CTR undefined) and five have zero clicks (CPC undefined). Those rows are excluded from the rate comparison, never scored as zero.

The digits above are unrounded on purpose. Rounding them to 2 dp would hide whether the two sides agree to the last place, which is the only thing this tier measures.

### Tier C — attribution (reported only, never gates)

| Metric | Export | Database | Aggregate error | Rows exact |
|---|---|---|---|---|
| conversions | 389 | 29 | 92.5450% | 3/22 |

Excluded from the verdict by design (`reconcile_lib.py:530`). The export's result type is `การสนทนาผ่านการส่งข้อความที่เริ่มขึ้น` — messaging conversations started — while the connector maps `conversions` to purchase actions only, and the two sides may also use different attribution windows. This is limitation **L-5**, not a pipeline defect. It is printed rather than suppressed because a metric that silently stops being compared is worse than one that visibly disagrees.

### Coverage — why the verdict is FAIL

| | |
|---|---|
| Rows in export | 27 |
| Rows in database | 31 |
| Matched on (ad_id, day) | **27** |
| Only in export | **0** |
| Only in database | **4** |

The grand-total pivot row was skipped by name, logged as `reason: "no ad id"`, and never parsed as data.

The four database-only rows, read from `ad_insights` directly rather than inferred:

| Ad id | Day | impressions | clicks | spend | reach | conversions |
|---|---|---|---|---|---|---|
| 120229666005010481 | 2025-07-20 | 0 | 0 | ฿0 | 0 | 0 |
| 120229666005010481 | 2025-07-21 | 0 | 0 | ฿0 | 0 | 0 |
| 120238826064120481 | 2025-12-16 | 0 | 0 | ฿0 | 0 | 0 |
| 120238826064120481 | 2025-12-17 | 0 | 0 | ฿0 | 0 | 0 |

**All four are zero-delivery in every KPI-1 metric.** Adding them to the export side would move no tier-A total by any amount, so the 0.0000% figures above are not concealing absent spend.

**But the rule is not "Ads Reporting drops zero-delivery rows", and that guess should not be written down as the explanation.** The database holds **seven** zero-delivery rows for this window, and **three of them are present in the export** carrying explicit `0`:

| Ad id | Day | In export? |
|---|---|---|
| 120229666005010481 | 2025-07-16 | present, explicit `0` |
| 120229666005010481 | 2025-07-17 | present, explicit `0` |
| 120229666005010481 | 2025-07-19 | present, explicit `0` |
| 120229666005010481 | 2025-07-20 | **dropped** |
| 120229666005010481 | 2025-07-21 | **dropped** |
| 120238826064120481 | 2025-12-16 | **dropped** |
| 120238826064120481 | 2025-12-17 | **dropped** |

What the four dropped rows have in common is position, not value: in both ads they are the **final two days of that ad's row set**, and every interior zero day survives. With two ads that is a description of the observed data, **not a confirmed mechanism** — it is recorded here as unexplained rather than resolved, because a plausible story about why an export omits rows is exactly the kind of thing that gets quoted later as if it had been measured.

### Open decision (not taken here)

The verdict is FAIL and is left FAIL. Making it pass would require either widening the tolerance or teaching the coverage gate that a database-only row whose every gated metric is zero does not count against coverage. **Both are logic changes to the measurement, and neither is a thing to do in the same sitting as the run that motivated it** — the founder decides, with this result as the before. Per CLAUDE.md §9 a failing check is a result, and a documented failure with an understood cause is worth more than a green one obtained by moving the line.

### Negative controls

A table of 0.0000% errors is indistinguishable from a harness that compared nothing, so the run perturbs its own input and requires the verdict to change.

| Control | Required | Result |
|---|---|---|
| M1 — one impression +1 | tier A must FAIL while coverage still passes | **N/A** — see below |
| M2 — one row removed | coverage must FAIL while remaining cells stay exact | **FAIL as required** (78 cells still exact) |
| F — same export vs fixture rows (`data_source='mock'`, 82 rows) | must FAIL | **FAIL as required** |

**M1 did not run, and the reason is this run's own coverage failure.** M1 asserts "the metric gate fires *while coverage passes*"; when the baseline already fails coverage, every mutated comparison fails coverage too and the mutation proves nothing about the metric gate. The harness detects this and returns `N/A` rather than a misleading pass (`verify_reconcile.py:186-200`). So **two of three controls fired here, not three.** The compensating evidence is that the coverage gate is demonstrably live — it is what produced this run's FAIL. The metric gate's own demonstration is the 3-day run earlier the same day (`reports/reconciliation-20260813T052900Z.json`), whose coverage passed and where M1 returned FAIL as required.

### Why the sitting matters — L-6, demonstrated

The 3-day run at 05:29Z gives a direct measurement of what a gap between sync and export costs. Over 2026-08-10 → 2026-08-12 the database held **885 impressions / 15 clicks / ฿114.92** before that morning's sync, against the export's **1,170 / 20 / ฿148.59**. Tier A would have failed all three metrics. After the sync both sides read 1,170 / 20 / ฿148.59 and the run passed 9/9.

So `sync → export → verify, same sitting, no gap` is not a precaution — it is the difference between a pass and a three-metric failure, measured. Meta's restatement behaviour behind it is recorded in `tests/evidence/meta_live_sync/`, including reach-only restatements on rows up to thirteen months old. **`reach` is not a KPI-1 metric and is deliberately absent from every table above**; it is Limitations evidence only and is never entered into the error calculation.

---

*Everything from here to "Evidence" concerns the ingestion suite (KPI-2 / KPI-3) and is unrelated to the reconciliation above.*

## Live data left untouched

Every write and delete this suite makes is scoped to one workspace it creates (`a469ee15-74f5-583e-bf96-7dedfb86c235`). These are the row counts *outside* that workspace, which are reserved for other measurements and must not move:

| Table (rows outside the test workspace) | Expected | At suite start | At suite end |
|---|---|---|---|
| `ad_insights` | 881 | 881 | 881 |
| `import_jobs` | 9 | 9 | 9 |
| `ingestion_dlq` | 3 | 3 | 3 |

The reset between fixtures counts every filter before it deletes anything and aborts the whole suite above 2000 rows in any one table — a hard stop between a scoping bug and live data, checked before the first delete rather than after the last.

## KPI-2 — Ingestion Success (20 valid files)

`ok_20` is the duplicate no-op: it succeeds for the merchant, writes a `DUPLICATE_BATCH` record for the engineer, and must store no second copy of `ok_01`'s rows. It runs immediately after `ok_01` with no reset in between, and the suite refuses to run it if that earlier import is not present.

| File | Expected — status / DLQ / dataset / storage | Actual | Verdict |
|---|---|---|---|
| `valid/ok_01_meta_en_iso_plain.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (12/12 rows, 45 table rows, 21.3s) | pass |
| `valid/ok_02_meta_th_be_slash_baht.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (12/12 rows, 45 table rows, 21.3s) | pass |
| `valid/ok_03_meta_th_month_name.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (12/12 rows, 45 table rows, 21.3s) | pass |
| `valid/ok_04_tiktok_iso.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (12/12 rows, 45 table rows, 24.4s) | pass |
| `valid/ok_05_shopee_ads_baht_word.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (10/10 rows, 26 table rows, 18.3s) | pass |
| `valid/ok_06_minimal_columns.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (10/10 rows, 36 table rows, 21.3s) | pass |
| `valid/ok_07_meta_en_utf8_bom.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (12/12 rows, 45 table rows, 21.3s) | pass |
| `valid/ok_08_thai_invisibles_ict_column.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (12/12 rows, 45 table rows, 24.3s) | pass |
| `valid/ok_09_semicolon_delimiter.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (10/10 rows, 39 table rows, 21.3s) | pass |
| `valid/ok_10_tab_delimiter.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (10/10 rows, 39 table rows, 21.3s) | pass |
| `valid/ok_11_title_banner_ict.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (12/12 rows, 45 table rows, 21.3s) | pass |
| `valid/ok_12_blank_and_totals_rows.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (10/10 rows, 39 table rows, 21.3s) | pass |
| `valid/ok_13_cp874_thai.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (10/10 rows, 39 table rows, 21.3s) | pass |
| `valid/ok_14_unmapped_extra_columns.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (12/12 rows, 42 table rows, 21.3s) | pass |
| `valid/ok_15_empty_optional_cells.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (12/12 rows, 45 table rows, 24.3s) | pass |
| `valid/ok_16_large_120_rows.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (120/120 rows, 249 table rows, 21.3s) | pass |
| `valid/ok_17_lf_line_endings.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (10/10 rows, 39 table rows, 21.3s) | pass |
| `valid/ok_18_quoted_commas_in_thai.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (10/10 rows, 39 table rows, 21.3s) | pass |
| `valid/ok_19_mixed_date_formats.csv` | succeeded / — / ad_performance / ingests | succeeded / — / ad_performance / ingests (12/12 rows, 45 table rows, 21.3s) | pass |
| `valid/ok_20_duplicate_of_ok_01.csv` | succeeded / DUPLICATE_BATCH / — / stores nothing | succeeded / DUPLICATE_BATCH / — / stores nothing (0/0 rows, 0 table rows, 21.3s) | pass |

## KPI-3 — DLQ Capture (12 scored malformed files)

Every file here must be refused with **zero** rows in the six tables `promote_batch` writes and an empty `ingestion_staging`. `fix_08` and `fix_09` end `succeeded` on purpose: nothing is wrong with an empty file, so the merchant is told so, and the DLQ still counts it.

| File | Expected — status / DLQ / dataset / storage | Actual | Verdict |
|---|---|---|---|
| `malformed/fix_01_SCHEMA_MISMATCH.csv` | failed / SCHEMA_MISMATCH / ad_performance / stores nothing | failed / SCHEMA_MISMATCH / ad_performance / stores nothing (0/8 rows, 0 table rows, 21.3s) | pass |
| `malformed/fix_02_SCHEMA_MISMATCH.csv` | failed / SCHEMA_MISMATCH / ad_performance / stores nothing | failed / SCHEMA_MISMATCH / ad_performance / stores nothing (0/8 rows, 0 table rows, 21.3s) | pass |
| `malformed/fix_03_SCHEMA_MISMATCH.csv` | failed / SCHEMA_MISMATCH / — / stores nothing | failed / SCHEMA_MISMATCH / — / stores nothing (0/0 rows, 0 table rows, 18.3s) | pass |
| `malformed/fix_04_TYPE_COERCION_FAILED.csv` | failed / TYPE_COERCION_FAILED / ad_performance / stores nothing | failed / TYPE_COERCION_FAILED / ad_performance / stores nothing (0/9 rows, 0 table rows, 18.3s) | pass |
| `malformed/fix_05_TYPE_COERCION_FAILED.csv` | failed / TYPE_COERCION_FAILED / ad_performance / stores nothing | failed / TYPE_COERCION_FAILED / ad_performance / stores nothing (0/9 rows, 0 table rows, 21.3s) | pass |
| `malformed/fix_06_TYPE_COERCION_FAILED.csv` | failed / TYPE_COERCION_FAILED / ad_performance / stores nothing | failed / TYPE_COERCION_FAILED / ad_performance / stores nothing (0/9 rows, 0 table rows, 21.3s) | pass |
| `malformed/fix_07_EMPTY_PAYLOAD.csv` | failed / EMPTY_PAYLOAD / — / stores nothing | failed / EMPTY_PAYLOAD / — / stores nothing (0/0 rows, 0 table rows, 18.3s) | pass |
| `malformed/fix_08_EMPTY_PAYLOAD.csv` | succeeded / EMPTY_PAYLOAD / ad_performance / stores nothing | succeeded / EMPTY_PAYLOAD / ad_performance / stores nothing (0/0 rows, 0 table rows, 18.2s) | pass |
| `malformed/fix_09_EMPTY_PAYLOAD.csv` | succeeded / EMPTY_PAYLOAD / ad_performance / stores nothing | succeeded / EMPTY_PAYLOAD / ad_performance / stores nothing (0/0 rows, 0 table rows, 18.3s) | pass |
| `malformed/fix_10_ROW_VALIDATION_FAILED.csv` | failed / ROW_VALIDATION_FAILED / ad_performance / stores nothing | failed / ROW_VALIDATION_FAILED / ad_performance / stores nothing (0/9 rows, 0 table rows, 21.3s) | pass |
| `malformed/fix_11_ROW_VALIDATION_FAILED.csv` | failed / ROW_VALIDATION_FAILED / ad_performance / stores nothing | failed / ROW_VALIDATION_FAILED / ad_performance / stores nothing (0/9 rows, 0 table rows, 21.3s) | pass |
| `malformed/fix_12_ROW_VALIDATION_FAILED.csv` | failed / ROW_VALIDATION_FAILED / ad_performance / stores nothing | failed / ROW_VALIDATION_FAILED / ad_performance / stores nothing (0/8 rows, 0 table rows, 21.3s) | pass |
| `malformed/fix_13_ENCODING_ERROR.csv` | failed / ENCODING_ERROR / — / stores nothing | failed / — / — / stores nothing (0/0 rows, 0 table rows, 81.9s) | xfail (as documented) |

### The known failure

`fix_13` is a UTF-16 BOM with an odd byte count. `reader.py:76` calls `data.decode('utf-16')` outside any try block, so it raises a bare `UnicodeDecodeError` rather than `UnreadableFile`; `detect_format` catches only `UnreadableFile`, so the task crashes, `_write_dlq` is never reached and **no dead-letter row is written at all**. It is asserted against that actual behaviour and excluded from the KPI-3 denominator. The fix belongs to a separate, approved session, so that the write-up has a before and an after instead of an untested patch.

`ENCODING_ERROR` and `UNKNOWN` are unreachable from a merchant's file — the first because `reader.ENCODINGS` ends in `latin-1`, which decodes every possible byte sequence, and the second because it is only written when the commit itself throws. Four of the seven codes are reachable from a malformed file, and that is a finding rather than a gap in the corpus; the reachability table is in `tests/fixtures/MANIFEST.md`.

## Auxiliary — scored under neither KPI

| File | Expected — status / DLQ / dataset / storage | Actual | Verdict |
|---|---|---|---|
| `aux/aux_01_shopee_income.csv` | succeeded / — / shopee_income / stores nothing | succeeded / — / shopee_income / stores nothing (0/0 rows, 0 table rows, 18.3s) | pass |
| `aux/aux_02_product_cogs.csv` | succeeded / — / product_cogs / stores nothing | succeeded / — / product_cogs / stores nothing (0/0 rows, 0 table rows, 18.3s) | pass |

## Run history

The first execution of this suite **aborted**, and it is recorded here rather than quietly replaced, because what stopped it is a result.

The manifest's ordering rule is that `ok_20` runs *immediately* after `ok_01` with no reset in between. The first run took the order the corpus is **listed** in, where `ok_20` sits at the end of the valid group — so eighteen resets ran between the pair, each deleting the workspace's `import_jobs`, including the completed import that is the only reason `ok_20` is a duplicate at all. The order guard (open item A) caught it: `ok_01`–`ok_19` had all passed, and the suite stopped at `ok_20` rather than ingest it as a fresh file and score a KPI-2 pass for a reason with nothing to do with duplicate detection. No `RESULTS.md` was written, by design — a run that aborts in `setUpClass` never reaches the code that writes one, so there is no partial results file carrying a flattering number.

That run is **not** comparable with the ones below: it executed a different order and covered 19 of 35 fixtures. Re-runnability is evidenced by two *completed* runs under the corrected ordering, compared next.

## Re-runnability — this run against the previous one

Compared against the run started **2026-08-10T09:30:08+00:00** (this run: **2026-08-10T09:52:08+00:00**), on outcome only — `verdict`, `job_status`, `dlq_code`, `dataset`, `rows_total`, `rows_ok`, `rows_quarantined`, `table_delta`, `staged_rows`, `harness_error`. Timings and row ids are excluded: a run that took a second longer is not a different result.

**All 35 fixtures produced identical results in both runs.** That identity is the re-runnability evidence: the corpus is frozen, the workspace is reset to the same state before each fixture, and the pipeline returned the same verdict for every file twice.

The two state-dependent fixtures are called out explicitly, because they are the ones a second run could plausibly have scored differently:

| Fixture | Why it depends on state | Run 1 | Run 2 |
|---|---|---|---|
| `valid/ok_20_duplicate_of_ok_01.csv` | only a duplicate while `ok_01`'s completed import is still present | succeeded / DUPLICATE_BATCH | succeeded / DUPLICATE_BATCH |
| `malformed/fix_12_ROW_VALIDATION_FAILED.csv` | duplicate rows are detected within the file, so it must not depend on state | failed / ROW_VALIDATION_FAILED | failed / ROW_VALIDATION_FAILED |

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

KPI-1:

- `reports/reconciliation-20260813T054823Z.json` — the full-window run reported above, machine-readable.
- `reports/reconciliation-20260813T052900Z.json` — the earlier 3-day run, kept because it is where negative control M1 actually fired and where the before/after sync comparison comes from.
- `tests/RECONCILIATION.md` — the latest run rendered; overwritten by every run, so the JSON files are the durable record.
- `RealCSV/` — the Ads Reporting exports themselves, the ground truth the sha256 in the table above refers to.
- `tests/evidence/meta_live_sync/` — before/after row snapshots and the restatement diff for the 05:06Z sync, with the Limitations write-up.

KPI-2 / KPI-3:

- `tests/evidence/dlq_dump.csv` — every dead-letter row this run produced, assembled per fixture (the reset between fixtures clears the table, so the dump is collected as the run goes rather than read at the end).
- `tests/fixtures/MANIFEST.md` — the declared spec, its per-file reasoning, the error-code reachability analysis and limitations L-1 to L-3.
