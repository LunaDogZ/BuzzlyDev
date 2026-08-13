# KPI-1 — how to produce the ground-truth export

The reconciliation harness is finished and tested; the only thing it still needs
is one CSV that a human exported from Meta Ads Manager. This page is the recipe,
written so the export cannot come out in a shape the harness has to refuse.

**Why a CSV and not another API call.** Reading the Graph API and comparing it
against rows written from the Graph API is circular: the same service, the same
attribution settings, the same rounding, so a mapping bug would agree with
itself and the result would be a tautology. The Ads Manager export travels
through Meta's own reporting and rendering layer instead, which is a genuinely
different path to the same underlying facts.

---

## 1. Export it

Ads Manager → **Reports** (or Ads Manager → Export → Export table data).

| Setting | Value | Why it matters |
|---|---|---|
| **Level / breakdown by** | **Ad** | The stored grain is ad × day. A campaign-level export cannot be compared row for row. |
| **Time breakdown** | **Day** | Same reason. Without it you get one row per ad for the whole range. |
| **Date range** | 2025-07-10 → **yesterday** | Not today: the account is live. Its total moved ฿1,316.13 → ฿1,316.30 → ฿1,316.41 within minutes on 2026-08-12, so both sides would disagree for the one reason that is not a defect. The harness refuses a same-day export unless you pass `--allow-today`. |
| **Format** | **CSV** (UTF-8) | `.xlsx` is not read. |

### Columns that must be present

| Column | Note |
|---|---|
| **Ad ID** | **The one people forget.** Without it the only join key left is the ad *name*, which breaks the moment an ad is renamed and collides when two ads share a name. The harness refuses an export without it and says so. |
| **Day** (or Reporting starts) | |
| **Impressions** | |
| **Clicks (all)** | **Not "Link clicks".** The connector stores all clicks, by the approved field mapping, so that it agrees with the CTR and CPC Meta itself computes. Reconciling against link clicks compares two different metrics and reports the difference as a pipeline defect. The harness detects this specific mistake and names it. |
| **Amount spent (THB)** | |
| Results / Purchases | Optional — reported, never gated. See L-5. |

### The Thai column names, as Ads Manager actually writes them

Measured off a real export on 2026-08-12. The harness's original Thai aliases
were translations someone wrote by hand and **all three of these were wrong**,
so use this table rather than translating again.

| Field | Thai heading Meta emits |
|---|---|
| Ad ID | **`ID โฆษณา`** — not `รหัสโฆษณา`. Beware `ID ชุดโฆษณา` (ad *set*) next to it. |
| Day | `วัน` |
| Impressions | **`อิมเพรสชัน`** — a transliteration, not `การแสดงผล` |
| Clicks (all) | **`จำนวนคลิก (ทั้งหมด)`** — measured 08-13; `การคลิก (ทั้งหมด)` had itself been a guess |
| *(not this one)* | `การคลิกลิงก์` is **link clicks** — a different metric, and refused by name |
| Amount spent | **`จำนวนเงินที่ใช้จ่ายไป (THB)`** — note the `ไป` |
| Results | `ผลลัพธ์` |

### Meta restates days after they end — sync last, export last, run immediately

Measured 2026-08-13 against the Graph API, ad `120250765705660481`:

| Day | Meta, read 2026-08-13 | Stored in `ad_insights` | |
|---|---|---|---|
| 2026-08-10 | 249 / 6 / ฿32.43 | 249 / 6 / ฿32.43 | exact |
| 2026-08-11 | 371 / 5 / ฿52.12 | 369 / 5 / ฿52.05 | **restated after the day closed** |
| 2026-08-12 | 550 / 9 / ฿64.04 | 267 / 4 / ฿30.44 | stored mid-day, stale |

A finished day is **not** final: 08-11 gained 2 impressions and ฿0.07 after it
ended. Tier A gates on **exact cell equality**, so drift of that size fails the
gate for a reason that is not a pipeline defect. The connector's rolling 30-day
re-upsert is what absorbs it — but only if it runs.

**So the run order is not optional:**

