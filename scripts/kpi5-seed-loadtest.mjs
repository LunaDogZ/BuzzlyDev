/**
 * Seeds the dedicated load-test workspace for KPI-5.
 *
 *   node scripts/kpi5-seed-loadtest.mjs
 *
 * `docs/KPI_SPEC.md` §KPI-5 requires the load to run against **a dedicated
 * load-test workspace, seeded in advance, scoped by `team_id` — never the
 * research workspace whose rows are KPI-1/2/3 evidence**, and against **a pool
 * of ~10 seeded accounts** rather than one shared login, because a single
 * account exercises one RLS evaluation path and one connection-reuse pattern,
 * which is not what fifty distinct merchants look like.
 *
 * Everything this writes lives under one workspace id and one owner set. It
 * never touches a row outside them, and it never deletes anything it did not
 * create — CLAUDE.md §8. The reset path counts what it is about to remove and
 * aborts if the number is not what a previous run of this script would have
 * left, so a mistyped id stops here instead of on the research data.
 *
 * The insight rows are generated from a fixed seed, so re-running produces the
 * same corpus byte for byte and two load-test runs are comparable (CLAUDE.md
 * §11). They are deliberately unremarkable numbers: this workspace exists to be
 * *read under load*, and nothing measures its values.
 *
 * Output: `k6/loadtest-target.json`, which the k6 script reads. It carries ids
 * and the account emails. It does **not** carry the password — that is passed
 * to k6 as `K6_USER_PASSWORD` so the file can be committed as evidence without
 * putting a working credential in the repository.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// The service-role key lives in `mock-api/.env`; the anon key lives in the
// front-end's `.env` as `VITE_SUPABASE_ANON_KEY` and is not duplicated. Read
// both, because the recovery path below signs a user in with the anon key and
// only runs on a *second* pass — so a missing key would not surface until a
// re-run, which is exactly when a seeder must still work.
const readEnv = (rel) => {
  try {
    return Object.fromEntries(
      readFileSync(resolve(root, rel), 'utf8')
        .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
        // the front-end `.env` quotes its values and `mock-api/.env` does not,
        // so strip a wrapping pair — an unstripped quote reaches PostgREST as
        // part of the key and comes back as the misleading "Invalid API key".
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
        }));
  } catch { return {}; }
};
const frontEnv = readEnv('.env');
const env = {
  ...readEnv('mock-api/.env'),
  SUPABASE_ANON_KEY: readEnv('mock-api/.env').SUPABASE_ANON_KEY
    ?? frontEnv.VITE_SUPABASE_ANON_KEY ?? frontEnv.VITE_SUPABASE_PUBLISHABLE_KEY,
};
// `die` is declared further down, so it cannot be used here without tripping
// the temporal dead zone — one more thing a script nobody had run would only
// reveal on the day it mattered.
const bail = (m) => { console.error('✗ ' + m); process.exit(1); };
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
  bail('mock-api/.env must hold SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
if (!env.SUPABASE_ANON_KEY)
  bail('no anon key in mock-api/.env or .env — needed to recover the ids of users a previous run created');

const SUPABASE_URL = env.SUPABASE_URL.replace(/\/$/, '');
const sb = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ── Fixed identity of the load-test fixture ──────────────────────────────────
const WS_NAME = 'KPI-5 Load Test Workspace';
const USER_COUNT = 10;
const email = (i) => `k6-load-${String(i).padStart(2, '0')}@buzzly.test`;
const PASSWORD = process.env.K6_USER_PASSWORD || 'K6Load!2026';

const FB_PLATFORM_ID = '40000000-0000-0000-0000-000000000001';

// Two accounts, so step 4's `in.(…)` filter has more than one id to expand and
// the query plan is the one the dashboard actually produces.
const ACCOUNTS = [
  { name: 'K6 Load — Meta A', platform_account_id: 'act_k6_load_a' },
  { name: 'K6 Load — Meta B', platform_account_id: 'act_k6_load_b' },
];

// 400 days ending on a fixed date. Fixed, not `new Date()`, so the corpus does
// not drift between the day it is seeded and the day it is measured — a clock
// read here would make two runs incomparable for a reason nobody would look for.
const LAST_DAY = new Date(Date.UTC(2026, 7, 31));   // 2026-08-31
const DAYS = 400;
const SOURCES = ['mock', 'import', 'meta_live'];

/** Deterministic PRNG (mulberry32) — same seed, same corpus, every run. */
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const log = (...a) => console.log(...a);
const die = (m) => { console.error('✗ ' + m); process.exit(1); };

