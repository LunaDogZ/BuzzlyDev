# KPI-4 — Lighthouse Performance — **FAIL** (re-measurement after optimisation)

**Measured:** 2026-09-08 19:59 ICT · **commit under test:** `29a88bb`
**Before run:** `4c13722`, 2026-09-07 15:41 ICT — `evidence/kpi4-lighthouse/4c13722/`
**Spec:** `docs/KPI_SPEC.md` § KPI-4, pre-registered as `da02849` (2026-08-22)
**Site:** https://buzzly-dev.vercel.app · deployment `sin1::2ptk5-1788871626849-0ab4d9b6ace1`
**Lighthouse** 13.4.1 · **Chrome** 145.0.7632.6 · AMD Ryzen 5 4600H, 12 cores, 15 GB
**Runs:** 36 (3 routes × 2 presets × 6), run 1 of each discarded, median of runs 2–6.
**Chrome relaunches after a crashed run: 0** — no run in this set was re-rolled.

This is the **after** half of the before/after the spec's § "If it fails"
requires. Instrument, browser, machine, account, protocol and site are the same
as the before run; the only difference is the seven `perf(...)` commits between
`4c13722` and `29a88bb`. **The threshold did not move.**

## Verdict

**FAIL — unchanged.** All three desktop routes must reach ≥ 80. Two do not.
The optimisation moved `/dashboard` 65 → 68 and moved `/imports` 74 → 70; both
remain far below the bar, and **no single scored run in this set reached 80 on
either route** (best: R2 70, R3 75). The variance discussed below does not
threaten the direction of this verdict.

### Desktop — gates the verdict

| route | path | before | **after** | min | max | FCP | LCP | TBT | CLS | SI |
|---|---|---|---|---|---|---|---|---|---|---|
| R1 | `/` | 100 | **100** | 100 | 100 | 460 ms | 466 ms | 1 ms | 0.000 | 701 ms |
| R2 | `/dashboard` | 65 ❌ | **68** ❌ | 65 | 70 | 481 ms | 11 657 ms | 0 ms | 0.006 | 2 737 ms |
| R3 | `/imports` | 74 ❌ | **70** ❌ | 65 | 75 | 479 ms | 8 821 ms | 0 ms | 0.003 | 2 191 ms |

### Mobile — informational, not gated

| route | path | before | after | min | max | FCP | LCP | TBT | CLS | SI |
|---|---|---|---|---|---|---|---|---|---|---|
| R1 | `/` | 99 | 99 | 99 | 100 | 1 046 ms | 1 059 ms | 112 ms | 0.000 | 1 314 ms |
| R2 | `/dashboard` | 72 | 67 | 65 | 68 | 1 016 ms | 11 153 ms | 286 ms | 0.050 | 3 763 ms |
| R3 | `/imports` | 74 | 74 | 70 | 75 | 1 081 ms | 6 663 ms | 201 ms | 0.018 | 2 793 ms |

No mobile figure changes the verdict, in either direction.

## What the optimisation did do — measured on the same median runs

The before run named the cost precisely: not the bundle, but a burst of
duplicated Supabase REST calls that LCP waits on. On that axis the change is
large and it is exactly what was targeted:

| desktop median run | | `4c13722` | `29a88bb` |
|---|---|---|---|
| R2 `/dashboard` | total requests | 147 | **80** |
| | Supabase calls | 126 | **60** |
| | of which `/auth/v1/` | 30 | **3** |
| | of which `/rest/v1/` | 96 | **57** |
| | query kinds issued more than once | 24 | **18** |
| | transfer | 124 KiB | **59 KiB** |
| | main-thread work | 1 012 ms | **673 ms** |
| | script bootup | 433 ms | **329 ms** |
| R3 `/imports` | total requests | 109 | **61** |
| | Supabase calls | 95 | **48** |
| | of which `/auth/v1/` | 26 | **3** |
| | transfer | 92 KiB | **47 KiB** |

The five duplicated queries the before run listed by name are all reduced in the
median run: `customer` ×5, `business_types` ×5 and `industries` ×5 no longer
appear on `/dashboard` at all, `workspaces select=*` ×6 is now issued once, and
`ad_accounts` ×5 is down to 2. The 30 `/auth/v1/user` calls are 3. **Front-end
request volume roughly halved and the Performance score did not follow it across
the bar.** That is the finding.

