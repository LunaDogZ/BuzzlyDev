# KPI specification — Buzzly: A Centralized Hub for Digital Marketing Intelligence

**Status: DRAFT FOR REVIEW. Not yet pre-registered.**

This file is the pre-registration record for KPI-4 … KPI-7. It becomes binding
the moment it is committed, and **no measurement for those four may be run
before that commit exists**. The commit sha of this file is what a reader cites
when asking "were these thresholds set before or after you saw the numbers?"

KPI-1 … KPI-3 are **already measured and frozen**. Their sections below are a
transcription for uniformity — a reader should be able to compare all seven in
one format — and change nothing about the results, the numbering, the gates or
the evidence in `tests/RESULTS.md`.

## Rules this document is written under

| Principle | How it is applied here |
|---|---|
| Pre-registration | Every threshold carries a **Provenance** row naming the proposal section, the advisor's instruction, or a citation. A threshold with no source is not a threshold. |
| Operational definition | Every KPI states instrument + version, environment, procedure, and counting rule in enough detail to be re-run by someone who cannot ask a question. |
| Repeatability | No result is reported from a single run. Each KPI declares n, the discard rule, and the statistic (median + spread). |
| Environment pinning | Every evidence artifact carries commit sha, build id, wall-clock time, and machine/network spec in its header. |
| Falsifiability | Every KPI declares, in advance, what happens if it fails. **A failed KPI is reported as failed.** Remediation, if any, is a separate dated run reported as before/after — never a replacement. |

### Threshold provenance — two distinct classes, never blurred

A reader can open the proposal and check. So each threshold states which class
it belongs to, and the second class never borrows the first's authority.

**Class 1 — declared in the approved proposal §1.3** (verified against the
document, 2026-08-14):

| Value | Wording in §1.3 |
|---|---|
| Lighthouse Performance ≥ 80 / 100 | stated as a numeric target |
| 50 concurrent users | stated as the load level |
| SUS ≥ 68 | stated as a numeric target |

⚠️ **One number is still unconfirmed: KPI-1's MAPE ≤ 0.5%.** The founder verified
80 / 50 / 68 against §1.3 on 2026-08-14 and did not verify this one. §1.3 lists
"Data Consistency" as a metric; whether it names 0.5% is **not yet checked**.
Until it is, KPI-1's gate is cited as coming from the DLQ sprint brief
(2026-08-05), which is where it is known to be written down. Check the proposal
and update this line — it is the difference between a Class 1 and a Class 2
citation on the one KPI that already passed.

**Class 2 — self-defined operationalisation, ours, declared here first.**
Proposal §1.3 says only *"sustaining stable response times for 50 concurrent
users"*. **"Stable" is not measurable as written**, so this document converts it
into two testable quantities. They are **not** proposal figures and must never
be cited as such — in the chapter, in a slide, or in a defence answer:

| Value | Basis |
|---|---|
| `http_req_duration p(95) < 2000 ms` | Nielsen, *Usability Engineering* (1993): 1 s preserves flow of thought, 10 s exhausts attention. Google Core Web Vitals rates LCP ≤ 2500 ms as "good". 2000 ms is a conservative point between the two, applied at p95 rather than the mean so that the tail — the experience a real user actually complains about — is what is gated. |
| `http_req_failed rate < 0.01` | Conventional SLO practice (Beyer et al., *Site Reliability Engineering*, 2016): a 99% success floor. Below it, roughly 1 request in 100 fails, which is visible to a user within a single session. |

The p95 and error-rate figures originate from our own planning slides, not from
the proposal, and this table is the disclosure of that.

### Decisions taken 2026-08-14, before pre-registration

1. **Deploy the frontend to Vercel; do NOT deploy `mock-api`.** The Meta token
   stays on the founder's machine. See §"Deployment prerequisites".
2. **KPI-6 runs against the production URL, not localhost.** No deviation is
   incurred — see the reasoning in KPI-6.
3. **KPI-4 gates on desktop and additionally reports mobile, ungated.**
4. **Security headers were added to `vercel.json` before this file was
   committed** — see the note in KPI-7.

---

## Summary table — for Chapter 4

| KPI | Group | What it measures | Threshold | Instrument | Status |
|---|---|---|---|---|---|
| KPI-1 | A · Data Integrity | Stored `meta_live` rows vs Meta Ads Manager export | MAPE ≤ 0.5% | `tests/verify_reconcile.py` | ✅ **PASS** — 0.0000% on all 5 metrics, 81/81 cells, 27/27 rows |
| KPI-2 | A · Data Integrity | Valid files that met their declared outcome in full | 100% | `tests/test_ingestion_kpi.py` | ✅ **PASS** — 20/20 (100%) |
| KPI-3 | A · Data Integrity | Malformed files dead-lettered with right code and zero leakage | 100% | `tests/test_ingestion_kpi.py` | ✅ **PASS** — 12/12 on all three axes |
| KPI-4 | B · Performance | Lighthouse Performance score, production build | ≥ 80 / 100 (desktop gates; mobile reported) | Lighthouse CLI | ⬜ Not started — blocked on deploy |
| KPI-5 | B · Performance | Latency and error rate at 50 concurrent users | p95 < 2000 ms · fail < 1% *(self-defined)* | k6 | ⬜ Not started — blocked on deploy |
| KPI-6 | C · Usability | System Usability Scale after task completion | ≥ 68 | SUS (Brooke 1996) + task metrics | ⬜ Not started — blocked on participants |
| KPI-7 | D · Security | OWASP Top 10 (2021) applicability + automated scan | 0 High/Critical · 10/10 categories answered | Matrix + OWASP ZAP baseline + `npm audit` | ⬜ Not started — matrix can start now |