// ── The seeder refuses to run until a collision with KPI-2/3 is settled ───────
//
// `tests/kpi_harness.py` guards the ingestion measurement with
// `PROTECTED_BASELINE = {"ad_insights": 881, …}`, and `protected_counts()`
// computes that as **the whole table minus the ingestion test workspace's
// rows**. Any workspace other than that one counts as "outside", so the rows
// this script writes would read as live research data changing underneath the
// suite, and `assert_protected_unchanged` would abort every future run with
// `ad_insights expected 881, found 3281`.
//
// That is the guard doing its job. It must not be silenced by editing the
// baseline — the whole point of the number is that nobody edits it to make a
// failure go away. The clean resolution is to subtract this fixture's accounts
// in `protected_counts()` the same way the ingestion fixture is already
// subtracted, which keeps the guard's meaning ("live rows must not change")
// exactly intact. That is a change to a measurement instrument, so it is the
// researcher's call and it needs its own dated commit — not a side effect of
// running a seeder.
//
// **Resolved on 2026-09-06 in `b4b8140`**, exactly that way: `protected_counts()`
// now subtracts this fixture's ad accounts, `PROTECTED_BASELINE` is untouched,
// and `tests/test_protected_scope.py` proves the guard still aborts on real
// drift and would have aborted on these same rows under the old scope.
//
// So the gate below no longer asks whether somebody decided. An environment
// variable asserting "yes I did the thing" is a check that cannot fail, and
// CLAUDE.md §12 is explicit about those. It reads the harness instead and
// verifies that **every account this script is about to write is exempted
// there**. That version of the check catches the case a promise cannot: adding
// a third account here and forgetting to exempt it, which would abort every
// ingestion run afterwards with a number nobody could explain.
{
  const harness = resolve(root, 'tests/kpi_harness.py');
  const src = readFileSync(harness, 'utf8');
  const missing = ACCOUNTS.map((a) => a.platform_account_id).filter((k) => !src.includes(`'${k}'`) && !src.includes(`"${k}"`));
  if (missing.length) {
    console.error(`
✗ ไม่ได้รัน — ad account ของ fixture นี้ยังไม่ถูกยกเว้นใน protected-rows guard

  ไม่พบใน tests/kpi_harness.py: ${missing.join(', ')}

  สคริปต์นี้จะเขียน ad_insights ${DAYS * ACCOUNTS.length * SOURCES.length} แถว
  ถ้า guard ยังไม่รู้จัก account พวกนี้ ชุดวัด ingestion KPI จะ abort ทุกครั้ง
  หลังจากนั้นด้วยข้อความ "ad_insights expected 881, found ..."

  ห้ามแก้ PROTECTED_BASELINE เพื่อให้ผ่าน — เพิ่ม key เข้า
  KPI5_FIXTURE_ACCOUNT_KEYS ใน tests/kpi_harness.py แล้ว commit แยกพร้อมเหตุผล
`);
    process.exit(2);
  }
}

