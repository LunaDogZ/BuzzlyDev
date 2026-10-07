// KPI-7 round 2 — fixture setup / teardown for the A01 write-access probe.
//
// This is the ONLY round-2 script that holds the service_role key. It creates
// and resets the test accounts and baseline rows; it never measures anything.
// The measurement is scripts/kpi7-round2-probe.mjs, which uses real user JWTs.
//
//   node scripts/kpi7-round2-fixture.mjs setup     # idempotent; also seeds the round-3 marker rows
//   node scripts/kpi7-round2-fixture.mjs teardown  # remove probe leftovers, restore baselines
//
// Accounts (kept between rounds, @buzzly.test):
//   kpi7r2-owner     workspace owner (workspaces.owner_id) + member role owner
//   kpi7r2-admin     member, role admin,  active
//   kpi7r2-editor    member, role editor, active
//   kpi7r2-viewer    member, role viewer, active
//   kpi7r2-suspended member, role admin,  status suspended  ← privileged role, dead status
//   kpi7r2-removed   member, role admin,  status removed    ← so status, not role, must deny
//   kpi7r2-outsider  owner of a separate workspace, no membership in the test one
//
// Passwords and ids go to .env.kpi7-round2.local (gitignored by `.env.*.local`).

import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, '.env.kpi7-round2.local');
const readEnv = (p) => Object.fromEntries(
  readFileSync(p, 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
const svc = readEnv(resolve(ROOT, 'mock-api/.env'));
const sb = createClient(svc.SUPABASE_URL, svc.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const FACEBOOK = '40000000-0000-0000-0000-000000000001';
const TEST_WS = 'KPI-7 R2 Test Workspace';
const OUTSIDER_WS = 'KPI-7 R2 Outsider Workspace';
const BASELINE_ACCOUNT_NAME = 'kpi7r2-baseline';
const BASELINE_DATE = '2026-01-01';
const BASELINE_CLICKS = 100;
const ROLES = {
  owner: { role: 'owner', status: 'active' },
  admin: { role: 'admin', status: 'active' },
  editor: { role: 'editor', status: 'active' },
  viewer: { role: 'viewer', status: 'active' },
  suspended: { role: 'admin', status: 'suspended' },
  removed: { role: 'admin', status: 'removed' },
  outsider: null,
};

const must = (res, what) => { if (res.error) throw new Error(`${what}: ${res.error.message}`); return res.data; };

async function ensureUser(email, password, knownId) {
  const created = await sb.auth.admin.createUser({ email, password, email_confirm: true });
  if (!created.error) return created.data.user.id;
  // Already exists: reset the password so the env file stays the source of truth.
  // Round 3: prefer the id this script recorded earlier, checked against the
  // email. The two lookups below never resolved on this project:
  // profile_customers has no `email` column, and auth.admin.listUsers answers
  // "Database error finding users" (2026-10-07).
  if (knownId) {
    const got = await sb.auth.admin.getUserById(knownId);
    if (!got.error && got.data.user?.email === email) {
      must(await sb.auth.admin.updateUserById(knownId, { password }), `reset password ${email}`);
      return knownId;
    }
  }
  const { data } = await sb.from('profile_customers').select('id').eq('email', email).maybeSingle();
  let id = data?.id;
  if (!id) {
    const page = must(await sb.auth.admin.listUsers({ perPage: 1000 }), 'listUsers');
    id = page.users.find((u) => u.email === email)?.id;
  }
  if (!id) throw new Error(`cannot resolve existing user ${email}: ${created.error.message}`);
  must(await sb.auth.admin.updateUserById(id, { password }), `reset password ${email}`);
  return id;
}

async function ensureWorkspace(name, ownerId) {
  const found = must(await sb.from('workspaces').select('id').eq('owner_id', ownerId).eq('name', name).maybeSingle(), 'find ws');
  if (found) return found.id;
  return must(await sb.from('workspaces').insert({ name, owner_id: ownerId, description: 'KPI-7 round 2 A01 probe — do not use' }).select('id').single(), 'create ws').id;
}

async function ensureMember(teamId, userId, role, status) {
  must(await sb.from('workspace_members').upsert({ team_id: teamId, user_id: userId, role, status }, { onConflict: 'team_id,user_id' }), 'member');
}

async function ensureBaseline(teamId) {
  let acct = must(await sb.from('ad_accounts').select('id').eq('team_id', teamId).eq('platform_id', FACEBOOK).maybeSingle(), 'find acct');
  if (!acct) acct = must(await sb.from('ad_accounts').insert({ team_id: teamId, platform_id: FACEBOOK, account_name: BASELINE_ACCOUNT_NAME, is_active: true }).select('id').single(), 'create acct');
  must(await sb.from('ad_accounts').update({ account_name: BASELINE_ACCOUNT_NAME, is_active: true }).eq('id', acct.id), 'reset acct');
  let ins = must(await sb.from('ad_insights').select('id').eq('ad_account_id', acct.id).eq('date', BASELINE_DATE).is('ads_id', null).maybeSingle(), 'find insight');
  if (!ins) ins = must(await sb.from('ad_insights').insert({ ad_account_id: acct.id, date: BASELINE_DATE, impressions: 1000, clicks: BASELINE_CLICKS, spend: '10.00', data_source: 'mock' }).select('id').single(), 'create insight');
  must(await sb.from('ad_insights').update({ clicks: BASELINE_CLICKS }).eq('id', ins.id), 'reset insight');
  return { accountId: acct.id, insightId: ins.id };
}

// Round 3: one marker row per table the round-3 migration re-scopes, in a given
// workspace, so a probe has a real row to UPDATE / DELETE and a SELECT count is
// not 0 = 0. Two campaigns: one with an ad account, one without, because the
// campaigns policies match on team_id in one path and ad_account_id in another.
// import_jobs is deliberately NOT seeded: an insert with status 'pending' fires
// trg_import_jobs_trigger_airflow and starts a real pipeline run.
const SEED = 'kpi7r3-seed';
const GOOGLE = '40000000-0000-0000-0000-000000000002';

async function ensureRow(table, match, extra = {}) {
  let q = sb.from(table).select('*');
  for (const [k, v] of Object.entries(match)) q = v === null ? q.is(k, null) : q.eq(k, v);
  const found = must(await q.limit(2), `find ${table}`);
  if (found.length > 1) throw new Error(`${table}: ${found.length} rows match ${JSON.stringify(match)}, expected at most 1`);
  if (found.length) return found[0].id ?? found[0];
  const row = must(await sb.from(table).insert({ ...match, ...extra }).select('*').single(), `create ${table}`);
  return row.id ?? row;
}

async function ensureRound3Seeds(teamId, accountId, ownerId) {
  const id = {};
  id.campaign = await ensureRow('campaigns', { team_id: teamId, ad_account_id: accountId, name: SEED });
  id.campaign_noacct = await ensureRow('campaigns', { team_id: teamId, ad_account_id: null, name: `${SEED}-noacct` });
  id.ad_group = await ensureRow('ad_groups', { team_id: teamId, name: SEED });
  id.ad = await ensureRow('ads', { team_id: teamId, name: SEED });
  await ensureRow('campaign_ads', { campaign_id: id.campaign, ad_id: id.ad });
  id.tag = await ensureRow('tags', { team_id: teamId, name: SEED });
  await ensureRow('campaign_tags', { campaign_id: id.campaign, tag_id: id.tag });
  id.budget = await ensureRow('budgets', { team_id: teamId, name: SEED });
  id.persona = await ensureRow('customer_personas', { team_id: teamId, persona_name: SEED });
  await ensureRow('ad_personas', { ad_id: id.ad, persona_id: id.persona });
  id.social_post = await ensureRow('social_posts', { team_id: teamId, name: SEED }, { platform_id: GOOGLE });
  await ensureRow('post_personas', { post_id: id.social_post, persona_id: id.persona });
  id.social_comment = await ensureRow('social_comments', { team_id: teamId, post_id: id.social_post, content: SEED }, { author_name: 'kpi7r3' });
  await ensureRow('workspace_ad_persona', { workspace_id: teamId });
  id.api_key = await ensureRow('workspace_api_keys', { team_id: teamId, platform_id: GOOGLE });
  id.report = await ensureRow('reports', { team_id: teamId, name: SEED }, { report_type: 'kpi7r3' });
  id.scheduled_report = await ensureRow('scheduled_reports', { team_id: teamId, name: SEED }, { is_active: false });
  id.email_campaign = await ensureRow('email_campaigns', { team_id: teamId, name: SEED }, { subject: SEED });
  id.sync_history = await ensureRow('sync_history', { team_id: teamId, platform_id: GOOGLE, error_message: SEED }, { sync_type: 'manual', status: 'failed' });
  id.conversion_event = await ensureRow('conversion_events', { ad_account_id: accountId, event_name: SEED }, { occurred_at: `${BASELINE_DATE}T00:00:00Z` });
  id.activity_log = await ensureRow('team_activity_logs', { team_id: teamId, action: SEED }, { user_id: ownerId });
  return id;
}

// Everything a probe may have left behind: extra ad_accounts (any platform but
// the baseline) and extra ad_insights (any date but the baseline).
async function teardown(env) {
  const report = {};
  for (const [label, teamId] of [['test', env.KPI7_TEST_TEAM_ID], ['outsider', env.KPI7_OUTSIDER_TEAM_ID]]) {
    const accts = must(await sb.from('ad_accounts').select('id, platform_id').eq('team_id', teamId), 'list accts');
    const base = accts.find((a) => a.platform_id === FACEBOOK);
    const ids = accts.map((a) => a.id);
    const extraIns = must(await sb.from('ad_insights').select('id').in('ad_account_id', ids).neq('date', BASELINE_DATE), 'list extra ins');
    const extraAccts = accts.filter((a) => a.platform_id !== FACEBOOK);
    // Blast radius guard: a probe writes at most one row per role per table.
    if (extraIns.length > 14 || extraAccts.length > 14) throw new Error(`teardown ${label}: unexpected count ins=${extraIns.length} accts=${extraAccts.length}, aborting`);
    if (extraIns.length) must(await sb.from('ad_insights').delete().in('id', extraIns.map((r) => r.id)), 'del ins');
    if (extraAccts.length) {
      must(await sb.from('ad_insights').delete().in('ad_account_id', extraAccts.map((a) => a.id)), 'del ins of extra accts');
      must(await sb.from('ad_accounts').delete().in('id', extraAccts.map((a) => a.id)), 'del accts');
    }
    if (base) await ensureBaseline(teamId);
    report[label] = { deleted_ad_insights: extraIns.length, deleted_ad_accounts: extraAccts.length };
  }
  console.log(JSON.stringify({ teardown: report }));
}

const mode = process.argv[2];
const prior = existsSync(OUT) ? readEnv(OUT) : {};

if (mode === 'teardown') {
  await teardown(prior);
} else if (mode === 'setup') {
  const env = { ...prior };
  const ids = {};
  for (const key of Object.keys(ROLES)) {
    const K = key.toUpperCase();
    env[`KPI7_${K}_EMAIL`] ??= `kpi7r2-${key}@buzzly.test`;
    env[`KPI7_${K}_PASSWORD`] ??= `K7r2-${randomBytes(12).toString('base64url')}`;
    ids[key] = await ensureUser(env[`KPI7_${K}_EMAIL`], env[`KPI7_${K}_PASSWORD`], prior[`KPI7_${K}_USER_ID`]);
    env[`KPI7_${K}_USER_ID`] = ids[key];
  }
  const testTeam = await ensureWorkspace(TEST_WS, ids.owner);
  const outTeam = await ensureWorkspace(OUTSIDER_WS, ids.outsider);
  for (const [key, spec] of Object.entries(ROLES)) if (spec) await ensureMember(testTeam, ids[key], spec.role, spec.status);
  await ensureMember(outTeam, ids.outsider, 'owner', 'active');
  const t = await ensureBaseline(testTeam);
  const o = await ensureBaseline(outTeam);
  const seeds = {
    TEST: await ensureRound3Seeds(testTeam, t.accountId, ids.owner),
    OUTSIDER: await ensureRound3Seeds(outTeam, o.accountId, ids.outsider),
  };
  for (const [team, rows] of Object.entries(seeds)) {
    for (const [k, v] of Object.entries(rows)) if (typeof v === 'string') env[`KPI7R3_${team}_${k.toUpperCase()}_ID`] = v;
  }
  Object.assign(env, {
    KPI7_TEST_TEAM_ID: testTeam, KPI7_TEST_ACCOUNT_ID: t.accountId, KPI7_TEST_INSIGHT_ID: t.insightId,
    KPI7_OUTSIDER_TEAM_ID: outTeam, KPI7_OUTSIDER_ACCOUNT_ID: o.accountId, KPI7_OUTSIDER_INSIGHT_ID: o.insightId,
    KPI7_BASELINE_ACCOUNT_NAME: BASELINE_ACCOUNT_NAME, KPI7_BASELINE_CLICKS: String(BASELINE_CLICKS),
  });
  writeFileSync(OUT, '# KPI-7 round 2 test accounts — written by scripts/kpi7-round2-fixture.mjs. Gitignored.\n'
    + Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });

  // State check, read back rather than assumed.
  const members = must(await sb.from('workspace_members').select('user_id, role, status').eq('team_id', testTeam), 'members');
  const byId = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
  const extraWs = must(await sb.from('workspaces').select('id, name, owner_id').in('owner_id', Object.values(ids)), 'ws by owner');
  console.log(JSON.stringify({
    test_team: testTeam, outsider_team: outTeam, baseline: { test: t, outsider: o }, round3_seeds: seeds,
    members: members.map((m) => `${byId[m.user_id] ?? m.user_id}:${m.role}/${m.status}`).sort(),
    workspaces_owned_by_fixture_users: extraWs.map((w) => w.name),
  }, null, 2));
} else {
  console.error('usage: node scripts/kpi7-round2-fixture.mjs setup|teardown');
  process.exit(2);
}