**Group A is closed.** Nothing in this document reopens it.

Threshold class, for the chapter: **KPI-1, KPI-4, KPI-6 and the 50-VU load
level are proposal figures. The KPI-5 latency and error-rate numbers are ours.**
KPI-2/KPI-3's 100% comes from the DLQ sprint brief, and KPI-7's criteria from
the advisor's instruction plus OWASP's own category list.

---

## Deployment prerequisites (blocks KPI-4, KPI-5, KPI-7 layer 2)

The application is **built and working locally** — it is not "no frontend". What
does not exist is a **production deployment**, and three of the four new KPIs
are defined against one.

| Fact | State today |
|---|---|
| React app | ✅ builds (`npm run build`, 13 MB `dist/`, entry chunk 919 kB / 261 kB gzip) |
| `vercel.json` | ✅ present — SPA rewrite **plus the security headers added 2026-08-14** (CSP, HSTS, nosniff, DENY, Referrer-Policy, Permissions-Policy, COOP) |
| Vercel project linked | ❌ no `.vercel/` in the repo; never deployed from this machine |
| Production env vars | ❌ `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_BACKEND_API_URL` must be set in the Vercel project |
| `mock-api` (Express, :3001) | ❌ local only. It hosts `/api/connect`, `/api/meta/sync` and `/validate-key` |

### DECIDED: deploy the frontend only. `mock-api` stays local.

The browser reads Supabase directly, so **KPI-4, KPI-5 and KPI-6 need no
connector service at all**. Only the *connect / sync* write path does, and that
path is driven by the researcher, not by a study participant.

**The production URL and the local machine read the same cloud database.** Data
is synced from the researcher's machine into Supabase beforehand; the deployed
site then serves it. So no Meta credential ever leaves the local machine, and
**no localhost deviation is incurred** — the participant works against the real
deployment, on real synced data.

| | |
|---|---|
| Deployed | React SPA → Vercel |
| Not deployed | `mock-api` (Express) — holds `META_ACCESS_TOKEN`; deploying it would put the credential on a third-party host for no measurement gain |
| Consequence for KPI-6 | Tasks must not require connecting an account. This was already forced: **a participant has no ad account of the researcher's to connect.** See KPI-6. |
| Consequence for KPI-7 | Scan target is the Vercel origin only. `mock-api` is out of scope and the matrix says so. |

---

# Group A — Data Integrity (frozen)

## KPI-1 — Data accuracy against the platform's own reporting

| | |
|---|---|
| **Claim under test** | Rows this system stored for a real Meta ad account equal what Meta's own reporting layer prints for the same account, ad and day. |
| **Operational definition** | Aggregate percentage error per metric between `ad_insights` (`data_source='meta_live'`) and an Ads Manager pivot export at grain ad × day. Tier A gates on impressions, clicks, spend; tier B on the derived CTR and CPC recomputed on both sides; tier C (conversions) is reported and never gates. |
| **Instrument** | `python3 tests/verify_reconcile.py --export <csv>` · pure logic in `tests/reconcile_lib.py` · 30 unit tests |
| **Threshold** | **MAPE ≤ 0.5% aggregate**, per metric |
| **Provenance** | DLQ sprint brief, 2026-08-05, where the gate is written down and from which it was implemented. Proposal §1.3 lists "Data Consistency" as a metric — **⚠️ whether it states 0.5% is unverified**; check and, if it does, upgrade this to a Class 1 citation. Either way the number was fixed before the measurement ran (`tests/reconcile_lib.py`, commit `923fcda`). |
| **Repetition** | Two recorded runs against the same byte-identical export (`sha256 c3165f75…`), plus 3 negative controls that must all FAIL; the program aborts if any control passes |
| **Result** | **PASS** — 0.0000% on impressions, clicks, spend, CTR, CPC · 81/81 cells exact · 27/27 rows · 0 export-only rows |
| **Evidence** | `tests/RESULTS.md` · `reports/reconciliation-20260813T054823Z.json` · `tests/evidence/meta_live_sync/` |

**Chapter 3 must carry this as a dated definitional refinement — and it is an
asset, not a weakness.** The tolerance never moved. What changed, on
**2026-08-13**, is the *coverage* rule: database-only rows carrying zero in all
four reconciled quantities no longer count against coverage, because such a row
cannot make the question "does what we stored equal what the platform reports?"
come out differently. The first definition was measuring whether Meta's export
layer chose to emit an empty row — a property of Meta, not of this pipeline.