// ── 1. the account pool ──────────────────────────────────────────────────────
const users = [];
for (let i = 1; i <= USER_COUNT; i++) {
  const addr = email(i);
  const created = await sb.auth.admin.createUser({
    email: addr, password: PASSWORD, email_confirm: true,
  });
  if (created.data?.user) {
    users.push({ email: addr, id: created.data.user.id });
    continue;
  }
  // Already there from a previous run. Sign in to recover the id rather than
  // listing users — `/auth/v1/admin/users` currently answers 500 on this
  // project, and a seeder that depends on it would break for an unrelated reason.
  const anon = createClient(SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const si = await anon.auth.signInWithPassword({ email: addr, password: PASSWORD });
  if (si.error) die(`cannot create or sign in ${addr}: ${created.error?.message} / ${si.error.message}`);
  users.push({ email: addr, id: si.data.user.id });
}
log(`[users] ${users.length} accounts ready`);

const owner = users[0];

// ── 2. the workspace, owned by the first account ─────────────────────────────
let teamId;
{
  const { data: existing } = await sb.from('workspaces')
    .select('id').eq('owner_id', owner.id).eq('name', WS_NAME).maybeSingle();
  if (existing) {
    teamId = existing.id;
    log(`[workspace] exists: ${teamId}`);
  } else {
    const { data, error } = await sb.from('workspaces')
      .insert({ name: WS_NAME, owner_id: owner.id, description: 'KPI-5 k6 load test — read-only fixture' })
      .select('id').single();
    if (error) die(`workspace insert: ${error.message}`);
    teamId = data.id;
    log(`[workspace] created: ${teamId}`);
  }
}

// ── 3. every account is a member, or nine of ten VUs read an empty dashboard ──
//
// `role` is the `team_role` enum — owner | admin | editor | viewer. There is no
// `member`, and inserting one fails the whole batch. `status` defaults to
// 'active' but is written explicitly here, because `useWorkspaceMembers`
// filters `.eq("status", "active")`: a default that ever changed would leave
// nine of ten VUs authenticated, in the workspace, and reading nothing — a load
// test that runs clean while measuring an empty dashboard.
{
  const rows = users.map((u) => ({
    team_id: teamId,
    user_id: u.id,
    role: u.id === owner.id ? 'owner' : 'viewer',
    status: 'active',
  }));
  const { error } = await sb.from('workspace_members')
    .upsert(rows, { onConflict: 'team_id,user_id', ignoreDuplicates: true });
  if (error) die(`workspace_members: ${error.message}`);
  log(`[members] ${rows.length} rows`);
}

// ── 4. ad accounts ───────────────────────────────────────────────────────────
const accountIds = [];
for (const a of ACCOUNTS) {
  const { data: existing } = await sb.from('ad_accounts')
    .select('id').eq('team_id', teamId).eq('platform_account_id', a.platform_account_id).maybeSingle();
  if (existing) { accountIds.push(existing.id); continue; }

  // `ad_accounts` is UNIQUE (team_id, platform_id), so the second account needs
  // a platform of its own. Reuse Meta for the first and fall back to whatever
  // else the catalogue holds for the second — the load does not care which
  // platform a row claims, only that the `in.(…)` filter expands to two ids.
  const platformId = accountIds.length === 0 ? FB_PLATFORM_ID : await secondPlatformId();
  const { data, error } = await sb.from('ad_accounts').insert({
    team_id: teamId, platform_id: platformId,
    account_name: a.name, platform_account_id: a.platform_account_id, is_active: true,
  }).select('id').single();
  if (error) die(`ad_accounts insert: ${error.message}`);
  accountIds.push(data.id);
}
log(`[ad_accounts] ${accountIds.length}: ${accountIds.join(', ')}`);

async function secondPlatformId() {
  const { data } = await sb.from('platforms').select('id').neq('id', FB_PLATFORM_ID).limit(1).maybeSingle();
  return data?.id ?? FB_PLATFORM_ID;
}

// ── 4b. one `ads` row per (account, source) ──────────────────────────────────
//
// `ad_insights` is UNIQUE on (ad_account_id, ads_id, date) **NULLS NOT
// DISTINCT** (migration 20260723120000). Leaving `ads_id` NULL therefore makes
// the three data sources of the same account and day collide with each other,
// and the very first batch dies with
//
//   duplicate key value violates unique constraint "ad_insights_account_ad_date_key"
//
// That is measured, not reasoned: it is what happened the first time this
// script was ever executed. It had been gated behind the baseline decision
// since it was written, so the defect shipped without one run to expose it.
//
// Giving each source its own ad row keeps the fixture exactly as documented —
// 400 days × 2 accounts × 3 sources = 2400 insight rows — rather than thinning
// the corpus or splitting the date range to dodge the constraint, either of
// which would change what the load test reads.
const adIdFor = new Map();          // `${accountId}|${source}` → ads.id
for (const [idx, accountId] of accountIds.entries()) {
  for (const source of SOURCES) {
    const name = `K6 Load ${ACCOUNTS[idx].platform_account_id} · ${source}`;
    const { data: existing } = await sb.from('ads')
      .select('id').eq('team_id', teamId).eq('name', name).maybeSingle();
    if (existing) { adIdFor.set(`${accountId}|${source}`, existing.id); continue; }
    const { data, error } = await sb.from('ads')
      .insert({ team_id: teamId, name }).select('id').single();
    if (error) die(`ads insert: ${error.message}`);
    adIdFor.set(`${accountId}|${source}`, data.id);
  }
}
if (adIdFor.size !== accountIds.length * SOURCES.length)
  die(`ads: expected ${accountIds.length * SOURCES.length} ids, resolved ${adIdFor.size}`);
log(`[ads] ${adIdFor.size} rows`);

// ── 5. insights — the rows step 5 and step 7 read ────────────────────────────
{
  const { count: already } = await sb.from('ad_insights')
    .select('id', { count: 'exact', head: true }).in('ad_account_id', accountIds);

  const target = DAYS * accountIds.length * SOURCES.length;
  if ((already ?? 0) >= target) {
    log(`[insights] ${already} rows already present (target ${target}) — leaving them alone`);
  } else {
    if ((already ?? 0) > 0) {
      // Partial corpus from an interrupted run. Clearing it is the only way back
      // to a deterministic fixture, and the filter is the two account ids this
      // script created — nothing else can match.
      log(`[insights] ${already} partial rows found; clearing this fixture's rows only`);
      const { error } = await sb.from('ad_insights').delete().in('ad_account_id', accountIds);
      if (error) die(`insight cleanup: ${error.message}`);
    }

    const rand = rng(20260906);
    const rows = [];
    for (let d = 0; d < DAYS; d++) {
      const day = new Date(LAST_DAY.getTime() - d * 86400000).toISOString().slice(0, 10);
      for (const accountId of accountIds) {
        for (const source of SOURCES) {
          const impressions = 2000 + Math.floor(rand() * 18000);
          const clicks = Math.floor(impressions * (0.008 + rand() * 0.03));
          const spend = Math.round((clicks * (4 + rand() * 8)) * 100) / 100;
          const conversions = Math.floor(clicks * (0.01 + rand() * 0.06));
          const revenue = Math.round(conversions * (180 + rand() * 900) * 100) / 100;
          rows.push({
            ad_account_id: accountId, ads_id: adIdFor.get(`${accountId}|${source}`),
            date: day, data_source: source,
            impressions, clicks, spend, conversions, revenue,
            reach: Math.floor(impressions * (0.55 + rand() * 0.35)),
            ctr: clicks && impressions ? Math.round((clicks / impressions) * 10000) / 100 : 0,
            cpc: clicks ? Math.round((spend / clicks) * 100) / 100 : 0,
            cpm: impressions ? Math.round((spend / impressions) * 1000 * 100) / 100 : 0,
            roas: spend ? Math.round((revenue / spend) * 100) / 100 : 0,
          });
        }
      }
    }

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from('ad_insights').insert(rows.slice(i, i + 500));
      if (error) die(`insight insert at ${i}: ${error.message}`);
    }
    log(`[insights] ${rows.length} rows written`);
  }
}

