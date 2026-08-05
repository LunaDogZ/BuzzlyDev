# Buzzly ingestion pipeline — measurement report

Generated 2026-08-05T08:59:26+00:00 · commit `f139235` · fixtures seed `20260723`, window 2026-06-24 → 2026-07-23

Regenerate with `python3 -m research.run` from `airflow/`. The fixture generator is deterministic, so every number here is reproducible from a clean checkout.

**What is being compared.** The *pipeline* is the code the DAG runs. The *naive baseline* (`research/baseline.py`) is a plain CSV reader — UTF-8, `csv.reader`, `float()`, `date.fromisoformat()`, exact header match — given the full synonym dictionary for free, Thai entries included. What separates them is therefore only: encoding detection, invisible-character and NFC normalisation, prefix and fuzzy header matching, Buddhist-era dates, currency and separator parsing, empty-versus-unreadable, and dropping blank and totals rows.

---

## 1. Reading accuracy against a known answer key

File: `meta/ads-export-thai-dirty.csv` — 30 rows × 15 fields = **450 cells**.

The key is written by `fixtures/imports/generate.mjs` from the values it holds before serialising them into Buddhist-era dates, `฿` and thousands separators, so it is independent of both parsers below.

|  | Rows read | Correct | Missing | Fabricated | Wrong | Cell accuracy | Value accuracy |
|---|---|---|---|---|---|---|---|
| **Pipeline** | 30/30 | 450 | 0 | 0 | 0 | 100.0% | 100.0% |
| Naive baseline | 0/30 | 10 | 440 | 0 | 0 | 2.2% | 0.0% |

**Read the baseline's 2.2% carefully.** All 10 of its correct cells are cells the key says were empty — agreement about an absence, not data recovered. It read 0 rows of this file. *Value accuracy* excludes those cells and is the figure to compare.

*Fabricated* is the column that matters most and is zero for both: neither parser invented a value where the file had none. A parser that read blank cells as `0` would score well on *missing* and put numbers in the merchant's dashboard that their file never contained.

## 2. Rows and columns recovered, per file

| File | Pipeline rows | Pipeline columns | Baseline rows | Baseline columns | Detected as |
|---|---|---|---|---|---|
| `meta/ads-export-clean.csv` | 150/150 | 16/16 | 150/150 | 11/16 | ad_performance |
| `meta/ads-export-thai-dirty.csv` | 30/30 | 15/15 | 0/33 | 11/15 | ad_performance |
| `tiktok/ads-export.csv` | 90/90 | 13/13 | 90/90 | 8/13 | ad_performance |
| `shopee/ads-report.csv` | 30/30 | 10/10 | 0/30 | 7/10 | ad_performance |
| `shopee/income-report.csv` | 3458/3458 | 13/13 | 0/3458 | 13/13 | shopee_income |
| `shopee/products-cogs.csv` | 7/7 | 5/5 | 7/7 | 5/5 | product_cogs |
| `edge-cases/broken-rows.csv` | 3/10 | 7/7 | 6/10 | 6/7 | ad_performance |
| `edge-cases/headers-only.csv` | 0/0 | 7/7 | 0/0 | 6/7 | ad_performance |
| `edge-cases/empty.csv` | refused | — | 0 rows | — | The file is empty (0 bytes). |

> Row recovery is not a score on its own. `edge-cases/broken-rows.csv` is the case that proves it: the baseline keeps **more** rows than the pipeline, and every extra row it keeps is one that should have been refused. See §4.

## 3. How each column was identified

Three passes, most confident first. Pass 1 is an exact match of the **normalised** heading — NFC, zero-width and non-breaking characters removed, trailing parenthetical gloss stripped — so `Amount spent (THB)`, `ค่าใช้จ่าย (บาท)` and a heading carrying an invisible `U+00A0` all reach the dictionary as the same key. Pass 2 is a prefix match for a *longer* heading, pass 3 a fuzzy match above 0.88. A column surviving all three is reported, never guessed.

| File | Exact | Prefix | Fuzzy | Unmatched | Correct vs key |
|---|---|---|---|---|---|
| `meta/ads-export-clean.csv` | 16 | 0 | 0 | 0 | — |
| `meta/ads-export-thai-dirty.csv` | 15 | 0 | 0 | 0 | 100.0% |
| `tiktok/ads-export.csv` | 13 | 0 | 0 | 0 | — |
| `shopee/ads-report.csv` | 10 | 0 | 0 | 0 | — |
| `shopee/income-report.csv` | 13 | 0 | 0 | 0 | — |
| `shopee/products-cogs.csv` | 5 | 0 | 0 | 0 | — |
| `edge-cases/broken-rows.csv` | 7 | 0 | 0 | 0 | — |
| `edge-cases/headers-only.csv` | 7 | 0 | 0 | 0 | — |