Write it up as: **(a)** the date, **(b)** what the first definition measured
wrongly, **(c)** both runs side by side — the FAIL under the old gate and the
PASS under the new one, with byte-identical arithmetic between them — and
**(d)** the stated weakening ("the coverage gate can no longer detect spurious
zero-valued rows"), plus the fact that negative control M1 fires under the new
gate and could not under the old.

A 0.0000% that arrives with its own failed predecessor and an explanation is
more credible than one that arrives alone. **The FAIL run is never deleted.**

**Known limitations:** L-5 (the test account's `purchase` signal is not a sale)
and L-6 (Meta restates a day after it ends, so sync must immediately precede
export). Both in `docs/HANDOFF_INGESTION_KPI.md`.

**Re-measurement note (not a change to the frozen result).** The database was
re-synced on 2026-08-14 (commit `ca13665`) and now holds 32 rows / ฿1,382.64
against the frozen run's 27 rows / ฿1,350.08. A closing re-run on the final data
would need a fresh export. That would be a **new dated run appended** to
`tests/RESULTS.md`, never an edit of the existing one.

## KPI-2 — Ingestion success rate

| | |
|---|---|
| **Claim under test** | A valid merchant file uploaded through `/imports` is ingested completely: job status, DLQ record, resolved dataset and storage artifact all match the outcome declared for it in advance. |
| **Operational definition** | Count of valid fixtures meeting their declared outcome **in full** ÷ 20 valid `ad_performance` fixtures. Partial credit is not awarded. `aux/` files are excluded (limitation L-2). |
| **Instrument** | `python3 -m pytest tests/test_ingestion_kpi.py -v` (~21 min, sequential by design) |
| **Threshold** | **100%** |
| **Provenance** | DLQ sprint brief, 2026-08-05 (founder-approved KPI-2 confusion matrix A–E) |
| **Repetition** | 35/35 fixtures identical across two full runs |
| **Result** | **PASS** — 20/20 (100%) |
| **Evidence** | `tests/RESULTS.md` · `tests/evidence/` · expectations hand-declared in `tests/fixtures/MANIFEST.json` |

## KPI-3 — Dead-letter capture

| | |
|---|---|
| **Claim under test** | A malformed file is refused atomically: it produces a dead-letter record, with the correct error code, and leaks no row into any fact table. |
| **Operational definition** | Three independent axes over 12 scored malformed fixtures — (a) DLQ record exists, (b) error code correct, (c) zero rows across the six tables `promote_batch` writes plus `ingestion_staging`. |
| **Instrument** | as KPI-2 |
| **Threshold** | **100%** on each axis |
| **Provenance** | DLQ sprint brief, 2026-08-05 |
| **Repetition** | as KPI-2 |
| **Result** | **PASS** — 12/12 · 12/12 · 12/12 |
| **Evidence** | `tests/RESULTS.md` |

**Declared exclusion:** `fix_13` (UTF-16) is a **documented XFAIL** — a known
unfixed bug, excluded from the denominator (12 scored, not 13) and named as
such. It is pinned deliberately so that a fix, if made, yields before/after
evidence.

---

# Group B — System Performance

## KPI-4 — Lighthouse Performance

| | |
|---|---|
| **Claim under test** | The production build of the customer-facing application meets an accepted front-end performance bar on the class of device it is built for. |
| **Threshold** | **Performance ≥ 80 / 100** on the **desktop** preset, gated. Accessibility, Best Practices and SEO reported, not gated. Mobile preset reported, not gated. |
| **Provenance** | **Class 1 — proposal §1.3**, verified 2026-08-14. The *preset* is not in the proposal and is declared below. |

### Preset: **desktop gates, mobile reports**. Declared here, before any run.

Justification for gating on desktop, and it is a project fact rather than a
preference: **this application is desktop-only by construction and mobile is an
explicit non-goal**, ruled by the founder on 2026-07-23 ("ไม่ต้องสนมือถือครับ
โฟกัสแค่บนเว็บ"). `MainLayout.tsx:33` hard-codes `pl-72` with no breakpoint and
`AppSidebar` never becomes a drawer. The mobile preset also applies a 4× CPU
slowdown and a simulated 3G profile, which would score a viewport the product
deliberately does not serve.

**But the proposal's Objective 3 says "responsive UI", and a committee member
reading closely will notice the tension.** Answering it with silence is worse
than answering it with a number. So:

- **Desktop preset gates KPI-4.** Pass/fail is decided here and nowhere else.
- **Mobile preset is run on the same three routes, same 6-runs-discard-1
  protocol, and reported as informational.** It costs a few extra minutes and it
  converts "what about responsive?" from an ambush into a pre-answered question
  with evidence attached.
- The chapter states plainly: mobile figures are **descriptive only**, no
  threshold was pre-registered against them, and the product's stated scope is
  desktop web.

This stance goes to the advisor **in advance**, in the same message as the
KPI-6 fallback approval — see §"Advisor approvals to obtain before measuring".

### Routes: three, locked before running

| # | Route | Auth | Why this one represents the system |
|---|---|---|---|
| R1 | `/` (landing) | no | The only route an unauthenticated visitor sees, and the sole entry point. Cold, uncached, no session — the one page where first-load cost is fully exposed. |
| R2 | `/dashboard` | yes | The core loop and the heaviest page in the app: Recharts area chart, five React Query hooks, the widest `ad_insights` read on the hottest path. If any route fails the bar, this is it. |
| R3 | `/imports` | yes | The research subject — the file-ingestion leg KPI-2/KPI-3 measure — rendered as a merchant sees it: job list, per-stage progress, rejected-row panel. |

`/analytics` was considered and rejected: it shares `useDashboardMetrics` with
R2, so it would spend a third of the measurement re-testing the same read path.

### Environment

- **Where:** production deployment on Vercel only. **A dev-server measurement is
  not a KPI-4 result** and must not appear in the chapter.
- **Pin into every report header:** commit sha · Vercel deployment id · Chrome
  version · Lighthouse version · OS · CPU · wall-clock time (ICT) · network
  (wired/Wi-Fi, downlink) · whether any other load was running.
- **Machine:** one machine for all 18 runs. Mixing machines invalidates the
  median.

### Procedure

1. Deploy the commit under test; record the deployment id.
2. Authenticate once with Puppeteer against the e2e account, then run Lighthouse
   against the **same** browser instance (`--port`, `disableStorageReset: true`).
   Supabase keeps its session in `localStorage`, so a fresh Lighthouse profile
   would be redirected to `/auth` and R2/R3 would silently measure the login
   page instead. This is the single largest trap in KPI-4.
3. Per route, per preset: **6 runs. Discard run 1** (cold start / edge-cache
   warm-up). Median of runs 2–6. That is 3 routes × 2 presets × 6 = **36 runs**,
   30 of them scored.
4. Emit the **full JSON report for every run, including the discarded one**.
5. Report per route: median Performance, min/max across the 5 scored runs, and
   the median of FCP / LCP / TBT / CLS / Speed Index. Desktop and mobile in
   separate tables, mobile labelled *informational — not gated*.

### Verdict rule

**All three routes must meet ≥ 80 on the desktop preset.** A single failing
route fails KPI-4 — an average across routes would let the landing page carry
the dashboard. **A mobile score never changes the verdict**, in either
direction.

### If it fails

Report the failure with the per-metric breakdown naming the dominant cost.
Then, as a **separate and separately dated** activity: one optimisation pass,
re-measure, and report **before/after side by side**. The threshold does not
move. A known candidate is already on record — the entry chunk is 919 kB
(261 kB gzip) after the F-5 split, and route-level code splitting is the obvious
next step — but no optimisation is done before the first measurement, because
then there would be no "before".

### Evidence

```
evidence/kpi4-lighthouse/<commit-sha>/
  meta.json                          env pin, versions, deployment id
  desktop/R1-landing/run-1..6.json   raw JSON, run-1 marked discarded
  desktop/R2-dashboard/run-1..6.json
  desktop/R3-imports/run-1..6.json
  mobile/R1-landing/run-1..6.json    informational, same protocol
  mobile/R2-dashboard/run-1..6.json
  mobile/R3-imports/run-1..6.json
  summary.md                         medians, spread, verdict (desktop gates)
```

## KPI-5 — Load test at 50 concurrent virtual users

| | |
|---|---|
| **Claim under test** | Under 50 concurrent users performing a realistic read journey, the system answers within an acceptable latency and without an elevated error rate. |
| **Thresholds (in the script, as k6 `thresholds`)** | `http_req_duration p(95) < 2000` · `http_req_failed rate < 0.01` |
| **Provenance — read this carefully** | **The load level (50 concurrent users) is Class 1: proposal §1.3.** **Both threshold numbers are Class 2: self-defined.** §1.3 says only *"sustaining stable response times for 50 concurrent users"*, which states no number. This document operationalises "stable" as p95 < 2000 ms and a failure rate under 1%, on the bases given in §"Threshold provenance". **Never present either figure as a proposal requirement.** |

### System under test — boundary, stated explicitly

| Component | In / out | Reasoning |
|---|---|---|
| Vercel static hosting + CDN | **IN** | Serves the SPA; first-load cost is part of what a user waits for. |
| **Supabase managed Postgres + PostgREST + Auth** | **IN** | This is the answer to the question the brief asks. The product has **no application server of our own** — the browser queries PostgREST directly. Excluding Supabase would leave nothing to load-test. |
| Our RLS policies, indexes, query shapes | **IN** | These are our engineering and they are what the load exercises. |
| Supabase **free-tier capacity** (connections, CPU, rate limits) | **IN, but as an inherited constraint** | Reported as a property of the deployment tier, never claimed as our design. |
| `mock-api` (Express) | **OUT** | Not on the read path; see the deployment decision above. |
| **Meta Graph API** | **OUT — hard exclusion** | No scenario may call it, in any iteration, for any reason. It is a third party's production system, it is rate-limited, and load-testing someone else's API is not ours to do. The scripts must contain no Graph host at all, and this is checked by reading the script, not by trusting the author. |

### Scenario — a journey, not an endpoint

Modelled on what the dashboard actually issues, so the load is the product's
own traffic shape rather than a synthetic hot loop:

| Step | Request | Think-time after |
|---|---|---|
| 1 | Load the SPA shell + entry chunk (Vercel) | 3 s |
| 2 | `POST /auth/v1/token?grant_type=password` — one login per VU, token reused | 1 s |
| 3 | `GET /rest/v1/workspaces` + `profile_customers` (session bootstrap) | 2 s |
| 4 | `GET /rest/v1/ad_accounts?select=id,platform_id&team_id=eq.<ws>` | 1 s |
| 5 | `GET /rest/v1/ad_insights?select=date,impressions,clicks,spend,conversions,reach,revenue,roas,data_source&ad_account_id=in.(…)&data_source=in.(…)&date=gte.…&date=lte.…&order=date.asc` — the dashboard's widest read | 5 s |
| 6 | Three `HEAD` count queries (`useAdSourceCounts`) | 4 s |
| 7 | Re-query step 5 with a different date range — a user changing the window | 6 s |

**Think-time:** `sleep()` values above, drawn uniformly ±30% around each figure.
Reasoning: steps 3–4 are machine-driven and follow immediately; 5–7 follow a
human reading a chart. Median dwell on an analytics view is measured in seconds,
not milliseconds, and a zero-sleep script would report a throughput no real
population produces — inflating the load while making the latency number
meaningless. The ±30% jitter prevents 50 VUs marching in lockstep, which
produces artificial thundering-herd spikes.

**Load profile:** ramp 0 → 50 VU over **2 min** · hold 50 VU for **5 min** ·
ramp down over **1 min**. Total 8 min per run.

**Data:** a **dedicated load-test workspace**, seeded in advance, scoped by
`team_id`. Never the research workspace whose rows are KPI-1/2/3 evidence.
Read-only journey — no writes, no deletes (CLAUDE.md §8).

**Users:** a pool of ~10 seeded accounts, VUs cycling through them. A single
shared account would exercise one RLS evaluation path and one connection-reuse
pattern, which is not what 50 distinct merchants look like.

### Repetition

**3 full runs** on the same commit, at least 30 minutes apart (free-tier
throttling state is not instantaneous). Report **median of the three** for each
threshold metric, plus min/max. Runs at different times of day are noted as
such.

### Saturation is a result, not a failure

If the free tier saturates before 50 VU, that is a finding and it gets reported
as one. The run must therefore record **where** it saturated:

- `http_req_failed` broken down by status code — `429`/`503` = rate limit or
  pool exhaustion; `5xx` from PostgREST = backend; timeouts = queueing.
- The VU count and wall-clock second at which p95 crossed 2000 ms.
- Supabase dashboard observations at that moment (connections, CPU) —
  screenshotted with a timestamp, since the free tier's metrics are not
  exportable.
- A stated conclusion naming the bottleneck: connection pool, CPU, or rate
  limit. "It got slow" is not a finding.

### If it fails

Report the fail with the saturation analysis. Do **not** re-run at 30 VU and
report that instead — the KPI is defined at 50. A supplementary "capacity
curve" run (10/20/30/40/50 VU) may be added **as additional evidence beside the
failed KPI**, clearly labelled, because it turns a fail into a quantified limit.
The threshold does not move.

### Evidence

```
evidence/kpi5-k6/<commit-sha>/
  meta.json          env pin, seeded workspace id, user pool size
  script.js          the exact script executed
  run-1/summary.json + run-1/metrics.csv    (time series)
  run-2/… run-3/…
  saturation.md      bottleneck analysis, dashboard screenshots
  summary.md         medians, spread, verdict
```

---

# Group C — Usability

## KPI-6 — System Usability Scale

| | |
|---|---|
| **Claim under test** | People who have run ads themselves rate the system's usability at or above the population average, after performing its core tasks. |
| **Threshold** | **SUS ≥ 68** |
| **Provenance** | **Class 1 — proposal §1.3**, verified 2026-08-14. Independently supported by Sauro & Lewis, *Quantifying the User Experience* (2016) and Bangor, Kortum & Miller (2008): 68 is the mean of a large SUS corpus, i.e. "average", not "good" — worth saying in the chapter so the bar is not oversold. |
| **Where** | **The production Vercel URL.** Not localhost, and no deviation is recorded — see below. |
| **Instrument** | SUS, 10 items, alternating polarity, 1–5 Likert (Brooke, 1996). Odd items score (response − 1), even items (5 − response), sum × 2.5 → 0–100. |

⚠️ **Instrument-translation limitation, to be stated in the chapter.** Sessions
will be run in Thai, so the items are administered in Thai. A translated SUS is
not the validated English instrument; the English wording is kept alongside each
item in the form, and the score is reported as "SUS (Thai administration)".

### Participants

- **n ≥ 5 minimum, 8–12 target.** Nielsen & Landauer (1993) for the 5-user floor
  on qualitative discovery; ≥ 8 narrows the SUS confidence interval enough for
  the mean to be worth reporting.
- **Inclusion:** has personally run paid ads, or personally reads ad performance
  numbers, in the last 12 months. Screened with one question before booking.
- **Exclusion:** anyone who worked on this project or has seen the app before.
- Session length ~45 min: 5 brief, 25 tasks, 5 SUS, 10 debrief.
- Consent form; recording optional and not required to participate; no personal
  data beyond role and ad-experience band retained.

### Task design — read, interpret and decide. No account connection, no upload.

**Why the connect/upload tasks were removed.** A participant has no ad account
of the researcher's to connect, and no credential should be handed to one — so
"เชื่อมบัญชี" was never a task a participant could genuinely perform; it would
have been a scripted click-through wearing the costume of a task. Uploading has
the same problem in the other direction: ingestion is driven by an Airflow stack
on the researcher's machine, so a participant's upload would be measuring
whether that laptop was awake.

**What remains is what the product is for**: reading numbers, knowing where they
came from, and judging whether to trust them. All five tasks are pure read
paths, all work against the production URL on data synced beforehand, and
therefore **no methodological deviation is incurred at all.**

Participants sign in with a **study account** provided by the facilitator
(read-only over a seeded workspace). The account is the same for every session;
because every task is a read, no reset between sessions is needed.

| # | Task (given in Thai) | Success = | Also recorded |
|---|---|---|---|
| **T1** | ในช่วง 30 วันล่าสุด ร้านนี้ใช้เงินโฆษณาไปเท่าไร และวันไหนมีการแสดงผลสูงสุด | Both values read correctly off the screen, unaided | time, mis-reads |
| **T2** | เปลี่ยนมุมมองให้เห็นเฉพาะข้อมูลจริง แล้วบอกว่าตัวเลขที่เห็นตอนนี้มาจากแหล่งใด | Participant uses the source picker **and** names the source from the picker or the provenance badge | time, whether the badge or the picker carried it |
| **T3** | ตัวเลข ROAS บนหน้านี้เชื่อได้แค่ไหน เพราะอะไร | Participant identifies the `≥` as a lower bound, **or** — on a source that shows "—" — correctly explains why no figure is given | time, whether the caption was read at all |
| **T4** | ไฟล์ที่เคยอัปโหลดเข้ามา มีแถวที่ระบบไม่รับกี่แถว และเพราะอะไร | Participant finds the failed import on `/imports` and names **≥ 1 correct rejection reason** | time, whether they found the downloadable report |
| **T5** | ข้อมูลในระบบครอบคลุมช่วงเวลาไหน และถ้าอยากดูทั้งหมดต้องทำอย่างไร | Participant states the covered range and reaches the full-range view (jump link or date picker) | time, assists |

T3 and T4 are the ones that matter most for this thesis: the honesty UI (a
withheld or bounded figure) and the DLQ panel are the research contribution, and
a study that only measured chart-reading would leave both untested. T4 reads a
failed import **that already exists in the workspace** — nothing is uploaded
during a session.

### Objective measures collected alongside SUS

SUS is perception only. Each session also records **task success rate**
(binary per task, per participant), **time-on-task** (seconds, first click to
success criterion), and **assists** (count of times the facilitator had to
unblock). Reported as a table beside the SUS score, plus a per-task success
percentage. No threshold is pre-registered for these — they are descriptive
context, and inventing a bar for them now would be the HARKing this file exists
to prevent.

### Reporting

Mean SUS with standard deviation and a 95% CI, every individual score listed,
the adjective rating (Bangor et al.) for the mean, and the per-task table. n
stated everywhere the mean appears.

### If it fails, or if participants cannot be found

**KPI-6 is never silently dropped.** Two academically acceptable substitutions,
either of which requires **advisor approval — obtained in advance, not at the
moment of failure** (see §"Advisor approvals") — and is recorded as a deviation
in the methodology chapter, naming the reason and the date:

- **Fallback A — Heuristic evaluation.** Nielsen's 10 usability heuristics
  (1994), **3 independent evaluators**, each rating severity 0–4 per finding,
  findings merged and de-duplicated. Reported as a count of findings by severity
  and heuristic, with the highest-severity items described. Replaces the SUS
  *number* with a structured qualitative result — this must be said plainly,
  since a heuristic evaluation cannot produce a score comparable to 68.
- **Fallback B — Cognitive walkthrough** (Wharton et al., 1994) over the same
  five tasks, 3 evaluators, answering the four standard questions at each step.
  Better suited if the concern is task discoverability rather than general
  usability.

If n lands between 3 and 4, report SUS **with the raw scores and an explicit
"below the pre-registered minimum n, treated as indicative only"** — and still
run Fallback A. Do not present an under-powered mean as if it met the bar.

### Evidence

```
evidence/kpi6-sus/
  protocol.md              script, consent text, screening question
  form-th.md               the 10 items, Thai + English
  P01.json … P0n.json      per participant: responses, task outcomes, times
  summary.md               mean/SD/CI, per-task table, verdict
```

---

# Group D — Security

## KPI-7 — OWASP Top 10 (2021) assessment

| | |
|---|---|
| **Claim under test** | Every OWASP Top 10 (2021) category has been considered against this system; the controls claimed are real and verifiable; and an automated passive scan of the production deployment finds no High or Critical issue. |
| **Provenance** | Advisor instruction (added to the proposal's metric set). Categories from OWASP Top 10:2021. |
| **Instrument** | (1) applicability matrix, hand-written, verifiable; (2) OWASP ZAP **baseline** (passive) scan; (3) `npm audit`. |

### Pre-registered pass criteria

| # | Criterion |
|---|---|
| 1 | Applicability matrix answers **10/10** categories. An `N/A` is only valid with a written reason. |
| 2 | ZAP baseline: **0 High and 0 Critical** alerts. Medium / Low / Informational are recorded, analysed, and each given either a remediation plan or a written justification for acceptance. |
| 3 | `npm audit --omit=dev`: **0 Critical** vulnerabilities in production dependencies. High/Moderate recorded with the same treatment as (2). |
| 4 | Both scans run **twice on the same commit**; the two results must agree. A disagreement is itself reported and investigated before any verdict is written. |

### Layer 1 — Applicability matrix (all ten, no skipping)

Each row answers three questions: **(a)** does it apply here, and if not why
not; **(b)** what control exists, pointing at a real artifact — a migration, a
policy name, a file and line; **(c)** how that control is *verified* to work,
not merely asserted.

**Shared-responsibility column is mandatory.** Every control is labelled
**`ours`** or **`inherited`** (Supabase-managed Postgres/Auth/Storage, Vercel
edge/TLS). An inherited control may be cited as part of the system's security
posture but **must not be presented as this project's engineering**. Getting
this line wrong is the most common way an undergraduate security chapter
overclaims.

Starting points already in the repository — to be verified at assessment time,
not copied on faith:

| Cat | Likely applicability | Control to verify | Whose |
|---|---|---|---|
| A01 Broken Access Control | **applies — the central one** | RLS on every table; `TeamPermissionsGuard`; employee roles (`dev`/`support`/`owner`); the F-1…F-4 pass (`13f9e11`) wrapping `auth.uid()` in 321 policies and closing an anon-visible oracle | ours (policies) + inherited (enforcement engine) |
| A02 Cryptographic Failures | applies | TLS by platform; tokens server-side only in `mock-api/.env`; the `VITE_*` rule (a `VITE_`-prefixed secret ships to every browser) | ours (secret handling) + inherited (TLS) |
| A03 Injection | applies, narrowly | No hand-built SQL on the client; PostgREST parameterisation; Zod validation on forms; the ingestion validator | ours + inherited |
| A04 Insecure Design | applies | All-or-nothing ingestion, DLQ, provenance column (`data_source`), the delete-guard rule "a sync may only delete what a sync wrote" | ours |
| A05 Security Misconfiguration | applies | `vercel.json` **now sets** CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP (added 2026-08-14, before pre-registration); RLS default-on; service_role key never in the browser bundle. **Declared CSP exceptions, with reasons:** `style-src 'unsafe-inline'` (Radix and Recharts write inline style attributes), `fonts.googleapis.com`/`fonts.gstatic.com` (`src/index.css:1` imports webfonts), `api.ipify.org` (`src/lib/auditLogger.ts:46` fetches the client IP for audit rows) | ours |
| A06 Vulnerable Components | **always applies** | `npm audit --omit=dev` over 57 prod dependencies; pinned Airflow image `buzzly/airflow:3.2.2` | ours |
| A07 Identification & Auth Failures | applies | Supabase Auth; session handling; `onAuthStateChange` wiring; employee auth path | mostly inherited — say so |
| A08 Software & Data Integrity | applies | `package-lock.json` committed; migrations append-only; frozen fixture corpus with declared expectations | ours |
| A09 Logging & Monitoring | applies | `error_logs`, `audit_logs_enhanced`, `sync_history`, `logError`; note what is **not** alerted on | ours |
| A10 SSRF | likely partial N/A | The app makes no user-controlled outbound requests; `mock-api` calls only fixed Meta hosts — **verify before writing N/A** | ours |

### Layer 2 — Automated scanning

**ZAP baseline, passive only.**

- `ghcr.io/zaproxy/zaproxy:stable`, **pinned by digest**, version recorded in
  the report header.
- Target: the production Vercel URL. Authenticated scanning is **out of scope**
  for this assessment; the baseline runs unauthenticated and the limitation is
  stated.
- Two runs on the same commit, results compared.

**`npm audit --omit=dev --json`**, twice, same commit, same lockfile.

### Explicit prohibition, and why it is scoping rather than an excuse

**No active scan, no injection attempt, no fuzzing, no authentication attack —
against Supabase, Vercel, or Meta, at any time.** These are multi-tenant managed
platforms; active testing without written authorisation violates their terms and
would put load and attack traffic onto infrastructure shared with other
customers. A full penetration test also requires a scoped engagement,
authorisation in writing, and a rollback plan — none of which an undergraduate
thesis is positioned to obtain.

The correct scope at this level is therefore: **a complete, reasoned
applicability matrix backed by a passive baseline scan and a dependency audit**,
with the boundary stated. The chapter says what was *not* tested and why, which
is a stronger position than an unstated gap.

### Why the security headers were added *before* pre-registration, and why that is not gaming the result

KPI-7 is **an assessment of the system as submitted**, not a before/after
remediation study. Its criterion is "0 High/Critical on the delivered system".
Setting response headers is ordinary implementation work — the same class of
work as writing an RLS policy — and doing it before the measurement is how a
system arrives at its assessment in a defensible state.

The timing is what keeps it clean: the headers landed on **2026-08-14, before
this specification was committed**, so no pre-registered threshold existed to
bend. Had the spec already been frozen and a High alert already recorded, the
fix would have been a dated remediation with both scans reported. That
distinction is the whole reason this document is reviewed before it is
committed.

**Post-deploy verification is mandatory before any scan counts.** A CSP that
breaks the application would otherwise be "measured" as a clean scan of a broken
page. Smoke checklist, on the deployed URL, with the browser console open:

1. `/` renders, webfonts load (Inter · IBM Plex Sans Thai), zero CSP violations.
2. Login works, `/dashboard` renders charts, realtime `wss://` connects.
3. `/imports` renders; the rejected-rows panel opens; the error report downloads.
4. **PDF and Excel export** — `jspdf`/`html2canvas`/`xlsx` are the libraries most
   likely to need `blob:`/`worker-src`, or to trip `script-src 'self'` if any of
   them evaluates generated code. If one does, the exception is **recorded with
   its reason in the matrix**, never added silently.
5. Any console CSP violation is fixed, and the fix is re-verified, before the
   first counted scan.

### If it fails

- **High/Critical from ZAP:** report it, fix it, re-scan, and report before/after
  as two dated runs. Any fix at that stage is a **code change requiring
  approval**, not something the measurement performs on its own.
- **Critical in `npm audit`:** report, upgrade if a fixed version exists, re-run.
  If no fix exists, document the exposure and the compensating control.
- **A category that cannot be answered:** it stays unanswered in the matrix with
  the reason. An honest gap beats an invented control.

### Evidence

```
evidence/kpi7-security/<commit-sha>/
  matrix.md                    A01–A10, all three columns + ours/inherited
  zap/run-1.html + run-1.json  raw, both runs
  zap/run-2.html + run-2.json
  npm-audit/run-1.json + run-2.json
  summary.md                   verdict against the four criteria
```

---

## Advisor approvals to obtain before measuring

Both go in **one message, sent before any KPI-4…7 run**, because approval
obtained in advance is pre-registration and approval obtained afterwards is
explanation.

| # | What to ask | Why in advance |
|---|---|---|
| 1 | **KPI-6 fallback, pre-approved.** State the recruitment plan (n ≥ 5, target 8–12, inclusion criteria) and ask for approval *now* to substitute Nielsen heuristic evaluation (3 evaluators, severity 0–4) or a cognitive walkthrough **if and only if** recruitment falls short — with the substitution recorded as a dated deviation. | Asking after recruitment fails looks like an excuse. Asking before makes the contingency part of the method. |
| 2 | **KPI-4 preset stance.** Desktop gates because mobile is an explicit product non-goal; mobile is run and reported as informational so that proposal Objective 3's "responsive UI" is answered with data rather than silence. Ask whether the advisor accepts the split or wants mobile gated too. | The tension between "responsive UI" in the proposal and desktop-only in the build is visible to any careful reader. Better raised by the author than by the committee. |

Record the reply — date, and verbatim wording where it decides anything — in
`evidence/approvals/`. If the advisor changes a threshold, **this file changes
and is re-committed before any run**, and the change is itself dated.

## Evidence layout (all new KPIs)

```
evidence/
  kpi4-lighthouse/<commit-sha>/
  kpi5-k6/<commit-sha>/
  kpi6-sus/
  kpi7-security/<commit-sha>/
```

Group A evidence stays exactly where it is (`tests/RESULTS.md`,
`tests/evidence/`) and is not moved into this tree. Relocating frozen evidence
to make a directory tidy would break every path already cited.

Every `meta.json` carries at minimum:

```json
{
  "kpi": "KPI-4",
  "commit": "<sha>",
  "deployment": "<vercel deployment id>",
  "measured_at": "2026-08-__T__:__:__+07:00",
  "machine": {"os": "...", "cpu": "...", "ram_gb": 0},
  "network": {"type": "wired|wifi", "downlink_mbps": 0},
  "tools": {"node": "v22.19.0", "npm": "10.9.3", "chrome": "...", "lighthouse": "..."},
  "spec_commit": "<sha of this file at the time of the run>"
}
```

`spec_commit` is what makes pre-registration checkable: it proves which version
of the thresholds was in force when the number was produced.