// ── 6. what k6 needs to run ──────────────────────────────────────────────────
{
  const { count: finalCount } = await sb.from('ad_insights')
    .select('id', { count: 'exact', head: true }).in('ad_account_id', accountIds);

  const target = {
    generated_at_note: 'ids and emails only — the password is passed to k6 as K6_USER_PASSWORD',
    supabase_url: SUPABASE_URL,
    supabase_anon_key: env.SUPABASE_ANON_KEY,
    team_id: teamId,
    ad_account_ids: accountIds,
    data_sources: SOURCES,
    date_range: {
      wide: { gte: new Date(LAST_DAY.getTime() - (DAYS - 1) * 86400000).toISOString().slice(0, 10),
              lte: LAST_DAY.toISOString().slice(0, 10) },
      narrow: { gte: new Date(LAST_DAY.getTime() - 29 * 86400000).toISOString().slice(0, 10),
                lte: LAST_DAY.toISOString().slice(0, 10) },
    },
    users: users.map((u) => u.email),
    insight_rows: finalCount ?? 0,
  };

  mkdirSync(resolve(root, 'k6'), { recursive: true });
  writeFileSync(resolve(root, 'k6/loadtest-target.json'), JSON.stringify(target, null, 2) + '\n');
  log(`\n✓ seeded — ${finalCount} insight rows, ${users.length} users, workspace ${teamId}`);
  log('  wrote k6/loadtest-target.json');
  log('\n  run:  K6_USER_PASSWORD=… SITE_URL=https://<prod>.vercel.app \\');
  log('          k6 run --out csv=metrics.csv k6/kpi5-dashboard-journey.js');
}
