# KPI-5 round 2 — Latency at 50 concurrent users — **still FAIL**

**Measured:** 2026-09-09, three runs at 15:39 · 16:18 · 16:56 ICT (each 8 m 30 s,
30 minutes apart), control at 17:07
**Commit under test:** `29a88bb` — the deployed build. Commits after it
(`f354ac4`, `daaab3c`) touch `docs/` and `evidence/` only;
`git diff --name-only 29a88bb..HEAD -- src/` is empty
**Spec:** `docs/KPI_SPEC.md` § KPI-5, pre-registered as `da02849` — **no
threshold moved**
**Site:** https://buzzly-dev.vercel.app (apex host; the alias 302s to Vercel SSO)
**Profile:** ramp 0→50 over 2 min · hold 50 for 5 min · ramp down 1 min — identical to round 1
**Round 1, kept as measured:** `evidence/kpi5-k6/4c13722/` — **not edited by this run**

## Instrument — and one thing that had to be reinstalled

`k6 v2.2.0 (commit/00a9a1b7f5, go1.26.5, linux/amd64)` — **byte-identical
version string to round 1, same build commit.** The binary was missing from the
machine at the start of this round (round 1 appears to have run it from a
temporary directory that a reboot cleared) and was reinstalled to `~/tools/k6`,
outside the repository, for the same reason Lighthouse lives outside it: KPI-7
counts this project's dependency tree and a measurement tool inside it would
change a number another KPI reports.

`k6/kpi5-dashboard-journey.js` is **byte-identical** to the copy frozen as
round-1 evidence (`diff` clean), including the two threshold lines, which carry
the comment *"The two pre-registered numbers. Do not edit."*

**Fixture, unchanged and verified before the run:** workspace
`ff98b9cc-3558-47a9-ba78-ca4d2b9b6130`, 10 seeded accounts, 2 ad accounts,
**2 400 `ad_insights` rows** (1 200 + 1 200, counted through PostgREST), and one
seeded login exercised for real (HTTP 200) so a run could not fail on stale
credentials and be read as saturation.

## Verdict

**FAIL, on both thresholds, in all three runs — the same verdict as round 1.**

| | run 1 | run 2 | run 3 | **median** | threshold |
|---|---|---|---|---|---|
| `http_req_duration` p(95) | 60.00 s | 60.00 s | 60.00 s | **60.00 s** | < 2 s ❌ |
| `http_req_failed` | 57.08% | 50.29% | 61.63% | **57.08%** | < 1% ❌ |
| checks passed | 42.92% | 49.71% | 38.43% | **42.92%** | — |
| checks total | 1 221 | 2 062 | 778 | 1 221 | — |
| iterations completed | 363 | 853 | 68 | 363 | — |

**p(95) = 60.00 s is the request timeout, exactly as in round 1**: at the 95th
percentile the request did not complete at all.

## Round 1 vs round 2, side by side

| | round 1 (`4c13722`) | round 2 (`29a88bb`) | moved? |
|---|---|---|---|
| p(95), median of 3 runs | 60.00 s | **60.00 s** | **no — not at all** |
| `http_req_failed`, median | 60.50% | **57.08%** | marginally, within run-to-run spread |
| checks passed, median | 39.80% | **42.92%** | marginally |
| **median latency (`med`), per run** | 21.63 / 35.00 / 6.14 s | **1.73 / 0.68 / 48.79 s** | **yes — 12× better at the median in 2 of 3 runs** |
| **iterations completed, all 3 runs** | 476 | **1 284** | **yes — 2.7× the work done** |
| requests issued, all 3 runs | 3 321 | 4 070 | yes |

⭐ **The axis the remedy targeted did move, and the axis the threshold is on did
not.** The seven optimisation commits cut a dashboard load from 126 Supabase
requests to 60. Under load that shows up as **more journeys completed and a far
faster median** — the system does substantially more work per run than it did.
It does not show up in **p(95)**, which sits on the 60 s ceiling in every run of
both rounds. The threshold gates the tail, and the tail did not move.

## Per-step p(95) — the shape of the failure is unchanged