1. re-run the Meta sync (§2 below),
2. take the Ads Manager export,
3. run `verify_reconcile.py` — the same day, without a sync in between.

The three totals above also confirm something worth stating in the thesis: the
export and the Graph API agree **exactly** (1,170 / 20 / ฿148.59 over the three
days), so the two ground-truth paths do not disagree with each other.

### The two attempts so far, and what each still lacked

**Attempt 1 (2026-08-12)** came out as **one row of account-level totals** —
`วัน`, `ID โฆษณา` and every other dimension column present as a heading and
**empty in the cell** — with no clicks column, over 2026-08-01 → 08-12 only.

**Attempt 2 (2026-08-13)** fixed the clicks column and is genuinely at **Ad**
level, but still came out as **one row covering 2026-08-10 → 08-12** and still
carries **no `ID โฆษณา` column**.

Both are refused by name rather than reconciled. What is still missing:

1. **Add the `ID โฆษณา` column.** Ad *name* is present but is not a join key —
   it breaks on rename and collides when two ads share a name. This is the one
   both attempts have missed.
2. **Set `Time breakdown` (การแบ่งตามช่วงเวลา) = Day.** Level = Ad is already
   right; this is the separate setting that turns one three-day row into one row
   per ad per day and fills `วัน`.
3. **Widen the date range to 2025-07-10 → yesterday** — the stored rows span
   that whole window, and attempt 2's range covers 3 of the 31.

Thai or English column headings are both fine; so are grouped thousands
(`1,200`), a Buddhist-era year (`2569`), `DD/MM/YYYY` dates, a UTF-8 BOM, and a
`รวมทั้งหมด` totals row, which is skipped and counted.

---

## 2. Make sure the database covers the same window

```bash
cd mock-api && npx tsx server.ts &     # or leave it running

curl -s -X POST http://localhost:3001/api/meta/sync \
  -H 'Content-Type: application/json' \
  -d '{"workspaceId":"b022da17-32cb-4694-bd72-0087bf427d79",
       "adAccountId":"336e1785-367f-4559-8ee8-2c38e2261e13",
       "since":"2025-01-01","until":"<the export s last day>"}'
```

The harness scopes its database read to the export's own date range, so rows
outside it are not counted as missing. It does not scope the other way: a day
inside the range that was never synced is a genuine coverage failure.

---

## 3. Run it

```bash
python3 tests/verify_reconcile.py --export path/to/export.csv
```

Writes `reports/reconciliation-<timestamp>.json` and `tests/RECONCILIATION.md`,
and exits non-zero if the reconciliation fails. Three negative controls run
automatically and the program aborts if any of them *passes* — see below.

`--ground-truth generated` exists for smoke-testing the plumbing against a
synthetic file. It stamps a loud banner on the report saying the numbers must
not be quoted. Never pass it for a published result.

---

## What the harness will refuse, and why

Each of these stops the run with a message rather than producing a number:

- **the export runs to today** — both sides are still moving
- **no Ad ID column** — the remaining join keys are unsafe
- **"Link clicks" but no "Clicks (all)"** — a different metric
- **the same ad appears twice on one day** — the export is not at ad × day grain
- **two columns match the same field** — guessing which is meant is not
  something a measurement may contain
- **a stored row's ad has no `meta:` prefix** — reconciling the rest would
  measure a subset the harness chose for itself
- **any negative control passes** — the comparison is not measuring anything

## The three negative controls

They exist because a table of 0.0000% errors reads exactly like a harness that
compared nothing.

| | what it does | what must happen |
|---|---|---|
| **M1** | adds **1 impression** to one stored row | coverage still passes, tier A **FAILS** → the arithmetic gate is live |
| **M2** | **removes one stored row** | every remaining cell still exact, verdict **FAILS** → perfect arithmetic over a subset earns nothing |
| **F** | uses `data_source='mock'` rows as the stored side | **FAILS** → real and simulated data are distinguishable |

M1 and M2 are mutation tests: perturb the input by the smallest possible amount
and require the answer to change. They are derived from whatever the run just
read, so they are always available and always specific to that run.
