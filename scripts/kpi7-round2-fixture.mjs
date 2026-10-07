// KPI-7 round 2 — fixture setup / teardown for the A01 write-access probe.
//
// This is the ONLY round-2 script that holds the service_role key. It creates
// and resets the test accounts and baseline rows; it never measures anything.
// The measurement is scripts/kpi7-round2-probe.mjs, which uses real user JWTs.
//
//   node scripts/kpi7-round2-fixture.mjs setup     # idempotent
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

async function ensureUser(email, password) {
  const created = await sb.auth.admin.createUser({ email, password, email_confirm: true });
  if (!created.error) return created.data.user.id;
  // Already exists: reset the password so the env file stays the source of truth.
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
    ids[key] = await ensureUser(env[`KPI7_${K}_EMAIL`], env[`KPI7_${K}_PASSWORD`]);
    env[`KPI7_${K}_USER_ID`] = ids[key];
  }
  const testTeam = await ensureWorkspace(TEST_WS, ids.owner);
  const outTeam = await ensureWorkspace(OUTSIDER_WS, ids.outsider);
  for (const [key, spec] of Object.entries(ROLES)) if (spec) await ensureMember(testTeam, ids[key], spec.role, spec.status);
  await ensureMember(outTeam, ids.outsider, 'owner', 'active');
  const t = await ensureBaseline(testTeam);
  const o = await ensureBaseline(outTeam);
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
    test_team: testTeam, outsider_team: outTeam, baseline: { test: t, outsider: o },
    members: members.map((m) => `${byId[m.user_id] ?? m.user_id}:${m.role}/${m.status}`).sort(),
    workspaces_owned_by_fixture_users: extraWs.map((w) => w.name),
  }, null, 2));
} else {
  console.error('usage: node scripts/kpi7-round2-fixture.mjs setup|teardown');
  process.exit(2);
}