| step | R1 r1 | R1 r2 | R1 r3 | **R2 r1** | **R2 r2** | **R2 r3** |
|---|---|---|---|---|---|---|
| 1 · SPA shell from the CDN (**no database**) | 0.10 s | 0.15 s | 0.12 s | **0.24 s** | **0.64 s** | **0.51 s** |
| 2 · login | 37.72 s | 41.08 s | 37.36 s | 36.12 s | 39.86 s | 45.68 s |
| 3 · session bootstrap | 60.00 s | 60.00 s | 60.00 s | 60.00 s | 60.00 s | 60.00 s |
| 4 · ad accounts | 60.00 s | 60.00 s | 60.00 s | 60.00 s | 60.00 s | 60.00 s |
| 5 · insights, wide range | 60.00 s | 60.00 s | 60.00 s | 60.00 s | 60.00 s | 60.00 s |
| 6 · per-source counts | 60.00 s | 60.00 s | 60.00 s | 60.00 s | 60.00 s | 60.00 s |
| 7 · insights, re-ranged | 60.00 s | 60.00 s | 60.00 s | 60.00 s | 60.00 s | 60.00 s |

**Step 1 remains the only step that never reaches the ceiling, and it is the
only step that never touches the database.** It is 2–5× slower than in round 1
(0.24–0.64 s against 0.10–0.15 s) — recorded rather than explained, since it is
still roughly a hundred times below every failing step and nothing in this
measurement isolates its cause.

## ⭐ What did change: the door the system saturates through

`failures_by_status`, tagged per step and status by the script:

| run | no response (timeout) | **429 rate-limited** | 500 | 504 | total |
|---|---|---|---|---|---|
| R1 run 1 | 272 | 32 | **287** | 26 | 617 |
| R1 run 2 | **392** | 32 | 12 | 21 | 457 |
| R1 run 3 | 196 | 119 | **568** | 23 | 906 |
| **R2 run 1** | **362** | **305** | 10 | 20 | 697 |
| **R2 run 2** | 203 | **742** | 15 | 77 | 1 037 |
| **R2 run 3** | **361** | **0** | 110 | 8 | 479 |

**Round 1's summary recorded: *"`429` is a minority in every run and is not the
primary bottleneck."* Round 2 refutes that for two of its three runs.** 429s
went from 32/32/119 to 305/742/0, while 500s collapsed from 287/12/568 to
10/15/110.

The honest reading, and its limit:

- **500s — the backend erroring under pressure — largely stopped.** That is
  consistent with the remedy: far fewer queries per journey, so the database is
  asked to do less per user.
- **The system now runs into a rate limit instead**, most visibly in run 2, the
  run that completed 853 iterations — the run that got *furthest* is the run
  that hit 429 hardest. That is what a throughput improvement colliding with a
  request-rate ceiling looks like.
- **Run 3 is the counter-example and is not smoothed over:** zero 429s, 361
  timeouts, 110 500s, and only 68 iterations — the worst run in either round. It
  says the previous failure mode is still reachable.

**Three runs is not enough to establish which limit binds.** What is established
is that the mix changed, in the direction the remedy predicts, and that the
outcome against the threshold did not.

## One user, same system — control

A single-VU run of the identical journey: **10 of 10 checks passed, p(95) = 1.62 s.**

| step | control p95 |
|---|---|
| 1 · SPA shell | 0.21 s |
| 2 · login | 1.69 s |
| 3 · session bootstrap | 1.12 s |
| 4 · ad accounts | 0.57 s |
| 5 · insights, wide | 1.55 s |
| 6 · per-source counts | 1.55 s |
| 7 · insights, re-ranged | 0.87 s |

**The journey is correct and the application works; what fails is the system
under concurrency** — the same conclusion round 1 reached, re-established on
this build.

⚠️ **A deliberate difference from round 1, stated rather than hidden.** Round 1
ran its control **immediately before run 1**, on a rested system, and got
**p(95) = 1.11 s**. This round ran the control **immediately after run 3**, at
17:07, two minutes after a saturating run ended, because inserting it into a
30-minute recovery gap would have changed the conditions of the run that
followed. **The 1.11 s → 1.62 s difference must not be read as a single-user
regression**: the two controls were taken at opposite ends of a load test. What
the control establishes — that one user completes all ten checks in under 2 s —
holds in both rounds.

## Fixture limitation — unchanged, and it belongs beside the number

Ten seeded accounts in **one** workspace: ten identities, ten JWTs, ten RLS
evaluations, but one tenant's rows. Read as "the system serves 50 concurrent
merchants", this claims more than the fixture supports.

## Files

```
evidence/kpi5-k6/29a88bb/
  meta.json                 environment pin, exact commands, fixture verification
  script.js                 the k6 script as run (identical to round 1's copy)
  loadtest-target.json      ids and emails; no credential
  run-1..3/console.log      full k6 output
  run-1..3/summary.json     k6 --summary-export
  run-1..3/metrics.csv      per-request rows, where the status table comes from
  control/                  single-VU control, console + summary
  progress.log              start/finish timestamps of each run
  summary.md                this file
```
