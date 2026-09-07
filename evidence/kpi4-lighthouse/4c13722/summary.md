# KPI-4 — Lighthouse Performance — **FAIL**

**Measured:** 2026-09-07 15:41 ICT · **commit under test:** `4c13722`
**Spec:** `docs/KPI_SPEC.md` § KPI-4, pre-registered as `da02849` (2026-08-22)
**Site:** https://buzzly-dev.vercel.app · deployment `sin1::rzb8f-1788769704082-21ea2becfe85`
**Lighthouse** 13.4.1 · **Chrome** 145.0.7632.6 · AMD Ryzen 5 4600H, 12 cores, 15 GB
**Runs:** 36 (3 routes × 2 presets × 6), run 1 of each discarded, median of runs 2–6.
**Chrome relaunches after a crashed run: 0** — no run in this set was re-rolled.

## Verdict

**FAIL.** The rule pre-registered before measuring is that *all three* desktop
routes must reach ≥ 80; a single failing route fails the KPI, so that an
average cannot let `/` carry `/dashboard`. Two of three are below the bar.

### Desktop — gates the verdict

| route | path | median | min | max | FCP | LCP | TBT | CLS | SI |
|---|---|---|---|---|---|---|---|---|---|
| R1 | `/` | **100** | 100 | 100 | 279 ms | 284 ms | 0 ms | 0.000 | 366 ms |
| R2 | `/dashboard` | **65** ❌ | 65 | 65 | 297 ms | **14 182 ms** | 0 ms | 0.004 | 5 985 ms |
| R3 | `/imports` | **74** ❌ | 73 | 74 | 286 ms | 4 519 ms | 0 ms | 0.000 | 2 137 ms |

### Mobile — informational, not gated

| route | path | median | min | max | FCP | LCP | TBT | CLS | SI |
|---|---|---|---|---|---|---|---|---|---|
| R1 | `/` | 99 | 99 | 100 | 875 ms | 887 ms | 97 ms | 0.000 | 875 ms |
| R2 | `/dashboard` | 72 | 69 | 72 | 887 ms | 10 690 ms | 187 ms | 0.030 | 3 157 ms |
| R3 | `/imports` | 74 | 74 | 75 | 882 ms | 6 878 ms | 144 ms | 0.000 | 2 543 ms |

No mobile figure changes the verdict, in either direction. The advisor has been
asked whether mobile should gate as well
(`evidence/approvals/2026-09-07-kpi4-preset.md`); if the answer is yes, the
verdict is recomputed from this same table and R2/R3 fail there too.

## What is actually costing the time — and what is not

**It is not the front end.** On R2 the shell paints in **297 ms**, total
blocking time is **0 ms**, layout shift is **0.004**, the root document
responds in **60 ms**, main-thread work is 1.0 s and script bootup 0.4 s.
Lighthouse lists **no opportunity audit with any saving at all**. Total transfer
is **124 KiB**.

**It is the data.** LCP and Time to Interactive are the same number — 15.9 s in
the median run — because nothing large is on screen until the queries return.
The page issues **147 requests, 96 of them Supabase REST calls**, and the
slowest single call takes **8.6 s**.

Many of those calls are the same query issued repeatedly within one page load:

| times | query |
|---|---|
| ×6 | `workspaces select=*` |
| ×5 | `customer select=id,email,full_name` |
| ×5 | `business_types select=*` |
| ×5 | `industries select=*` |
| ×5 | `ad_accounts select=id,platform_id` |
| ×4 | `loyalty_activity_codes`, `loyalty_mission_completions`, `workspaces select=id`, `ad_insights select=id`, `ad_insights select=date` |
| ×3 | `rpc/get_my_loyalty_tier`, `profile_customers`, `payment_transactions`, `points_transactions`, `platforms`, `subscriptions`, `workspace_api_keys` |

**This contradicts the optimisation candidate the spec had on record.** § "If it
fails" names the 919 kB entry chunk and route-level code splitting as the
obvious next step. The measurement does not support that: script bootup is
0.4 s and no bundle-related audit fires. Writing the candidate down before
measuring is what makes it possible to say the measurement overturned it.

## What happens next, and what deliberately did not happen now

Per the spec, the optimisation pass is a **separate, separately dated
activity**. Nothing was changed in the application to improve these numbers,
because a "before" that was edited is not a before. The threshold does not move.

## Reproducing this

```
LIGHTHOUSE_DIR=<dir with lighthouse installed> \
  node scripts/kpi4-lighthouse.mjs --site https://buzzly-dev.vercel.app
LIGHTHOUSE_DIR=<same> node scripts/kpi4-report.mjs evidence/kpi4-lighthouse/4c13722
```

Lighthouse is installed outside this repo on purpose: KPI-7 criterion 4 counts
`npm audit` findings over this project's dependency tree, and a measurement tool
added to that tree would change a number another KPI reports.

**The harness at the time of this measurement was uncommitted** (HEAD was
`4c13722`, the deployed commit, which is what `meta.json` records as the commit
under test). It was committed immediately afterwards; see the commit that adds
this directory.

## Human-readable reports

`median-run-N.html` in each route directory is the standard Lighthouse report,
rendered from **the run whose score equals the median** — the run the verdict is
computed from, not the best-looking one.