## Why the score barely moved — and why R3 moved backwards

LCP still equals TTI on both failing routes: nothing large is on screen until
the queries return, so the score is a direct read-out of **how fast the Supabase
project answers the remaining burst**, not of anything the browser does.

That backend time is not stable, and this run makes it visible. Per-run LCP on
the same build, same site, minutes apart:

| route | run 2 | run 3 | run 4 | run 5 | run 6 |
|---|---|---|---|---|---|
| R3 `/imports` **after** | 5 429 ms | 5 366 ms | **44 363 ms** | **28 102 ms** | 8 821 ms |
| R3 `/imports` before | 4 443 ms | 4 411 ms | 4 528 ms | 4 768 ms | 4 519 ms |
| R2 `/dashboard` **after** | 11 657 ms | 12 413 ms | 7 363 ms | 8 575 ms | 22 730 ms |
| R2 `/dashboard` before | 15 855 ms | 14 182 ms | 16 182 ms | 7 867 ms | 8 190 ms |

In R3's two bad runs it is not one slow query — **many different queries are all
slow at once** (`subscriptions` 15.8 s, `profile_customers` 13.6 s, `employees`
13.2 s, `payment_transactions` 13.2 s in run 4), which is the signature of the
database side saturating, not of a page issuing a bad request. The root document
itself was slower in this window too: server response time 61 ms → 389 ms on R2
and 64 ms → 268 ms on R3, and R1 — a static page that touches no data — drifted
from 279 ms to 460 ms FCP while still scoring 100.

**So R3's 74 → 70 is not evidence that the optimisation hurt `/imports`.** It
was measured through a slower backend window, on a route whose spread widened
from 73–74 to 65–75. It is reported as measured, without adjustment, because
re-running until the number looks right is not measurement. What can be said
with the runs in hand: **the optimisation cut what the front end controls, and
the gate is bound by what it does not.**

## What this does and does not license

- KPI-4 is **reported as FAIL at `29a88bb`**, as it was at `4c13722`.
- The before/after is complete and stands on its own: the intervention is
  documented, dated, measured with an identical instrument, and it did not
  reach the threshold. That is a result, not a gap.
- The spec's original optimisation candidate (919 kB entry chunk, route-level
  code splitting) was already refuted by the before run and this run does not
  revive it: bootup is 329 ms, transfer 59 KiB, TBT 0 ms, and the only
  opportunity audit that fires is the *passing* server-response-time one.
- **No further optimisation was done in this session, and none is implied by
  this file.** A second pass, if the founder orders one, is again a separate
  dated activity with its own before/after.

## Reproducing this

```
LIGHTHOUSE_DIR=<dir with lighthouse 13.4.1 installed> \
  node scripts/kpi4-lighthouse.mjs --site https://buzzly-dev.vercel.app
LIGHTHOUSE_DIR=<same> node scripts/kpi4-report.mjs evidence/kpi4-lighthouse/29a88bb
```

Lighthouse stays installed outside this repo on purpose: KPI-7 criterion 4
counts `npm audit` findings over this project's dependency tree, and a
measurement tool added to that tree would change a number another KPI reports.

Before starting, three preconditions were checked, because each of them can
produce a clean-looking number that means nothing:

1. `node scripts/postdeploy-verify.mjs https://buzzly-dev.vercel.app` →
   **`OK deployed build carries HEAD`** (`/assets/index-CfQNKCC9.js`). Measuring
   a deployment that does not carry the commit under test would attribute the
   old build's numbers to the new one.
2. The target is the apex host. The alias
   `buzzly-dev-lunadogzs-projects.vercel.app` answers 302 to Vercel SSO, so a
   run against it scores Vercel's login page — a false pass.
3. Lighthouse **13.4.1** and Chrome **145.0.7632.6**, identical to the before
   run. A different scoring engine would make the two halves incomparable.

A single throwaway smoke run on R2 preceded the set (written to `/tmp`, deleted)
to prove the Supabase session reaches the Lighthouse tab — the trap the spec
calls the largest in KPI-4. It is not part of this evidence.

## Human-readable reports

`median-run-N.html` in each route directory is the standard Lighthouse report,
rendered from **the run whose score equals the median** — the run the verdict is
computed from, not the best-looking one.
