# Failure analysis — KPI-4 and KPI-5

**Thai version: [`KPI_FAILURE_ANALYSIS.th.md`](./KPI_FAILURE_ANALYSIS.th.md).**
The two files are the same document in two languages. **This English file is
canonical for anything a reader outside the project sees; the Thai file is the
founder's working copy. Edit one, edit the other in the same commit** — and put
new numbers in `evidence/`, never only here.

**Why this document exists.** The advisor's instruction: *a failed experiment is
acceptable, but it must state why it failed and propose several remedies.* This
file is that answer, written so it can be lifted into Chapter 4/5 directly, and
so a Claude session that has never seen this project can pick the work up cold
(see §6).

| File | Role | What this document does to it |
|---|---|---|
| `docs/KPI_SPEC.md` (`da02849`) | the pre-registered thresholds | **read-only, never edited** |
| `evidence/kpi4-lighthouse/*/summary.md` | raw results + verdict per round | cited, never overwritten |
| `evidence/kpi5-k6/*/summary.md` | same | cited, never overwritten |
| `docs/PROPOSAL_VS_IMPLEMENTATION.md` | where the build departs from the proposal | cited — **D-10** ties the free-tier constraint to these two failures |
| **this document** | the narrative, the cause analysis, the remedies | contains no number that does not come from an evidence file |

### Three rules this document is written under

1. **No threshold moves.** 80/100 and 50 concurrent users come from the approved
   proposal §1.3. Lowering a bar to clear it costs the thesis more credibility
   than the failure does.
2. **No past round is edited.** Every measurement is kept as measured. A new
   round is a new directory with a new date, reported side by side with the old.
3. **A prediction is not a measurement.** Every "this should help by roughly X"
   in §4 is a *hypothesis* and is labelled as one. Only §2–§3 contain results.

---

## §1 The five-step structure for a failed KPI

Reusable for any KPI that fails later.

| Step | Section | Must answer |
|---|---|---|
| **1** | Theory the experiment was designed on | why measure it this way · where the threshold comes from · **what we believed the bottleneck was, written down before measuring** |
| **2** | Round 1 result | the number · pass/fail · **whether the evidence confirms or refutes the step-1 belief** |
| **3** | The remedy chosen, and why that one | what principle it applies · what changed · **why the other options were not chosen yet** |
| **4** | Round 2 result | the number · **did the axis we targeted actually move** · why it still fails |
| **5** | Conclusion | to pass, **X** is required, because **Y** · what the options are · **which experiment would decide between them** |

⭐ **Steps 2 and 5 carry the weight.** Step 2 is where measurement *refutes* what
we assumed — the evidence that the method is working rather than confirming what
we hoped. Step 5 must name a **decisive experiment**, not a wish list.

---

## §2 KPI-4 — Lighthouse Performance ≥ 80 (desktop)

### Step 1 · The theory the experiment was designed on

**Threshold:** ≥ 80/100, stated in proposal §1.3 (Class 1 — a proposal figure).

**Instrument:** Google Lighthouse, which composes the Performance score from
five Core Web Vitals metrics with fixed weights — LCP 25% · TBT 30% · CLS 25% ·
FCP 10% · Speed Index 10%. Chosen because it is an industry-standard instrument
a reader can re-run, not a metric we defined for ourselves.

**Protocol, locked before any run:** three routes (`/`, `/dashboard`,
`/imports`) × two presets × 6 runs, run 1 discarded, median of runs 2–6.
**Every route must reach 80; one failing route fails the KPI** — the rule exists
so that an average cannot let the landing page carry the dashboard.

**⭐ The hypothesis recorded before measuring:** the spec named the suspect in
advance — the **919 kB entry chunk**, with route-level code splitting as the
obvious remedy, following the standard SPA account in which bundle size drives
time-to-content. **Writing the suspect down before the measurement is what makes
it possible to say afterwards that the measurement refuted it.**

### Step 2 · Round 1 — and the hypothesis is refuted

Measured on `4c13722` (2026-09-07), against the production deployment.

| Route | Score | |
|---|---|---|
| `/` | 100 | ✅ |
| `/dashboard` | **65** | ❌ |
| `/imports` | **74** | ❌ |