> **Passes 2 and 3 never fired on this fixture set.** All 86 columns resolved on pass 1, which says the normalised dictionary covers every heading these files contain — and equally that the prefix and fuzzy passes are **not evidenced here**. They exist for headings the fixtures do not have (a merchant's hand-edit, a mistyped Thai tone mark). Their unit tests in `airflow/tests/test_ingest.py` are what covers them; this table is not.

## 4. Which rows were refused, and whether the reason was right

File: `edge-cases/broken-rows.csv` — one deliberate defect per row, so the reason codes double as a per-row label.

|  | Correctly refused | Wrongly refused | Wrongly kept | Precision | Recall | Right reason given |
|---|---|---|---|---|---|---|
| **Pipeline** | 7 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| Naive baseline | 4 | 0 | 3 | 100.0% | 57.1% | n/a — gives no reason |

The baseline ingested 3 defective rows: `negative_value`, `clicks_exceed_impressions`, `duplicate_row`. Each parses cleanly as a number and is wrong as data — which is why validation is a stage and not a parsing concern.

## 5. Reconciliation against the file's own totals row

The `รวมทั้งหมด` row is dropped before ingestion, so it never touches the numbers it is compared with — an independent check on the whole read path. Encoding, header mapping, Buddhist-era dates and currency parsing all have to be right for these to land.

| Field | File states | Pipeline sums | Difference | Verdict |
|---|---|---|---|---|
| `impressions` | 1081585 | 1081585 | 0 | exact |
| `clicks` | 17328 | 17328 | 0 | exact |
| `spend` | 53988.57 | 53988.54 | -0.03 | within rounding |

> The `spend` difference is **not a parser error**. Each row states its spend rounded to two decimals while the totals row was computed before rounding, so `sum(round(x)) ≠ round(sum(x))` by up to one satang per row — 30 rows gives a tolerance of ฿0.30. Real exports have exactly this shape. Chasing the last satang would mean reproducing a number the rows do not contain.

## 6. Would a re-import duplicate anything?

Every id is `uuid5(fixed namespace, natural key)` — a pure function of the file's contents — so the second import of a campaign computes the id the first one used and the insert becomes an update. No unique constraints were added to tables the app writes by hand.

| File | Campaigns | Ads | Insight rows | Same ids on re-run | Order-independent | Key collisions |
|---|---|---|---|---|---|---|
| `meta/ads-export-clean.csv` | 5 | 5 | 150 | yes | yes | 0 |
| `meta/ads-export-thai-dirty.csv` | 5 | 5 | 30 | yes | yes | 0 |
| `tiktok/ads-export.csv` | 3 | 3 | 90 | yes | yes | 0 |
| `shopee/ads-report.csv` | 1 | 1 | 30 | yes | yes | 0 |

> *Key collisions* must be 0: PostgREST compiles a batch into one statement, so a repeated `(ad, day)` target does not duplicate a row — it fails the whole file.

## 7. Throughput

Median of 5 passes, milliseconds, in-process. Phases are timed separately because they scale differently: reading is bound by file size, typing and validation by row count.

| File | Bytes | Rows | Read | Map | Type | Validate | Total | ms/1k rows |
|---|---|---|---|---|---|---|---|---|
| `meta/ads-export-clean.csv` | 23273 | 150 | 3.974 | 15.516 | 13.32 | 0.792 | **33.602** | 224.013 |
| `meta/ads-export-thai-dirty.csv` | 5746 | 30 | 1.207 | 14.744 | 2.725 | 0.173 | **18.849** | 628.3 |
| `tiktok/ads-export.csv` | 11983 | 90 | 2.846 | 11.391 | 6.615 | 0.435 | **21.287** | 236.522 |
| `shopee/ads-report.csv` | 4751 | 30 | 1.33 | 7.301 | 1.653 | 0.15 | **10.434** | 347.8 |
| `shopee/income-report.csv` | 488596 | 3458 | 68.53 | 19.784 | 245.053 | 14.548 | **347.915** | 100.612 |
| `shopee/products-cogs.csv` | 786 | 7 | 0.682 | 8.772 | 0.171 | 0.052 | **9.677** | 1382.429 |
| `edge-cases/broken-rows.csv` | 581 | 10 | 0.972 | 7.065 | 0.372 | 0.075 | **8.484** | 848.4 |
| `edge-cases/headers-only.csv` | 91 | 0 | 0.244 | 7.024 | 0.002 | 0.002 | **7.272** | 7272.0 |

## 8. What orchestration costs, and what it buys

From **34 real DagRuns** on this instance (success: 29, failed: 5), between `2026-07-23` and `2026-08-05`. Read-only: nothing was triggered to produce these numbers.

### Per-stage duration (seconds)

| Stage | Runs | Median | p95 | Max |
|---|---|---|---|---|
| `resolve_job` | 34 | 1.148 | 2.94 | 4.909 |
| `verify_artifact` | 34 | 2.166 | 2.988 | 3.213 |
| `process` _(retired)_ | 5 | 0.299 | 0.323 | 0.323 |
| `finalize` | 34 | 0.69 | 2.39 | 2.815 |
| `hash_dedupe` | 29 | 1.022 | 2.881 | 8.552 |
| `detect_format` | 29 | 0.539 | 1.595 | 2.405 |
| `parse` | 29 | 0.519 | 1.625 | 1.73 |
| `clean_thai` | 29 | 0.564 | 1.556 | 1.562 |
| `validate` | 29 | 0.572 | 1.526 | 1.628 |
| `quarantine_bad_rows` | 29 | 0.578 | 2.822 | 3.148 |
| `upsert_target` | 29 | 0.496 | 8.126 | 8.438 |
| `cleanup_staging` | 29 | 0.253 | 0.298 | 0.322 |

> _(retired)_ marks a task the DAG no longer has. The history spans every version that has run on this instance; those rows are kept rather than filtered, because deleting inconvenient history is not measurement.

### End to end

| Outcome | Runs | Median wall (s) | p95 | Max |
|---|---|---|---|---|
| success | 29 | 15.558 | 32.757 | 33.852 |
| failed | 5 | 24.88 | 80.585 | 80.585 |

Wall clock **not** spent executing a task — scheduling, executor hand-off and XCom round-trips — median **6.644s**, max 71.126s (a cold scheduler).

Tasks that retried: **2**. Failures by stage: `detect_format` ×2, `finalize` ×2, `quarantine_bad_rows` ×1, `upsert_target` ×1. A failure in `detect_format` or `validate` is the merchant's file; one in `verify_artifact` or `upsert_target` is ours. Being able to say which without reading a log is the whole reason these are separate tasks.

### DAG versus a single process, on identical work

Restricted to the four tasks that touch no network, so the difference is the cost of the task boundary and nothing else. The other seven spend their time on Supabase round-trips a single script would also pay.

| Stage | As a DAG task (ms) | In-process (ms) | Overhead (ms) |
|---|---|---|---|
| `detect_format` | 539.0 | 1.207 | 537.8 |
| `parse` | 519.0 | 1.207 | 517.8 |
| `clean_thai` | 564.0 | 17.469 | 546.5 |
| `validate` | 572.0 | 0.173 | 571.8 |

**543.5 ms per task boundary** (2194.0 ms as tasks vs 20.056 ms in-process — 109.4× on pure compute).

> The in-process column is charged generously: `detect_format` and `parse` are both billed a full `read_table`, though the DAG's `detect_format` only sniffs magic bytes and an encoding. Overstating the in-process side understates the overhead, so the figure above is a **lower bound**.

That is the price. What it buys, per stage:

- **a retry boundary** — a network blip re-runs one task instead of re-reading a 3,458-row file;
- **a log boundary** — a failure is attributed to `validate` (the merchant's data) or `verify_artifact` (our storage) without a debugger, which is what `/imports` shows as *Stopped at:*;
- **a timing boundary** — the table above, which a single script would not produce at all.

The overhead is per *task*, not per row: it is a constant ~0.5 s that a 3,458-row file and a 10-row file pay identically, so it falls as a share of total work exactly as files get larger.

---

## Method notes

- **The answer key is not produced by either parser.** It is emitted by the fixture generator from the values it holds before serialisation. Scoring a parse against a re-parse would measure agreement, not accuracy.
- **The baseline is handed the synonym dictionary**, which makes the comparison conservative: knowing that `ค่าใช้จ่าย` means spend is a dictionary anyone can write, so crediting it to the pipeline would inflate the result.
- **Cells are scored four ways, not two.** *Fabricated* — a value where the file had none — is separated from *missing*, because only one of the two is invisible to the merchant.
- **Money is compared as `Decimal`.** A float comparison would report a discrepancy that belongs to the harness.
- **Orchestration figures are read-only**, taken from runs that already happened, so running the harness cannot change what it reports.
