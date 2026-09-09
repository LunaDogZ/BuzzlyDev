/**
 * KPI-5 — load test at 50 concurrent virtual users.
 *
 * Pre-registered in `docs/KPI_SPEC.md` §"KPI-5". This script implements that
 * specification and nothing else; where a number appears here it is because the
 * spec fixed it, and changing one is changing a pre-registered threshold.
 *
 *   node scripts/kpi5-seed-loadtest.mjs            # once
 *   K6_USER_PASSWORD=… SITE_URL=https://<prod>.vercel.app \
 *     k6 run --out csv=run-1/metrics.csv --summary-export=run-1/summary.json \
 *     k6/kpi5-dashboard-journey.js
 *
 * ── Provenance, restated so it cannot be lost ────────────────────────────────
 * The **load level (50 VU) is Class 1** — proposal §1.3. Both **thresholds are
 * Class 2, self-defined**: §1.3 says only "sustaining stable response times for
 * 50 concurrent users" and states no number. `p(95) < 2000 ms` and a failure
 * rate under 1% are this project's operationalisation of "stable" and must
 * never be presented as a proposal requirement.
 *
 * ── System under test ────────────────────────────────────────────────────────
 * IN:  Vercel static hosting + CDN, Supabase Postgres + PostgREST + Auth, our
 *      RLS policies and query shapes, and the free tier's capacity as an
 *      inherited constraint.
 * OUT: `mock-api` (not on the read path) and **the Meta Graph API, a hard
 *      exclusion**. No scenario may call it for any reason: it is a third
 *      party's production system and load-testing it is not ours to do. The
 *      spec says this is checked by *reading the script* — so read it: the only
 *      hosts below are `SITE_URL` and `supabase_url` from the seeded target
 *      file. There is no Graph host in this file.
 *
 * ── Read-only ────────────────────────────────────────────────────────────────
 * Every request is GET or HEAD except the login, which is the POST that Auth
 * requires. Nothing writes to a table, and the workspace is the dedicated
 * load-test fixture, never the research workspace (CLAUDE.md §8).
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const target = JSON.parse(open('./loadtest-target.json'));

const SITE_URL = (__ENV.SITE_URL || '').replace(/\/$/, '');
const PASSWORD = __ENV.K6_USER_PASSWORD || '';
const SUPA = target.supabase_url.replace(/\/$/, '');
const ANON = target.supabase_anon_key;

// ── Per-step latency, so a fail can name which request saturated ─────────────
// `http_req_duration` alone answers "it got slow", which the spec explicitly
// refuses as a finding. One trend per step turns the same run into "step 5, the
// widest read, is where p95 crosses".
const stepDuration = {
  shell: new Trend('step1_spa_shell', true),
  login: new Trend('step2_login', true),
  bootstrap: new Trend('step3_session_bootstrap', true),
  accounts: new Trend('step4_ad_accounts', true),
  insightsWide: new Trend('step5_insights_wide', true),
  counts: new Trend('step6_source_counts', true),
  insightsNarrow: new Trend('step7_insights_rerange', true),
};

// Failures by status code — the spec wants 429/503 (rate limit or pool
// exhaustion) told apart from 5xx (backend) and from timeouts (queueing),
// because those three name three different bottlenecks.
const failByStatus = new Counter('failures_by_status');

export const options = {
  // Ramp 0 → 50 over 2 min · hold 50 for 5 min · ramp down over 1 min. 8 min.
  stages: [
    { duration: '2m', target: 50 },
    { duration: '5m', target: 50 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    // The two pre-registered numbers. Do not edit.
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
  },
  // A run that dies on connection reuse would report a network artefact as a
  // latency result.
  noConnectionReuse: false,
  userAgent: 'buzzly-kpi5-k6/1.0',
};

/** Uniform ±30% jitter, per the spec: 50 VUs marching in lockstep produce a
 *  thundering herd that is an artefact of the script, not of the product. */
function think(seconds) {
  sleep(seconds * (0.7 + Math.random() * 0.6));
}

/** One login per VU, token reused — so the pool of ~10 accounts is spread
 *  across 50 VUs and each VU keeps its session, as a browser would. */
const session = {};