Evidence against the bundle hypothesis, from the `/dashboard` median run:

| Metric | Measured | Means |
|---|---|---|
| First Contentful Paint | 297 ms | the shell paints almost immediately |
| Total Blocking Time | **0 ms** | JavaScript blocks nothing at all |
| Script bootup | 0.4 s | the code starts fast |
| Total transfer | **124 KiB** | not a heavy page |
| Opportunity audits with any saving | **none** | Lighthouse finds nothing to cut on the front end |
| **LCP = TTI = 15.9 s** (in the median-scoring run) | identical | **nothing large is on screen until the data arrives** |

What was found instead: one load of `/dashboard` issued **147 requests, 126 of
them to Supabase**, repeating the same query within a single page load —
`workspaces` ×6 · `customer` ×5 · `business_types` ×5 · `industries` ×5 ·
`ad_accounts` ×5 · `/auth/v1/user` ×30 — with the slowest single call at 8.6 s.

> **Round 1 conclusion: the bottleneck is not code size, it is waiting for data.**
> The founding theory was wrong, and the measurement is what said so.

### Step 3 · The remedy chosen, and why

**Principle applied:** reduce the number of round trips per page load without
changing anything the user sees. Three techniques:

1. **Request deduplication** — identical in-flight requests issue once and share
   the answer (`/auth/v1/user` 30 → 3).
2. **A single source of truth via React Query** — six hooks each asked "which
   workspace am I in?" separately; now they share one answer.
3. **Opt-in / lazy fetching** — lookup tables used by one settings screen
   (`business_types`, `industries`) stopped loading on every page; the sidebar
   stopped pulling a whole team-management payload to render one number.

Seven commits, `536c50b` … `29a88bb`.

**Why the deeper remedy was not chosen for this round:** collapsing dozens of
calls into one or two server-side RPCs attacks the cause more directly, but it
requires reworking RLS and rewriting the test suite. This round deliberately
took only the low-risk, individually verifiable changes first, **so that the
answer to "how much does reducing request count alone buy?" would be known** —
a result worth having either way.

### Step 4 · Round 2 — still failing

Measured on `29a88bb` (2026-09-08). Same instrument, browser, machine, account
and protocol; the only difference is the seven commits.

| Route | Round 1 | **Round 2** | |
|---|---|---|---|
| `/` | 100 | **100** | ✅ |
| `/dashboard` | 65 | **68** | ❌ |
| `/imports` | 74 | **70** | ❌ |

The targeted axis moved, and moved a lot (`/dashboard`, median run):

| | Round 1 | Round 2 | Change |
|---|---|---|---|
| Total requests | 147 | **80** | −46% |
| Supabase calls | 126 | **60** | −52% |
| of which `/auth/v1/` | 30 | **3** | −90% |
| Transfer | 124 KiB | **59 KiB** | −52% |
| Main-thread work | 1 012 ms | **673 ms** | −33% |
| **LCP** (median of 5 runs) | 14.2 s | **11.7 s** | **−18%** |
| **Score** | **65** | **68** | **+3** |

> **Halving the request count bought three points.** That is the headline result
> of round 2.

**A caveat that must always travel with these numbers.** `/imports` went 74 → 70,
and **this is not evidence that the change made it worse.** Its per-run LCP in
round 2 was 5.4 / 5.4 / **44.4** / **28.1** / 8.8 s, against a tight 4.4–4.8 s
in round 1. In the bad runs **many different queries were slow at once**
(`subscriptions` 15.8 s · `profile_customers` 13.6 s · `employees` 13.2 s), the
root document itself slowed from 61 ms to 389 ms, and even `/` — which touches
no data — drifted from 279 ms to 460 ms FCP while still scoring 100. The set was
measured through a slower backend window. It is reported unadjusted, because
re-running until the number looks right is not measurement, and **it does not
threaten the verdict: no single run in the set reached 80** (best 70 and 75).

### Step 5 · Conclusion — what passing would require, and why

The 68 decomposed by Lighthouse's own weights, taken from the median run's JSON:

| Metric | Weight | Score | Points |
|---|---|---|---|
| Total Blocking Time | 30 | 1.00 | **30 / 30** ✅ |
| Cumulative Layout Shift | 25 | 1.00 | **25 / 25** ✅ |
| First Contentful Paint | 10 | 1.00 | **10 / 10** ✅ |
| Speed Index | 10 | 0.34 | 3.4 / 10 |
| **Largest Contentful Paint** | **25** | **0.00** | **0 / 25** ❌ |
| | | | **= 68** |

⭐ **Everything the front end controls is already at full marks — 65 of 65
points. The entire deficit is "data reaches the screen late".**

> **To pass, content must reach the screen in roughly 2.5–3.8 s instead of
> 11.7 s, because the only points left unclaimed are LCP's.**
>
> *Where that range comes from:* inverting Lighthouse's desktop scoring curve for
> LCP (log-normal, p10 = 1.2 s, median = 2.4 s). With Speed Index unchanged, LCP
> must reach ≈ 2.5 s; if Speed Index improves alongside it — likely, since both
> wait on the same data — ≈ 3.8 s suffices. **This is a derivation, not a
> measurement**, flagged per rule 3.

**And the root cause cannot be resolved with the data in hand. Stated plainly:**

| Hypothesis | Supporting evidence | Contradicting evidence |
|---|---|---|
| **H1 · the database has insufficient capacity** (a free tier the proposal itself mandates — §3.2.2, p.11–12) | individual calls take 5–15 s in some runs · the one step that never touches the database (static files from the CDN) stays at ~0.1 s throughout | in good runs the same call set completes in ~5 s, so capacity is adequate some of the time |
| **H2 · we saturate it ourselves** (still 57 REST calls per load) | cutting requests 52% did improve LCP 18%, so the relationship is real | if count alone were the driver, halving it should have bought more than 3 points |

**The two are coupled** — a dense burst causes the contention that makes each
call slow — and **the present data cannot say which dominates.** Claiming a
single established cause would exceed the evidence. §4 is the experiment that
would separate them.

---

## §3 KPI-5 — p95 < 2 s and error rate < 1% at 50 concurrent users

### Step 1 · The theory the experiment was designed on

**Thresholds and their provenance — never blur these two classes:**

| Value | Class | Source |
|---|---|---|
| 50 concurrent users | **Class 1** | proposal §1.3, stated directly |
| p95 < 2 000 ms | **Class 2 — ours** | §1.3 says only *"stable response times"*, which is not measurable as written. Converted to a number citing Nielsen (1993): 1 s preserves flow of thought, 10 s exhausts attention; Google Core Web Vitals rates LCP ≤ 2.5 s "good". 2 s at p95 gates the **tail**, which is the experience users actually complain about, rather than the mean. |
| error rate < 1% | **Class 2 — ours** | Beyer et al., *Site Reliability Engineering* (2016): a 99% success floor. |

**The last two must never be presented as proposal requirements** — not in the
chapter, not in a slide, not in a defence answer.

**Load profile:** ramp 0→50 over 2 min · hold 50 for 5 min · ramp down 1 min ·
three spaced runs · a seven-step real user journey (load the app → log in →
bootstrap session → ad accounts → insights → per-source counts → re-ranged
insights).

### Step 2 · Round 1

Measured on `4c13722` (2026-09-07), three runs.

| | Run 1 | Run 2 | Run 3 | Median | Threshold |
|---|---|---|---|---|---|
| `http_req_duration` p95 | 60.00 s | 60.00 s | 60.00 s | **60.00 s** | < 2 s ❌ |
| `http_req_failed` | 60.50% | 50.94% | 65.13% | **60.50%** | < 1% ❌ |
| checks passed | 39.80% | 49.05% | 34.86% | 39.80% | — |

**p95 = 60 s is the request timeout**: at the 95th percentile the request did
not complete at all. It is not "slow", it is "never answered".

**⭐ The single most locating piece of evidence — p95 per journey step:**

