# KPI-5 — load test at 50 concurrent virtual users

The specification is `docs/KPI_SPEC.md` §"KPI-5". It is pre-registered, so it
is the authority: this directory implements it and does not reinterpret it.
Every number below is copied from there.

| | |
|---|---|
| Load level | **50 VU — Class 1**, proposal §1.3 |
| Thresholds | `http_req_duration p(95) < 2000` · `http_req_failed rate < 0.01` — **Class 2, self-defined**. §1.3 says only "sustaining stable response times" and states no number. **Never present either as a proposal requirement.** |
| Profile | ramp 0→50 over 2 min · hold 50 for 5 min · ramp down 1 min (8 min/run) |
| Repetition | **3 runs on the same commit, ≥30 min apart.** Report the median, plus min/max. Note the time of day. |

## What the ten accounts do, and what they do not

The spec asks for "**a pool of ~10 seeded accounts, VUs cycling through them**"
against "**a dedicated load-test workspace**" — ten users, one workspace — and
gives the reason: a single shared account "would exercise one RLS evaluation
path and one connection-reuse pattern, which is not what 50 distinct merchants
look like". With 50 VUs and 10 accounts, five VUs share each login and each VU
holds its own session.

**That buys ten distinct identities, not ten distinct tenants.** Every RLS
policy is genuinely evaluated against ten different `auth.uid()` values over ten
separate JWTs and connection patterns, which is what the spec's reasoning asks
for. But all ten are members of the same workspace, so they read the *same rows*
— the same index ranges, warm in the same cache. Fifty real merchants would hold
fifty row sets and touch the index far less predictably.

So this run measures **latency under 50 concurrent sessions on one tenant's
data**, and that is what the write-up must say. Read as "the system serves 50
concurrent merchants" it would claim more than the fixture supports. The
limitation belongs in the results chapter next to the number, not left for a
reader to work out.

## Prerequisites

**1. The deployment. ✅ RESOLVED — live at `https://buzzly-dev.vercel.app`, and
serving the current `main` since 2026-09-07** (it answered 200 from 09-06 but was
still serving an older build until the Vercel author block was cleared). The spec puts Vercel hosting and CDN **inside** the
system under test, and step 1 of the journey loads the SPA shell from it. A run
without `SITE_URL` measures a different system than KPI-5 defines, so the script
refuses to start without one.

**2. A collision with the ingestion KPI. ✅ RESOLVED 2026-09-06 in `b4b8140`.**
Seeding this fixture writes ~2,400 `ad_insights` rows. `tests/kpi_harness.py` holds
`PROTECTED_BASELINE = {"ad_insights": 881, …}` and computes it as *the whole
table minus the ingestion test workspace*, so those rows read as live research
data changing and every later ingestion run aborts.

**The baseline was not edited.** `protected_counts()` now subtracts this
fixture's ad accounts, exactly as the ingestion fixture already was, so the
guard keeps meaning "live rows must not change" and no threshold moved.
`tests/test_protected_scope.py` (6 tests) proves it can still fail: real drift
in either direction still aborts, and the old scope *would* have aborted on
these same rows.

`scripts/kpi5-seed-loadtest.mjs` no longer asks for a `KPI5_BASELINE_RESOLVED`
promise. It reads `tests/kpi_harness.py` and refuses to run unless **every**
account it is about to write is exempted there — which catches the thing a
promise cannot: adding a third account and forgetting to exempt it.

## Running it

```bash
# 0. k6 (not an npm package)
sudo gpg -k && sudo gpg --no-default-keyring \
  --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt update && sudo apt install k6

# 1. seed once
node scripts/kpi5-seed-loadtest.mjs

# 2. three runs, at least 30 minutes apart
SHA=$(git rev-parse HEAD)
for n in 1 2 3; do
  mkdir -p "evidence/kpi5-k6/$SHA/run-$n"
  K6_USER_PASSWORD='K6Load!2026' SITE_URL=https://<prod>.vercel.app \
    k6 run --out "csv=evidence/kpi5-k6/$SHA/run-$n/metrics.csv" \
           --summary-export="evidence/kpi5-k6/$SHA/run-$n/summary.json" \
           k6/kpi5-dashboard-journey.js
  # wait ≥30 min before the next one — free-tier throttling state is not instantaneous
done
```

Then copy the script itself into `evidence/kpi5-k6/$SHA/script.js`, so the
evidence records what was executed rather than what the repository holds now.

## Reading the result

**Saturation is a finding, not a failure to hide.** If the free tier gives out
before 50 VU, the run must say *where*:

- `failures_by_status` — the script tags every non-2xx with its step and status
  code, because `429`/`503` (rate limit or pool exhaustion), `5xx` from
  PostgREST (backend) and timeouts (queueing) name three different bottlenecks.
- The per-step trends (`step1_spa_shell` … `step7_insights_rerange`) say which
  request crossed first. `http_req_duration` alone answers "it got slow", which
  the spec explicitly refuses as a finding.
- The VU count and wall-clock second at which p95 crossed 2000 ms — read off
  `metrics.csv`.
- Supabase dashboard connections/CPU at that moment, screenshotted with a
  timestamp; the free tier's metrics are not exportable.

Write the conclusion naming the bottleneck. **If it fails, report the fail.** Do
not re-run at 30 VU and report that instead — the KPI is defined at 50. A
capacity curve (10/20/30/40/50) may be added *beside* the failed KPI, clearly
labelled, because it turns a fail into a quantified limit. The threshold does
not move.

## What is deliberately not tested

The **Meta Graph API is a hard exclusion** — a third party's production system,
rate-limited, and not ours to load-test. The spec says this is verified by
reading the script, so read it: the only hosts are `SITE_URL` and the Supabase
URL from the seeded target file.

`mock-api` is out of scope: it is not on the read path, and the deployment
decision in the spec keeps it local.

Everything is read-only except the one login POST that Auth requires, and it all
runs against the dedicated load-test workspace — never the research workspace
(CLAUDE.md §8).
