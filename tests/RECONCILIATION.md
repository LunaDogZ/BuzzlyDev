# KPI-1 — Reconciliation: pipeline output vs Meta Ads Manager export

> # ⚠️ NOT A PUBLISHABLE RESULT
> 
> `ground_truth_source = generated`. This run did **not** use a CSV a human
> exported from Meta Ads Manager, so it demonstrates that the harness
> works — it does **not** measure the pipeline against an independent
> source. Do not quote any number below in the thesis.

- **Ground truth**: `synthetic-export.csv`  ·  sha256 `7cecbc2f2994d666…`  ·  **[generated]**
- **Window**: 2025-07-10 → 2026-08-11   ·   **Grain**: ad × day
- **Export header language**: en

## COVERAGE — gates everything below it

| | rows |
|---|---|
| in export | 30 |
| in database | 30 |
| in export, **not** in DB | 0 |
| in DB, **not** in export | 0 |

**Coverage: PASS**

## A. DELIVERY — gated (not attribution-dependent)

| metric | export | database | agg. error | exact rows | verdict |
|---|---|---|---|---|---|
| impressions | 16341 | 16341 | 0.0000% | 30/30 | PASS |
| clicks | 1521 | 1521 | 0.0000% | 30/30 | PASS |
| spend | 1285.97 | 1285.97 | 0.0000% | 30/30 | PASS |

**Cell-level exact match: 90/90**  (100%)

## B. DERIVED — recomputed from A on both sides

| metric | export | database | agg. error | exact rows | verdict |
|---|---|---|---|---|---|
| ctr | 9.3079 | 9.3079 | 0.0000% | 23/23 | PASS |
| cpc | 0.8455 | 0.8455 | 0.0000% | 21/21 | PASS |

> Totals are the rate over the totals, not the sum of the rows' rates. Row counts here are below tier A's because a day with no impressions has no CTR and a day with no clicks has no CPC — those rows leave the comparison rather than being counted as zero.

> Tier A matched exactly on every row, so tier B matches by construction and carries no independent evidence. Stated rather than presented as two more passing metrics.

## C. ATTRIBUTION — reported, NOT gated (see L-5)

| metric | export | database | agg. error | exact rows | verdict |
|---|---|---|---|---|---|
| conversions | 29 | 29 | 0.0000% | 28/28 | reported |

> Ads Manager and the Graph API can apply different attribution windows, so a difference here is not a pipeline defect. The connected test account also runs messaging campaigns, so its purchase signal is not a transactional sale.

## WORST 5 ROWS BY ABSOLUTE ERROR — shown even when passing

| ad | date | metric | export | database | error |
|---|---|---|---|---|---|
| `120229666005010481` | 2025-07-10 | impressions | 53 | 53 | 0.0000% |
| `120229666005010481` | 2025-07-11 | impressions | 789 | 789 | 0.0000% |
| `120229666005010481` | 2025-07-12 | impressions | 381 | 381 | 0.0000% |
| `120229666005010481` | 2025-07-13 | impressions | 1562 | 1562 | 0.0000% |
| `120229666005010481` | 2025-07-14 | impressions | 1005 | 1005 | 0.0000% |

## NEGATIVE CONTROL — proof this harness can fail

**M1 — one value corrupted.** Added 1 impression to ad `120229666005010481` on 2025-07-10 (53 → 54). Coverage still passes; tier A drops to 29/30 exact rows and the verdict becomes **FAIL**. ✔ the metric gate is live.

**M2 — one row lost.** Removed ad `120229666005010481` on 2025-07-10 from the stored side. Every remaining row still matches exactly (87/87 cells), and the verdict is still **FAIL** because the row is missing. ✔ perfect arithmetic over a subset does not earn a pass.

**F — fixtures as the source of truth.** Same export against `data_source='mock'` on the same ad account: 30 rows only in the export, 77 only in the database, verdict **FAIL**.

## VERDICT: PASS