function authHeaders(token) {
  return {
    apikey: ANON,
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

/** Record a response against its step, and classify a failure by status. */
function record(res, trend, name) {
  trend.add(res.timings.duration);
  const ok = check(res, { [`${name}: 2xx`]: (r) => r.status >= 200 && r.status < 300 });
  if (!ok) failByStatus.add(1, { step: name, status: String(res.status) });
  return ok;
}

export function setup() {
  if (!SITE_URL) {
    throw new Error(
      'SITE_URL is required. The spec puts Vercel hosting IN the system under test, ' +
      'so a run without the deployed origin measures a different system than KPI-5 defines.',
    );
  }
  if (!PASSWORD) throw new Error('K6_USER_PASSWORD is required (see scripts/kpi5-seed-loadtest.mjs)');
  return {
    accountFilter: `in.(${target.ad_account_ids.join(',')})`,
    sourceFilter: `in.(${target.data_sources.join(',')})`,
  };
}

export default function (data) {
  const vu = __VU;

  // ── Step 1 — the SPA shell and its entry chunk, from Vercel ───────────────
  // First-load cost is part of what a user waits for, so it is in the journey.
  const shell = http.get(`${SITE_URL}/`, { tags: { step: 'shell' } });
  record(shell, stepDuration.shell, 'step1_shell');
  think(3);

  // ── Step 2 — one login per VU ─────────────────────────────────────────────
  if (!session[vu]) {
    const email = target.users[vu % target.users.length];
    const res = http.post(
      `${SUPA}/auth/v1/token?grant_type=password`,
      JSON.stringify({ email, password: PASSWORD }),
      { headers: { apikey: ANON, 'Content-Type': 'application/json' }, tags: { step: 'login' } },
    );
    record(res, stepDuration.login, 'step2_login');
    const token = res.json('access_token');
    if (!token) return;            // a VU that cannot sign in has no journey to run
    session[vu] = token;
    think(1);
  }
  const h = authHeaders(session[vu]);

  // ── Step 3 — session bootstrap ────────────────────────────────────────────
  const bootstrap = http.batch([
    ['GET', `${SUPA}/rest/v1/workspaces?select=id,name&limit=20`, null, { headers: h, tags: { step: 'bootstrap' } }],
    ['GET', `${SUPA}/rest/v1/profile_customers?select=id,user_id,first_name&limit=1`, null, { headers: h, tags: { step: 'bootstrap' } }],
  ]);
  bootstrap.forEach((r, i) => record(r, stepDuration.bootstrap, `step3_bootstrap_${i}`));
  think(2);

  // ── Step 4 — the workspace's ad accounts ──────────────────────────────────
  const accounts = http.get(
    `${SUPA}/rest/v1/ad_accounts?select=id,platform_id&team_id=eq.${target.team_id}`,
    { headers: h, tags: { step: 'accounts' } },
  );
  record(accounts, stepDuration.accounts, 'step4_ad_accounts');
  think(1);

  // ── Step 5 — the dashboard's widest read ──────────────────────────────────
  const cols = 'date,impressions,clicks,spend,conversions,reach,revenue,roas,data_source';
  const wide = target.date_range.wide;
  const insights = http.get(
    `${SUPA}/rest/v1/ad_insights?select=${cols}` +
    `&ad_account_id=${data.accountFilter}&data_source=${data.sourceFilter}` +
    `&date=gte.${wide.gte}&date=lte.${wide.lte}&order=date.asc`,
    { headers: h, tags: { step: 'insights_wide' } },
  );
  record(insights, stepDuration.insightsWide, 'step5_insights_wide');
  think(5);

  // ── Step 6 — three HEAD counts (useAdSourceCounts) ────────────────────────
  // `head: true` with `count=exact`: the server counts and returns no rows.
  const countReqs = target.data_sources.map((source) => [
    'HEAD',
    `${SUPA}/rest/v1/ad_insights?select=id&ad_account_id=${data.accountFilter}&data_source=eq.${source}`,
    null,
    { headers: { ...h, Prefer: 'count=exact', Range: '0-0' }, tags: { step: 'counts' } },
  ]);
  http.batch(countReqs).forEach((r, i) => record(r, stepDuration.counts, `step6_count_${i}`));
  think(4);

  // ── Step 7 — a user changing the window ───────────────────────────────────
  const narrow = target.date_range.narrow;
  const rerange = http.get(
    `${SUPA}/rest/v1/ad_insights?select=${cols}` +
    `&ad_account_id=${data.accountFilter}&data_source=${data.sourceFilter}` +
    `&date=gte.${narrow.gte}&date=lte.${narrow.lte}&order=date.asc`,
    { headers: h, tags: { step: 'insights_narrow' } },
  );
  record(rerange, stepDuration.insightsNarrow, 'step7_insights_rerange');
  think(6);
}