| Step | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| 1 · SPA shell from the CDN (**touches no database**) | **96.89 ms** | **147.69 ms** | **115.43 ms** |
| 2 · login | 37.71 s | 41.08 s | 37.35 s |
| 3–7 · every database-backed step | **60.00 s** | **60.00 s** | **60.00 s** |

> **The only step that never degrades is the only step that never touches the
> database**, and it stays at ~0.1 s throughout. The static hosting is not
> implicated in this failure.

**Control:** a single virtual user walking the identical journey, on the same
system in the same hour, **passed 10 of 10 checks with p95 = 1.11 s.** The
journey is correct and the application works; what fails is the system under
concurrency.

**What is still unknown, and must not be written as known:** the failure mode is
**not stable between runs**.

| Run | HTTP 500 | no response (timeout) | 429 | 504 |
|---|---|---|---|---|
| 1 | **287** | 272 | 32 | 26 |
| 2 | 12 | **392** | 32 | 21 |
| 3 | **568** | 196 | 119 | 23 |

Run 2 is almost entirely timeouts; runs 1 and 3 are dominated by 500s. **The
system saturates every time, but not through the same door**, and naming one
mechanism would exceed the data. What *is* established: `429` (rate limiting) is
a minority in every run and is not the primary bottleneck.

**Fixture limitation, which belongs beside the number and not in a footnote:**
ten seeded accounts in **one** workspace — ten identities, ten JWTs, ten RLS
evaluations, but one tenant's rows. Read as "the system serves 50 concurrent
merchants", this would claim more than the fixture supports.

### Step 3 · The remedy chosen

**The same seven commits as KPI-4**, because the evidence says **KPI-4 and KPI-5
are one defect seen from two directions**: a page load issuing over a hundred
requests, multiplied by 50 concurrent users, is several thousand concurrent
queries against one database.

### Step 4 · Round 2 — **measured 2026-09-09, still FAIL**

Measured on `29a88bb` (the deployed build), three runs 30 minutes apart, same
instrument, same script, same fixture, same profile, same host.
Evidence: `evidence/kpi5-k6/29a88bb/summary.md`. Round 1 is not edited.

| | round 1 | **round 2** | threshold |
|---|---|---|---|
| `http_req_duration` p(95), median of 3 runs | 60.00 s | **60.00 s** | < 2 s ❌ |
| `http_req_failed`, median | 60.50% | **57.08%** | < 1% ❌ |

**⭐ The prediction written into this document before the measurement was
correct, and that is the finding.** It said cutting per-load requests by 52% was
*"unlikely to be enough"* to bring p95 from 60 s below 2 s. It was not enough —
and not by a margin that leaves any doubt: **p(95) did not move at all.** It sat
on the 60 s request timeout in every run of both rounds.

**Did the axis the remedy targeted actually move? Yes — substantially — and it
is the wrong axis for this threshold.**

| | round 1 | **round 2** | change |
|---|---|---|---|
| median latency (`med`), per run | 21.63 / 35.00 / 6.14 s | **1.73 / 0.68 / 48.79 s** | **12× faster at the median in 2 of 3 runs** |
| iterations completed, all 3 runs | 476 | **1 284** | **2.7× the work done** |
| checks passed, median | 39.80% | 42.92% | marginal |
| p(95) | 60.00 s | **60.00 s** | **none** |

> **Fewer requests per journey bought throughput, not tail latency.** The system
> completes nearly three times as many journeys and serves the median user in
> under two seconds — and the 95th-percentile request still never returns. A
> threshold on the tail is not moved by a remedy that improves the median.

**⭐ What did change is the door the system saturates through**, and it refutes
a sentence round 1 wrote:

| run | timeout | **429 rate-limited** | 500 | 504 |
|---|---|---|---|---|
| round 1, runs 1–3 | 272 / 392 / 196 | 32 / 32 / 119 | **287 / 12 / 568** | 26 / 21 / 23 |
| **round 2, runs 1–3** | 362 / 203 / 361 | **305 / 742 / 0** | 10 / 15 / 110 | 20 / 77 / 8 |

