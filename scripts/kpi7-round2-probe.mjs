// KPI-7 round 2 — A01 write-access probe over PostgREST with real user JWTs.
//
// Holds NO service_role key: it reads only the public anon key from the
// frontend .env and the test accounts from .env.kpi7-round2.local (written by
// scripts/kpi7-round2-fixture.mjs). Every write is sent with
// `Prefer: return=minimal` — `return=representation` adds RETURNING, which
// needs a SELECT policy and turns an accepted write into a false 403.
// An accepted write is confirmed by reading it back with the OWNER's JWT,
// never inferred from the status code alone.
//
//   node scripts/kpi7-round2-probe.mjs <out.json>
//
// Run `node scripts/kpi7-round2-fixture.mjs setup` first and `... teardown` after.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readEnv = (p) => Object.fromEntries(
  readFileSync(p, 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
const fe = readEnv(resolve(ROOT, '.env'));
const fx = readEnv(resolve(ROOT, '.env.kpi7-round2.local'));
const URL_ = fe.VITE_SUPABASE_URL;
const ANON = fe.VITE_SUPABASE_ANON_KEY;
if (!URL_ || !ANON) throw new Error('frontend .env lacks VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
if (Object.values(fe).some((v) => v.includes('service_role'))) throw new Error('refusing: a service_role key is reachable from the probe env');

const ROLES = ['owner', 'admin', 'editor', 'viewer', 'suspended', 'removed', 'outsider'];
// Hand-declared expectations (CLAUDE.md rule 11) — not derived from a run.
const EXPECT = {
  ad_accounts_write: { owner: true, admin: true, editor: false, viewer: false, suspended: false, removed: false, outsider: false },
  ad_insights_write: { owner: false, admin: false, editor: false, viewer: false, suspended: false, removed: false, outsider: false },
  select_test_ws: { owner: 1, admin: 1, editor: 1, viewer: 1, suspended: 0, removed: 0, outsider: 0 },
};
// One distinct platform per role so a unique-key clash can never mask a result.
const PLATFORM = {
  owner: '40000000-0000-0000-0000-000000000002', admin: '40000000-0000-0000-0000-000000000003',
  editor: '40000000-0000-0000-0000-000000000004', viewer: '40000000-0000-0000-0000-000000000005',
  suspended: '40000000-0000-0000-0000-000000000006', removed: '40000000-0000-0000-0000-000000000007',
  outsider: '40000000-0000-0000-0000-000000000008',
};
const PROBE_DATE = Object.fromEntries(ROLES.map((r, i) => [r, `2025-01-0${i + 1}`]));
const TEAM = fx.KPI7_TEST_TEAM_ID;
const ACCT = fx.KPI7_TEST_ACCOUNT_ID;
const INS = fx.KPI7_TEST_INSIGHT_ID;

async function login(role) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: fx[`KPI7_${role.toUpperCase()}_EMAIL`], password: fx[`KPI7_${role.toUpperCase()}_PASSWORD`] }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login ${role}: ${r.status} ${JSON.stringify(j)}`);
  return j.access_token;
}

async function rest(jwt, method, path, body, prefer = 'return=minimal') {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'content-type': 'application/json', Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let parsed; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: r.status, content_range: r.headers.get('content-range'), body: parsed };
}
const countOf = (res) => { const m = /\/(\d+|\*)$/.exec(res.content_range ?? ''); return m && m[1] !== '*' ? Number(m[1]) : null; };
const affected = (res) => { const m = /^(\d+)-(\d+)|^\*/.exec(res.content_range ?? ''); return m ? (m[1] === undefined ? 0 : Number(m[2]) - Number(m[1]) + 1) : null; };

const jwt = {};
for (const r of ROLES) jwt[r] = await login(r);
const ownerRead = async (path) => (await rest(jwt.owner, 'GET', path, undefined, 'count=exact')).body;

const out = { at: new Date().toISOString(), site: URL_, test_team: TEAM, cases: [] };
const record = (c) => { out.cases.push(c); const ok = c.pass ? 'PASS' : 'FAIL'; console.log(`${ok}  ${c.role.padEnd(9)} ${c.case.padEnd(34)} http=${c.http} ${c.observed}`); };

// 1. SELECT — before any write, so counts are the baseline.
for (const role of ROLES) {
  for (const table of ['ad_accounts', 'ad_insights']) {
    const path = table === 'ad_accounts' ? `ad_accounts?select=id&team_id=eq.${TEAM}` : `ad_insights?select=id&ad_account_id=eq.${ACCT}`;
    const res = await rest(jwt[role], 'HEAD', path, undefined, 'count=exact');
    const n = countOf(res);
    record({ role, case: `SELECT ${table} (test ws)`, http: res.status, content_range: res.content_range, rows: n, expected_rows: EXPECT.select_test_ws[role], pass: n === EXPECT.select_test_ws[role], observed: `rows=${n}` });
  }
}
// Control: the outsider's JWT does work — on its own workspace.
{
  const res = await rest(jwt.outsider, 'HEAD', `ad_accounts?select=id&team_id=eq.${fx.KPI7_OUTSIDER_TEAM_ID}`, undefined, 'count=exact');
  record({ role: 'outsider', case: 'SELECT ad_accounts (OWN ws, control)', http: res.status, content_range: res.content_range, rows: countOf(res), expected_rows: 1, pass: countOf(res) === 1, observed: `rows=${countOf(res)}` });
}

// 2. ad_accounts INSERT
for (const role of ROLES) {
  const name = `kpi7r2-probe-insert-${role}`;
  const res = await rest(jwt[role], 'POST', 'ad_accounts', { team_id: TEAM, platform_id: PLATFORM[role], account_name: name, is_active: true });
  const found = await ownerRead(`ad_accounts?select=id&team_id=eq.${TEAM}&account_name=eq.${name}`);
  const landed = Array.isArray(found) && found.length === 1;
  record({ role, case: 'INSERT ad_accounts', http: res.status, body: res.body, row_found_by_owner: landed, expected_accepted: EXPECT.ad_accounts_write[role], pass: landed === EXPECT.ad_accounts_write[role], observed: `landed=${landed}` });
  if (landed) {
    const del = await rest(jwt.owner, 'DELETE', `ad_accounts?id=eq.${found[0].id}`, undefined, 'return=minimal,count=exact');
    out.cases.at(-1).cleanup = { by: 'owner JWT', http: del.status, content_range: del.content_range };
  }
}

// 3. ad_accounts UPDATE (the baseline account)
for (const role of ROLES) {
  const name = `kpi7r2-probe-update-${role}`;
  const res = await rest(jwt[role], 'PATCH', `ad_accounts?id=eq.${ACCT}`, { account_name: name }, 'return=minimal,count=exact');
  const after = await ownerRead(`ad_accounts?select=account_name&id=eq.${ACCT}`);
  const landed = after?.[0]?.account_name === name;
  record({ role, case: 'UPDATE ad_accounts', http: res.status, content_range: res.content_range, rows_affected: affected(res), body: res.body, value_after_by_owner: after?.[0]?.account_name, expected_accepted: EXPECT.ad_accounts_write[role], pass: landed === EXPECT.ad_accounts_write[role], observed: `landed=${landed} affected=${affected(res)}` });
  if (landed) {
    const back = await rest(jwt.owner, 'PATCH', `ad_accounts?id=eq.${ACCT}`, { account_name: fx.KPI7_BASELINE_ACCOUNT_NAME }, 'return=minimal,count=exact');
    out.cases.at(-1).cleanup = { by: 'owner JWT', http: back.status, content_range: back.content_range };
  }
}

// 4. ad_insights INSERT
for (const role of ROLES) {
  const res = await rest(jwt[role], 'POST', 'ad_insights', { ad_account_id: ACCT, date: PROBE_DATE[role], impressions: 1, clicks: 1, spend: '0.01', data_source: 'mock' });
  const found = await ownerRead(`ad_insights?select=id&ad_account_id=eq.${ACCT}&date=eq.${PROBE_DATE[role]}`);
  const landed = Array.isArray(found) && found.length === 1;
  record({ role, case: 'INSERT ad_insights', http: res.status, body: res.body, row_found_by_owner: landed, expected_accepted: EXPECT.ad_insights_write[role], pass: landed === EXPECT.ad_insights_write[role], observed: `landed=${landed}` });
  // An accepted row is left for the fixture teardown: owner has DELETE, but a
  // landed row here is itself a finding and should be seen before removal.
}

// 5. ad_insights UPDATE (the baseline insight)
for (const [i, role] of ROLES.entries()) {
  const clicks = 1000 + i;
  const res = await rest(jwt[role], 'PATCH', `ad_insights?id=eq.${INS}`, { clicks }, 'return=minimal,count=exact');
  const after = await ownerRead(`ad_insights?select=clicks&id=eq.${INS}`);
  const landed = after?.[0]?.clicks === clicks;
  record({ role, case: 'UPDATE ad_insights', http: res.status, content_range: res.content_range, rows_affected: affected(res), body: res.body, value_after_by_owner: after?.[0]?.clicks, expected_accepted: EXPECT.ad_insights_write[role], pass: landed === EXPECT.ad_insights_write[role], observed: `landed=${landed} affected=${affected(res)}` });
}

// 6. seed_demo_insights — must be refused to anon and to any signed-in user.
const insBefore = (await rest(jwt.owner, 'HEAD', `ad_insights?select=id&ad_account_id=eq.${ACCT}`, undefined, 'count=exact'));
for (const [who, bearer] of [['anon', ANON], ['viewer', jwt.viewer], ['owner', jwt.owner]]) {
  const res = await rest(bearer, 'POST', 'rpc/seed_demo_insights', { p_ad_account_id: ACCT }, 'return=minimal');
  const code = res.body?.code;
  // 42501 = REVOKE in place (20261007101000); PGRST202 = function dropped (20261007120000).
  record({ role: who, case: 'RPC seed_demo_insights', http: res.status, body: res.body, pass: code === '42501' || code === 'PGRST202', observed: `code=${code}` });
}
const insAfter = (await rest(jwt.owner, 'HEAD', `ad_insights?select=id&ad_account_id=eq.${ACCT}`, undefined, 'count=exact'));
record({ role: 'owner', case: 'ad_insights rows unchanged by RPC', http: insAfter.status, before: countOf(insBefore), after: countOf(insAfter), pass: countOf(insBefore) === countOf(insAfter), observed: `${countOf(insBefore)} -> ${countOf(insAfter)}` });

out.summary = { cases: out.cases.length, pass: out.cases.filter((c) => c.pass).length, fail: out.cases.filter((c) => !c.pass).length };
writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.summary));
