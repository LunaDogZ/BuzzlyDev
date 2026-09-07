# KPI-5 — Latency at 50 concurrent users — **FAIL**

**Measured:** 2026-09-07, three runs at 16:08 · 16:46 · 17:25 ICT
**Commit under test:** `4c13722` (the deployed build; later commits touch
`scripts/`, `k6/` and `evidence/` only — `git diff --name-only 4c13722..HEAD -- src/`
is empty)
**Spec:** `docs/KPI_SPEC.md` § KPI-5, pre-registered as `da02849`
**Site:** https://buzzly-dev.vercel.app · **k6** v2.2.0
**Profile:** ramp 0→50 over 2 min · hold 50 for 5 min · ramp down 1 min

## Threshold provenance — read before quoting any number

**The load level of 50 concurrent users is Class 1**, from proposal §1.3.
**Both thresholds are Class 2, this project's own.** §1.3 says only *"sustaining
stable response times for 50 concurrent users"* and states no number.
`p(95) < 2000 ms` and `http_req_failed < 1%` are our operationalisation of
"stable" and **must never be presented as proposal requirements.**

## Verdict

**FAIL, on both thresholds, in all three runs.**

| | run 1 | run 2 | run 3 | **median** | min | max |
|---|---|---|---|---|---|---|
| `http_req_duration` p(95) | 60.00 s | 60.00 s | 60.00 s | **60.00 s** | 60.00 s | 60.00 s |
| `http_req_failed` | 60.50% | 50.94% | 65.13% | **60.50%** | 50.94% | 65.13% |
| checks passed | 39.80% | 49.05% | 34.86% | **39.80%** | 34.86% | 49.05% |
| checks total | 1 025 | 897 | 1 391 | 1 025 | 897 | 1 391 |
| iterations completed | 133 | 110 | 233 | 133 | 110 | 233 |

Against `p(95) < 2000 ms` the measured value is **60 s — the request timeout**,
i.e. at the 95th percentile the request did not complete at all. Against
`< 1%` the failure rate is **60.50%**.

## Where it breaks, step by step

p(95) per journey step, all three runs:

| step | run 1 | run 2 | run 3 |
|---|---|---|---|
| 1 · SPA shell from Vercel | **96.89 ms** | **147.69 ms** | **115.43 ms** |
| 2 · login | 37.71 s | 41.08 s | 37.35 s |
| 3 · session bootstrap | 60.00 s | 60.00 s | 60.00 s |
| 4 · ad accounts | 60.00 s | 60.00 s | 60.00 s |
| 5 · insights, wide range | 60.00 s | 60.00 s | 60.00 s |
| 6 · per-source counts | 60.00 s | 60.00 s | 60.00 s |
| 7 · insights, re-ranged | 60.00 s | 60.00 s | 60.00 s |

**Step 1 is the only step that never degrades.** It is the one step that does
not touch the database: static files from Vercel's CDN, served in ~100 ms
throughout while every database-backed step sits on the 60 s ceiling. The
saturation is in the data layer, and the static hosting is not implicated.

## The failure mode is not stable between runs

`failures_by_status`, which the script tags per step and status precisely so
that saturation can be *named* rather than just reported:

| run | HTTP 500 | no response (timeout) | 429 | 504 |
|---|---|---|---|---|
| 1 | **287** | 272 | 32 | 26 |
| 2 | 12 | **392** | 32 | 21 |
| 3 | **568** | 196 | 119 | 23 |

Run 2 is almost entirely timeouts with twelve 500s; runs 1 and 3 are dominated
by 500s. **So the system saturates every time, but not through the same door
each time**, and this measurement does not identify a single mechanism. Stating
one would be more than the data supports. What it does establish: rate limiting
(`429`) is a minority in every run and is not the primary bottleneck.

## One user, same system, same hour

A single-VU smoke of the identical journey immediately before run 1 completed
**10 of 10 checks with p(95) = 1.11 s**, step 1 at 85.78 ms and the slowest
step (login) at 1.35 s. The journey is correct; what fails is the system under
concurrency.

## Same root cause as KPI-4

`evidence/kpi4-lighthouse/4c13722/summary.md` measured one `/dashboard` load
issuing **147 requests, 96 of them Supabase REST**, with the same query repeated
several times per load (`workspaces` ×6, `customer` ×5, `business_types` ×5,
`industries` ×5, `ad_accounts` ×5). Fifty concurrent users of that page is
several thousand concurrent queries against a free-tier database. The two
failing KPIs are one defect seen from two directions.

## What the fixture does and does not support

Ten seeded accounts, all members of **one** workspace: ten distinct identities,
ten JWTs and ten RLS evaluations, but **one tenant's rows**. Fifty real
merchants would hold fifty row sets and touch the index far less predictably.
Read as "the system serves 50 concurrent merchants" this would claim more than
the fixture supports. The limitation belongs beside the number in the chapter,
not in a footnote.

## Nothing was changed to improve these numbers

The optimisation pass is a separate, separately dated activity by the spec.
These three runs are the "before". The thresholds do not move.

## Files

```
evidence/kpi5-k6/4c13722/
  meta.json                environment pin, fixture identity, provenance
  script.js                the journey exactly as executed
  loadtest-target.json     ids and account emails (no password)
  run-1..3/console.log     full k6 output
  run-1..3/summary.json    k6 --summary-export
  run-1..3/metrics.csv     every sample, tagged by step and status
```
