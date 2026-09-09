# Ingestion pipeline — end-to-end run through the real path, 2026-09-09

**What this is.** The `.csv` ingestion pipeline exercised **the way a merchant
exercises it** — a signed-in user uploading through the app's own API, not a
test harness calling functions directly, and not `service_role` bypassing RLS.
Two files: one that must be accepted whole, one that must be refused whole.

| | |
|---|---|
| **Signed in as** | `e2e@buzzly.test` (an ordinary authenticated user; RLS applied) |
| **Workspace** | `b022da17…` "E2E Walk Workspace" — the only workspace this user can see |
| **Airflow** | local stack, image `buzzly/airflow:3.2.2`, brought up 2026-09-09 19:26 ICT after being down since 2026-07-23 |
| **Trigger path used** | the **sensor** (polls every 2 min), not the webhook — `airflow-trigger` is not deployed, and this run shows the fallback path carrying the load exactly as its migration says it should |
| **Fixtures** | `fixtures/imports/shopee/ads-report.csv` (30 rows, valid) · `fixtures/imports/edge-cases/broken-rows.csv` (10 rows, 7 defective) |

## The path, step by step — every step exercised, nothing simulated

| Step | Good file | Bad file |
|---|---|---|
| Upload to the private `imports` bucket | ✅ HTTP 200 | ✅ HTTP 200 |
| `INSERT` into `import_jobs` **through RLS** | ✅ HTTP 201 | ✅ HTTP 201 |
| Sensor claims the job (`pending` → `queued`) | ✅ ~60 s | ✅ ~90 s |
| DAG runs | ✅ `sensor__62df44bb…` | ✅ `sensor__d598bd33…` |
| Terminal state | ✅ **`succeeded`** | ✅ **`failed`** — which is the correct outcome |
| Wall-clock, upload → terminal | **~45 s** | **~65 s** |

## Result — the good file

```
status succeeded · rows_total 30 · rows_ok 30 · rows_quarantined 0
```

All 30 rows accepted. The file is a Shopee export in **Buddhist-era dates**
(`24/06/2569`) and the rows land as `2026-06-24` — the era conversion runs on
the real path, not only in the unit tests.

## Result — the bad file, and this is the one that matters

```
status failed · rows_total 10 · rows_ok 0 · rows_quarantined 7
error_message: "This file was not imported. 7 of 10 rows could not be read,
                and we import a file only in full — download the error report,
                fix those rows and upload the file again."
error_report_path: b022da17…/d598bd33…/broken-rows-errors.csv
```

**`rows_ok` is 0, not 3.** Three rows in that file are perfectly valid, and the
pipeline still imported none of them. That is the all-or-nothing rule holding on
the real path: a partially-imported file would leave a merchant reading a margin
computed from part of their data without knowing it.

**Seven rejections, seven distinct reasons**, recorded per row in
`import_row_errors` and in a downloadable bilingual CSV:

| row | code | reason |
|---|---|---|
| 3 | `missing_required` | `date` is required but the row has no value |
| 4 | `unreadable_date` | `31/02/2569` is not a date that can be read |
| 5 | `negative_value` | `impressions` cannot be negative (−5000) |
| 6 | `unreadable_number` | `N/A` is not a number |
| 7 | `clicks_exceed_impressions` | 1 200 clicks against 800 impressions |
| 9 | `duplicate_row` | repeats row 8 of the same file |
| 10 | `short_row` | 3 values where the file has 7 columns |

Each message names the offending column and the offending value, in Thai and
English, and the raw row is preserved in `raw_row` so nothing is lost.

## What this establishes, and what it does not

**Establishes:** the ingestion pipeline works end to end on the deployed system,
through RLS, on the real trigger path, for both outcomes it is designed to have
— and it does so on generated test corpora, which is the level of completeness
this project set for it.

**Does not establish:** stability. There is no retry, no alerting, no
concurrency test, and no exposure to the shapes of real merchant files beyond
the frozen corpus. **The pipeline requires the Airflow stack to be running on
the researcher's machine**; it is not a hosted service. Neither claim should be
stretched in the thesis beyond what this run shows.

## Bearing on L-7

L-7 records that `import_jobs` went from 9 rows to 0 between 2026-08-10 and
2026-09-02, with the cause unknown. **This run does not explain that**, and it
was not designed to. What it removes is one candidate explanation: *the write
path is not broken* — an ordinary user can create a job through RLS, and the
pipeline processes it. See the updated L-7 entry in
`docs/HANDOFF_INGESTION_KPI.md` for what is now known and the hypothesis that
follows from the schema.

## Files

```
evidence/ingestion-e2e/2026-09-09/
  import_jobs.json          both job rows as the database holds them
  import_row_errors.json    the 7 rejections
  broken-rows-errors.csv    the merchant-facing report, as generated
  watch-good-file.log       polled status transitions
  watch-bad-file.log        same, for the refused file
  summary.md                this file
```