Round 1 recorded *"`429` is a minority in every run and is not the primary
bottleneck."* **In two of round 2's three runs it is the largest single
category.** Backend 500s largely stopped — consistent with the remedy, since the
database is asked to do far less per journey — and the system now meets a
request-rate ceiling instead. The run that got *furthest* (853 iterations) is
the run that hit 429 hardest.

**Reported beside it, not smoothed away:** run 3 had **zero** 429s, 361
timeouts, and completed only 68 iterations — the worst run of either round. The
old failure mode is still reachable, three runs cannot establish which limit
binds, and this document does not claim one.

**Control, same system:** a single virtual user passed **10 of 10 checks at
p(95) = 1.62 s**. Round 1's control ran *before* its first run on a rested system
(1.11 s); this one ran *after* the third run, two minutes after a saturating
load ended. **The difference is the ordering, not a single-user regression** —
what both establish is that one user completes the journey inside the threshold
that fifty users miss by a factor of thirty.

### Step 5 · Conclusion

> **To pass, the data layer's capacity to serve concurrent requests must
> increase, because every database-backed step hit the timeout ceiling while the
> one step that avoids the database never failed in any run, and a single user
> completed the same journey in 1.11 s (round 1) and 1.62 s (round 2).**

**Round 2 strengthens this conclusion rather than changing it, and narrows what
is left to test.** Halving the request volume was the cheapest hypothesis
available — it is now measured, and it moved throughput and the median while
leaving the threshold metric untouched. What remains is a capacity question, and
the 429s point at a request-rate ceiling that no amount of client-side
consolidation can raise from below.

**The decisive experiment is therefore unchanged and now better justified:
remedy A in §4** — raise the database tier, change nothing else, re-measure.
Round 2 is the evidence that the code-side path (remedy B/D, doing fewer
requests) has already been walked far enough to see that it does not reach the
threshold on its own.

The routes are in §4 — shared with KPI-4, because it is one problem.

---

## §4 The remedies, compared

⚠️ **Every "expected effect" below is a hypothesis, not a result.** Whichever is
taken must be measured as a new, separately dated round and reported beside the
previous one.

| # | Remedy | Attacks | Expected effect *(hypothesis)* | Cost | Risk |
|---|---|---|---|---|---|
| **A** | **Raise database capacity** (move the Supabase project off the free tier) | H1 | if H1 holds, both KPIs improve immediately with **no code change at all** | very low · ~half a day including re-measurement · a monthly fee | ⚠️ **it departs from a stated proposal constraint** — §3.2.2 (p.11–12) commits the project to free/hobby tiers for the whole prototyping phase. Taking it changes the experimental environment, must be declared in the chapter, measured as a before/after, and recorded as a deviation in [`PROPOSAL_VS_IMPLEMENTATION.md`](./PROPOSAL_VS_IMPLEMENTATION.md) **D-10** |
| **B** | **Collapse reads into server-side RPCs** — `/dashboard`'s 57 calls into 1–2 | H2 | cuts both round trips and the self-inflicted contention; the most direct fix if H2 holds | high · several days | high — reworks RLS, needs a new test suite, touches many pages |
| **C** | **Index / tune the slowest queries** | both | the 5–15 s single calls may be missing indexes rather than a capacity wall | low–medium · 1–2 days | low · worth doing regardless of the outcome |
| **D** | **Cache / prefetch slow-changing data** (plans, lookup tables) | H2 | removes repeated cross-page calls from the critical path | medium | medium · invalidation must be right or users see stale data |
| **E** | **Change what paints first** — make the LCP element something that does not wait on data | nothing | the Lighthouse score improves immediately | low | 🔴 **the user gets their data no sooner.** If taken, it must be disclosed as measurement-facing and reported alongside the true time-to-data — otherwise it is dressing up a number |
| **F** | **Report the failure with its cause analysis** (what this document does) | — | changes no number, but moves the status from "did not succeed" to "measured, explained, with remedies proposed" | low | none · it is what the spec pre-registered as the response to a failure |

### The experiment that decides between H1 and H2

**Do A before B** — not because A is easier, but because **A isolates one
variable**: capacity changes, every line of code stays, the same protocol re-runs.

