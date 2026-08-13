# KPI-1 — Reconciliation: pipeline output vs Meta Ads Manager export

- **Ground truth**: `รายงานที่ไม่มีชื่อ-ก.ค.-10-2025-ถึง-ส.ค.-12-2026.csv`  ·  sha256 `c3165f75f286d270…`  ·  **[meta_ads_manager]**
- **Window**: 2025-07-10 → 2026-08-12   ·   **Grain**: ad × day
- **Export header language**: th
- **Rows skipped by the reader**: 1 (no ad id)

## COVERAGE — gates everything below it

| | rows |
|---|---|
| in export | 27 |
| in database | 31 |
| in export, **not** in DB | 0 |
| in DB, **not** in export | 4 |

**Coverage: FAIL**
  - not in export: ad `120229666005010481` on 2025-07-20
  - not in export: ad `120229666005010481` on 2025-07-21
  - not in export: ad `120238826064120481` on 2025-12-16
  - not in export: ad `120238826064120481` on 2025-12-17

## A. DELIVERY — gated (not attribution-dependent)

| metric | export | database | agg. error | exact rows | verdict |
|---|---|---|---|---|---|
| impressions | 16893 | 16893 | 0.0000% | 27/27 | PASS |
| clicks | 1530 | 1530 | 0.0000% | 27/27 | PASS |
| spend | 1350.08 | 1350.08 | 0.0000% | 27/27 | PASS |

**Cell-level exact match: 81/81**  (100%)

## B. DERIVED — recomputed from A on both sides

| metric | export | database | agg. error | exact rows | verdict |
|---|---|---|---|---|---|
| ctr | 9.057 | 9.057 | 0.0000% | 24/24 | PASS |
| cpc | 0.8824 | 0.8824 | 0.0000% | 22/22 | PASS |

> Totals are the rate over the totals, not the sum of the rows' rates. Row counts here are below tier A's because a day with no impressions has no CTR and a day with no clicks has no CPC — those rows leave the comparison rather than being counted as zero.

> Tier A matched exactly on every row, so tier B matches by construction and carries no independent evidence. Stated rather than presented as two more passing metrics.

## C. ATTRIBUTION — reported, NOT gated (see L-5)

| metric | export | database | agg. error | exact rows | verdict |
|---|---|---|---|---|---|
| conversions | 389 | 29 | 92.5450% | 3/22 | reported |

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

**M1 — not applicable.** This run's own coverage already fails (0 rows only in the export, 4 only in the database), so a corrupted value could not be told apart from the rows that are simply absent. The coverage failure is itself the demonstration that the gate fires.

**M2 — one row lost.** Removed ad `120229666005010481` on 2025-07-10 from the stored side. Every remaining row still matches exactly (78/78 cells), and the verdict is still **FAIL** because the row is missing. ✔ perfect arithmetic over a subset does not earn a pass.

**F — fixtures as the source of truth.** Same export against `data_source='mock'` on the same ad account: 27 rows only in the export, 82 only in the database, verdict **FAIL**.

## VERDICT: FAIL
