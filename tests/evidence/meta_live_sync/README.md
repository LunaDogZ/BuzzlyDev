# meta_live restatement evidence — 2026-08-13

Captured immediately before the KPI-1 reconciliation export, to establish that
the database was current at export time (the `sync → export → verify, same
sitting` rule) and to record what Meta changed under us.

## What was run

```
POST /api/meta/sync
  workspaceId  b022da17-32cb-4694-bd72-0087bf427d79   (E2E Walk Workspace)
  adAccountId  336e1785-367f-4559-8ee8-2c38e2261e13   (act_1025260845170202, THB, Asia/Bangkok)
  since        2025-07-10
  until        2026-08-12
```

Read at **2026-08-13T05:06:02Z**. No pipeline logic, tolerance, or UI was touched.

## Files

| File | What it is |
|---|---|
| `before.json` | all 31 `data_source='meta_live'` rows as of the previous sync (2026-08-12T08:36Z) |
| `after.json` | the same rows after this sync |
| `restatements.json` | machine diff: added / removed / per-field changes |
| `sync-response.json` | the endpoint's own totals for the window |

The diff is computed on the derived row `id`, which is stable for a given
(account, campaign, ad, date) — so a value change is a genuine restatement by
Meta, not a re-keyed row.

## Finding 1 — Meta restates closed days, months after the fact

**13 of 31 rows (41.9%) changed value** for an identical query window. No rows
were added and none removed: the row *set* was stable, only the numbers moved.

Restated dates span **2025-07-11 → 2026-08-12** — including days more than
**thirteen months old**, far outside Meta's 28-day attribution window.

Two distinct classes:

- **`reach` only (11 rows)**, on dates in Jul 2025, Dec 2025 and Mar 2026.
  Moved in *both* directions (e.g. 2025-07-13 `1355 → 1331`; 2026-03-22
  `2335 → 2477`). `reach` is a modelled de-duplicated-people estimate, not a
  counted event, and Meta evidently re-models it retroactively and without
  bound. Spend and clicks on these same rows did not move.
- **Spend-bearing (2 rows)**, both recent: 2026-08-11 and 2026-08-12.

Window spend totals: **฿1,316.41 → ฿1,350.08 (+฿33.67, +2.56%)**.
Impressions 16,608 → 16,893. Clicks 1,525 → 1,530.

**Consequence for KPI-1:** a reconciliation between this database and an Ads
Manager export is only meaningful if both are read in the same sitting. Any gap
admits a restatement that the harness would report as a mismatch — a real
disagreement between two sources, but not a pipeline defect. `reach` in
particular should not be treated as reconcilable at any tolerance.

## Finding 2 — the previous 2026-08-12 row was a mid-day capture

The prior sync read 2026-08-12 at **08:36:21Z**, which is **15:36 Asia/Bangkok
on that same day** — 8.4 hours *before* the account's day closed. It captured a
partial day and stored it as if it were the day.

| | previous (mid-day) | this sync (closed day) | change |
|---|---|---|---|
| spend | ฿30.44 | ฿64.04 | +110% |
| impressions | 267 | 550 | +106% |
| clicks | 4 | 9 | +125% |
| reach | 211 | 425 | +101% |

This sync read at 2026-08-13T05:06Z = **12.1 hours after** 2026-08-12 closed in
Asia/Bangkok (23:59:59+07 = 16:59:59Z). The row is now a whole-day figure.

Roughly half the day was missing before — a merchant reading that dashboard on
2026-08-12 evening would have seen half their true spend.

## Caveat — `created_at` does not mean "when this value was read"

The 2026-08-12 row still carries `created_at = 2026-08-12T08:36:21Z` after this
sync doubled its values. `ad_insights` has no `updated_at`, and the writer
upserts, so `created_at` records first insertion only. **Do not use it to date a
value.** The read time has to come from `sync_history` or from evidence like
this directory. This is why the before/after snapshots are kept rather than
re-derived later.

## Still-open exposure

Everything from ~2026-07-16 onward remains inside Meta's 28-day attribution
window and can still restate. Finding 1 shows `reach` can restate *outside* it
too, with no apparent horizon.