| Outcome | Means | Next |
|---|---|---|
| LCP drops sharply | **H1 holds** — capacity-bound | report it as an environment constraint, not an architectural one |
| LCP barely moves | **H2 holds** — self-inflicted | do B, now with evidence for why it is necessary |
| Drops, but short of the bar | both contribute | A and B are both required — itself a finding worth stating |

**Every outcome yields a defensible Chapter 5 conclusion**, which is what makes
this experiment worth running, unlike optimising repeatedly until a number
looks acceptable.

---

## §5 What this document cannot answer

Recorded so that nothing here is over-claimed.

1. **Whether H1 or H2 dominates** — requires the §4 experiment.
2. **Which ceiling binds KPI-5 — the request-rate limit or the database
   itself.** Round 2 turned the failure mix from 500s into 429s in two runs of
   three, and its third run had zero 429s and the worst result of either round.
   Three runs cannot separate them; the §4 experiment can.
3. **Why Chrome's renderer occasionally dies mid-run** during KPI-4 measurement.
   Every relaunch is counted in each set's `meta.json`; the latest set needed 0.
4. **The mechanism behind KPI-5's saturation** — the failure mode changes between
   runs, so no single mechanism is established.
5. **KPI-5's fixture is single-tenant**, so it does not answer what 50 real
   merchants would do.

---

## §6 Handoff — state, and how to continue

For a session picking this up cold. Durable project rules live in
`CLAUDE.md`; thresholds live in `docs/KPI_SPEC.md`; **this section is only about
the failing KPIs.**

### Where the seven KPIs stand (2026-09-09)

| KPI | Threshold | State |
|---|---|---|
| KPI-1 accuracy vs Meta | MAPE ≤ 0.5% | ✅ PASS — 0.0000%, frozen |
| KPI-2 valid files ingested | 100% | ✅ PASS — 20/20, frozen |
| KPI-3 malformed → DLQ | 100% | ✅ PASS — 12/12, frozen |
| KPI-4 Lighthouse | ≥ 80 | ❌ **FAIL** — two rounds: `4c13722` 100/65/74, `29a88bb` 100/68/70 |
| KPI-5 load at 50 VU | p95 < 2 s · fail < 1% | ❌ **FAIL** — **two rounds**: `4c13722` p95 60 s / 60.50% failed, `29a88bb` p95 60 s / 57.08% failed. Median latency and throughput improved sharply; **p(95) did not move at all** |
| KPI-6 SUS | ≥ 68 | ⬜ not measured — instrument and consent pack ready, **participants booked for Friday 2026-09-11** |
| KPI-7 OWASP | 4 criteria | ✅ **PASS — all four criteria met.** ZAP baseline 0 High / 0 Critical (`29a88bb`, 2026-09-08) · `npm audit` 0 Critical · both scans run twice and agree · matrix 10/10, **all ten rows now re-verified against the delivered build** (`f354ac4`, 2026-09-09) |

### Re-running the measurements

Lighthouse is installed **outside this repo on purpose** — KPI-7 criterion 4
counts `npm audit` findings over this project's dependency tree, and a
measurement tool inside it would change a number another KPI reports. Current
location: `~/tools/kpi-lighthouse` (`lighthouse@13.4.1` + `chrome-launcher`).
**Pin the version**: a different scoring engine makes rounds incomparable.

```bash
# KPI-4 — 36 runs, ~30 min, writes evidence/kpi4-lighthouse/<sha>/
LIGHTHOUSE_DIR=~/tools/kpi-lighthouse \
  node scripts/kpi4-lighthouse.mjs --site https://buzzly-dev.vercel.app
LIGHTHOUSE_DIR=~/tools/kpi-lighthouse \
  node scripts/kpi4-report.mjs evidence/kpi4-lighthouse/<sha>

# KPI-5 — three runs 30 min apart, ~1 h 25 m of runs (+ setup), writes evidence/kpi5-k6/<sha>/
#   k6 lives at ~/tools/k6 (outside the repo, same reason as Lighthouse).
#   Verify the fixture first: 2400 ad_insights rows and a seeded login that answers 200.
SITE_URL=https://buzzly-dev.vercel.app K6_USER_PASSWORD=<seeded pw> \
  ~/tools/k6/k6 run --out csv=<run>/metrics.csv --summary-export <run>/summary.json \
  k6/kpi5-dashboard-journey.js
# control, 1 user, same journey — run it at a stated point relative to the load runs
#   and say which, because a rested system and a just-saturated one differ:
SITE_URL=… K6_USER_PASSWORD=… ~/tools/k6/k6 run --vus 1 --iterations 1 …
```

### Four preconditions — each one can produce a clean-looking number that means nothing

1. **The deployment must carry the commit under test.**
   `node scripts/postdeploy-verify.mjs https://buzzly-dev.vercel.app` must print
   `OK deployed build carries HEAD`. (`APP_BASE_URL` fails there by design and
   is unrelated to these KPIs.)
2. **Target the apex host only.** The alias
   `buzzly-dev-lunadogzs-projects.vercel.app` answers 302 to Vercel SSO, so a
   run against it scores Vercel's login page — a false pass.
3. **Pin instrument versions.** Both KPI-4 rounds used Lighthouse 13.4.1 and
   Chrome 145.0.7632.6.
4. **The Supabase session must reach the Lighthouse tab.** Supabase keeps the
   session in `localStorage`; a fresh profile is redirected and would silently
   score a different page. The harness guards this by comparing the landed URL
   against the requested route and aborting on any mismatch. A one-off smoke run
   (`--route R2 --runs 2 --presets desktop --label smoke`, which writes to `/tmp`
   and is not evidence) confirms it before committing 30 minutes to a set.

### Rules that must not be broken while continuing

- **Do not move a threshold.** Not to pass, not to "align with the proposal".
- **Do not edit a past round.** New round → new directory, new date, reported
  side by side.
- **Do not present a prediction as a result** (§4's expected effects).
- **Do not borrow KPI-4's result to speak for KPI-5.**
- **Keep the Thai and English versions of this document in sync**, in the same
  commit.

### Open decisions, awaiting the founder

| Item | Note |
|---|---|
| ~~Commit the KPI-4 round-2 evidence + this document~~ | ✅ **done** — `1745829` (evidence) and `5bab4f1` (this document) |
| ~~Run the ZAP baseline scan (KPI-7 criterion 2)~~ | ✅ **done** — approved and run 2026-09-08, `f354ac4`: 0 High, 0 Critical, twice. Criterion 1's eight carried-forward rows were re-verified 2026-09-09 (`evidence/kpi7-security/f354ac4…/matrix-reverification.md`), which completes KPI-7 |
| ~~Prepare the KPI-6 participant pack~~ | ✅ **done** — `evidence/kpi6-sus/{protocol.md,form-th.md,participant-template.json}`; advisor approval on file (`evidence/approvals/2026-09-05-kpi6-recruitment.md`). **Participants are booked for Friday 2026-09-11** |
| Run experiment A (raise DB capacity) then re-measure | the decisive test in §4; deferred by the founder until KPI-6 and KPI-7 are done |
| ~~Run KPI-5 round 2~~ | ✅ **done** — measured 2026-09-09 on `29a88bb`, `evidence/kpi5-k6/29a88bb/`. Still FAIL; §3 steps 4–5 rewritten from the result |

---

## Appendix · Where every number here comes from

| Number | File |
|---|---|
| KPI-4 round 1 (100/65/74) | `evidence/kpi4-lighthouse/4c13722/summary.md` |
| KPI-4 round 2 (100/68/70) | `evidence/kpi4-lighthouse/29a88bb/summary.md` |
| The weighted decomposition of 68 | `evidence/kpi4-lighthouse/29a88bb/desktop/R2-dashboard/run-2.json` |
| Request counts and repeated queries | each set's `run-2.json`, audit `network-requests` |
| KPI-5 round 1 figures | `evidence/kpi5-k6/4c13722/summary.md` + `run-1..3/` |
| KPI-5 round 2 figures, the 429/500 table, the control | `evidence/kpi5-k6/29a88bb/summary.md` + `run-1..3/` + `control/` |
| Thresholds and their provenance | `docs/KPI_SPEC.md` (`da02849`) |
