// KPI-7 round 3 — A01 write-access probe over PostgREST with real user JWTs, for
// every table 20261007183000 re-scoped, plus import_jobs and the imports bucket.
//
// Holds NO service_role key: the public anon key from the frontend .env and the
// test accounts in .env.kpi7-round2.local. Writes use `Prefer: return=minimal`
// (return=representation needs a SELECT policy and turns an accepted write into a
// false 403) and `count=exact`, so an UPDATE/DELETE reports how many rows RLS let
// it touch. Every accepted INSERT/DELETE is confirmed by the OWNER reading back.
//
// Targets:
//   INSERT  each role inserts its own row (deterministic id, name kpi7r3-probe-<role>);
//           link tables use a per-role child row (kpi7r3-ins-<role>) made by setup.
//   UPDATE  each role updates the seed row to the values it already has.
//   DELETE  a role deletes its own inserted row if it has one, otherwise the seed;
//           the owner then reads back whether that row still exists.
// Expectations are hand-declared from the role table (CLAUDE.md rule 11).
//
//   node scripts/kpi7-round2-fixture.mjs setup
//   node scripts/kpi7-round3-probe.mjs <out.json>
//   node scripts/kpi7-round2-fixture.mjs teardown

import { createHash } from 'node:crypto';
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
const set = (...r) => Object.fromEntries(ROLES.map((x) => [x, r.includes(x)]));
// The role table (useTeamManagement.tsx:88 / has_permission), as sets of roles allowed.
const MS = set('owner');                          // manage_settings
const EC = set('owner', 'admin', 'editor');       // edit_campaigns, edit_prospects
const DC = set('owner', 'admin');                 // delete_campaigns, delete_prospects, export_data, can_manage_team
const MEM = set('owner', 'admin', 'editor', 'viewer');
const NONE = set();

const T = fx.KPI7_TEST_TEAM_ID;
const O_T = fx.KPI7_OUTSIDER_TEAM_ID;
const ACCT = fx.KPI7_TEST_ACCOUNT_ID;
const GOOGLE = '40000000-0000-0000-0000-000000000002';
const PLATFORM = { owner: '40000000-0000-0000-0000-000000000003', admin: '40000000-0000-0000-0000-000000000004',
  editor: '40000000-0000-0000-0000-000000000005', viewer: '40000000-0000-0000-0000-000000000006',
  suspended: '40000000-0000-0000-0000-000000000007', removed: '40000000-0000-0000-0000-000000000008',
  outsider: '40000000-0000-0000-0000-000000000009' };
const P = (role) => `kpi7r3-probe-${role}`;
const seed = (k, ws = 'TEST') => { const v = fx[`KPI7R3_${ws}_${k}_ID`]; if (!v) throw new Error(`missing seed ${ws} ${k} — run fixture setup`); return v; };
const ins = (kind, role) => seed(`INS_${kind}_${role.toUpperCase()}`);
const uid = (role) => fx[`KPI7_${role.toUpperCase()}_USER_ID`];
// Deterministic ids, so two runs produce identical output.
const did = (...parts) => { const h = createHash('sha1').update(['kpi7r3', ...parts].join('|')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };

async function login(role) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: fx[`KPI7_${role.toUpperCase()}_EMAIL`], password: fx[`KPI7_${role.toUpperCase()}_PASSWORD`] }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login ${role}: ${r.status}`);
  return j.access_token;
}

let retries = 0;
async function http(jwt, method, path, body, headers = {}) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(`${URL_}${path}`, {
      method,
      headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, ...headers },
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    });
    const text = await r.text();
    // Retry ONLY a statement-timeout cancel (the known KPI-4/5 bottleneck): a
    // cancelled statement rolled back, so repeating it cannot double-write.
    if (r.status === 500 && /57014/.test(r.headers.get('proxy-status') ?? '') && attempt < 4) {
      retries++; await new Promise((s) => setTimeout(s, 2000)); continue;
    }
    let parsed; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: r.status, range: r.headers.get('content-range'), body: parsed, attempts: attempt };
  }
}
const rest = (jwt, method, path, body, prefer) => http(jwt, method, `/rest/v1/${path}`, body,
  { 'content-type': 'application/json', Prefer: prefer ?? 'return=minimal,count=exact' });
const affected = (res) => { const m = /\/(\d+)$/.exec(res.range ?? ''); return m ? Number(m[1]) : null; };
const code = (res) => (res.body && typeof res.body === 'object' && !Array.isArray(res.body)) ? (res.body.code ?? res.body.statusCode ?? null) : null;
const q = (filter) => Object.entries(filter).map(([k, v]) => `${k}=eq.${v}`).join('&');

const jwt = {};
for (const r of ROLES) jwt[r] = await login(r);
const ownerCount = async (table, filter) => {
  const res = await rest(jwt.owner, 'GET', `${table}?select=*&${q(filter)}`, undefined, 'count=exact');
  if (res.status !== 200) throw new Error(`owner read-back ${table} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return Array.isArray(res.body) ? res.body.length : null;
};

// ── table specs ────────────────────────────────────────────────────────────────
// key:     filter that identifies the seed row (UPDATE target, DELETE target fallback)
// insert:  (role) => [filter identifying the inserted row, body]
// same:    UPDATE body that sets values the seed already has
// I/U/D:   who is allowed; omit an op to skip it (unchanged by round 3)
const named = (table, extra = {}, col = 'name') => (role) => { const id = did(table, role); return [{ id }, { id, team_id: T, [col]: P(role), ...extra }]; };
const SPECS = [
  { table: 'workspace_api_keys', key: { id: seed('API_KEY') }, same: { team_id: T },
    insert: (r) => { const id = did('wak', r); return [{ id }, { id, team_id: T, platform_id: PLATFORM[r] }]; }, I: MS, U: MS, D: MS },
  { table: 'ads', key: { id: seed('AD') }, same: { team_id: T }, insert: named('ads'), I: EC, U: EC, D: DC },
  { table: 'ad_groups', key: { id: seed('AD_GROUP') }, same: { team_id: T }, insert: named('ad_groups'), I: EC, U: EC, D: DC },
  { table: 'campaigns', key: { id: seed('CAMPAIGN') }, same: { team_id: T }, insert: named('campaigns', { ad_account_id: ACCT }), I: EC, U: EC, D: DC },
  { table: 'campaign_ads', key: { campaign_id: seed('CAMPAIGN'), ad_id: seed('AD') }, same: { campaign_id: seed('CAMPAIGN') },
    insert: (r) => { const k = { campaign_id: seed('CAMPAIGN'), ad_id: ins('AD', r) }; return [k, k]; }, I: EC, U: EC, D: EC },
  { table: 'campaign_tags', key: { campaign_id: seed('CAMPAIGN'), tag_id: seed('TAG') }, same: { tag_id: seed('TAG') },
    insert: (r) => { const k = { campaign_id: seed('CAMPAIGN'), tag_id: ins('TAG', r) }; return [k, k]; }, I: EC, U: EC, D: EC },
  { table: 'tags', key: { id: seed('TAG') }, same: { team_id: T }, insert: named('tags'), I: EC, U: EC, D: EC },
  { table: 'budgets', key: { id: seed('BUDGET') }, same: { team_id: T }, insert: named('budgets'), I: MS, U: MS, D: MS },
  { table: 'customer_personas', key: { id: seed('PERSONA') }, same: { team_id: T }, insert: named('customer_personas', {}, 'persona_name'), I: EC, U: EC, D: DC },
  { table: 'ad_personas', key: { ad_id: seed('AD'), persona_id: seed('PERSONA') }, same: { persona_id: seed('PERSONA') },
    insert: (r) => { const k = { ad_id: seed('AD'), persona_id: ins('PERSONA', r) }; return [k, k]; }, I: EC, U: EC, D: EC },
  { table: 'post_personas', key: { post_id: seed('SOCIAL_POST'), persona_id: seed('PERSONA') }, same: { persona_id: seed('PERSONA') },
    insert: (r) => { const k = { post_id: seed('SOCIAL_POST'), persona_id: ins('PERSONA', r) }; return [k, k]; }, I: EC, U: EC, D: EC },
  { table: 'workspace_ad_persona', key: { workspace_id: T }, same: { workspace_id: T }, uniqueWorkspace: true,
    insert: () => [{ workspace_id: T }, { workspace_id: T }], I: EC, U: EC },
  { table: 'social_posts', key: { id: seed('SOCIAL_POST') }, same: { team_id: T }, insert: named('social_posts', { platform_id: GOOGLE }), I: EC, U: EC, D: DC },
  { table: 'social_comments', key: { id: seed('SOCIAL_COMMENT') }, same: { team_id: T },
    insert: named('social_comments', { post_id: seed('SOCIAL_POST'), author_name: 'kpi7r3' }, 'content'), I: EC, U: EC, D: EC },
  { table: 'reports', key: { id: seed('REPORT') }, same: { team_id: T }, insert: named('reports', { report_type: 'kpi7r3' }), I: DC, U: DC, D: DC },
  { table: 'scheduled_reports', key: { id: seed('SCHEDULED_REPORT') }, same: { team_id: T }, insert: named('scheduled_reports', { is_active: false }), I: DC, U: DC, D: DC },
  { table: 'email_campaigns', key: { id: seed('EMAIL_CAMPAIGN') }, same: { team_id: T },
    insert: (r) => { const id = did('email_campaigns', r); return [{ id }, { id, team_id: T, name: P(r), subject: P(r) }]; }, I: DC, U: DC, D: DC },
  { table: 'sync_history', key: { id: seed('SYNC_HISTORY') }, same: { team_id: T },
    insert: (r) => { const id = did('sync_history', r); return [{ id }, { id, team_id: T, platform_id: GOOGLE, sync_type: 'manual', status: 'failed', error_message: P(r) }]; }, I: NONE, U: NONE, D: NONE },
  { table: 'conversion_events', key: { id: seed('CONVERSION_EVENT') },
    insert: (r) => { const id = did('conversion_events', r); return [{ id }, { id, ad_account_id: ACCT, event_name: P(r), occurred_at: '2026-01-01T00:00:00Z' }]; }, I: NONE },
  { table: 'team_activity_logs', key: { id: seed('ACTIVITY_LOG') },
    insert: (r) => { const id = did('tal-own', r); return [{ id }, { id, team_id: T, user_id: uid(r), action: P(r) }]; }, I: MEM },
  { table: 'team_activity_logs', variant: 'forged actor', key: { id: seed('ACTIVITY_LOG') },
    insert: (r) => { const id = did('tal-forged', r); const other = r === 'owner' ? uid('admin') : uid('owner');
      return [{ id }, { id, team_id: T, user_id: other, action: `${P(r)}-forged` }]; }, I: NONE },
  { table: 'import_jobs', variant: 'own uploaded_by, status cancelled', key: null,
    insert: (r) => { const id = did('ij-own', r); return [{ id }, { id, team_id: T, uploaded_by: uid(r), platform: 'generic', status: 'cancelled',
      storage_path: `${T}/${P(r)}/probe.csv`, original_filename: P(r) }]; }, I: MS },
  { table: 'import_jobs', variant: 'forged uploaded_by', key: null,
    insert: (r) => { const id = did('ij-forged', r); const other = r === 'owner' ? uid('admin') : uid('owner');
      return [{ id }, { id, team_id: T, uploaded_by: other, platform: 'generic', status: 'cancelled',
      storage_path: `${T}/${P(r)}/forged.csv`, original_filename: `${P(r)}-forged` }]; }, I: NONE },
];

const out = { measured_at: new Date().toISOString(), test_team: T, cases: [], preconditions: {} };
const record = (c) => { c.as_declared = c.ok; delete c.ok; out.cases.push(c); };

// ── preconditions: every seed exists for the owner (proves the read-back can see a row) ──
for (const s of SPECS) if (s.key) {
  const n = await ownerCount(s.table, s.key);
  out.preconditions[`${s.table}${s.variant ? ` (${s.variant})` : ''}`] = n;
  if (n !== 1) throw new Error(`precondition: owner sees ${n} seed rows in ${s.table}, expected 1 — run fixture setup/teardown`);
}

// ── campaign_tags SELECT (its SELECT policy was re-created verbatim) ─────────────
for (const r of ROLES) {
  const res = await rest(jwt[r], 'GET', `campaign_tags?select=*&${q({ campaign_id: seed('CAMPAIGN') })}`, undefined, 'count=exact');
  const n = Array.isArray(res.body) ? res.body.length : null;
  record({ table: 'campaign_tags', op: 'SELECT seed link', role: r, status: res.status, rows: n, expected_rows: MEM[r] ? 1 : 0, ok: n === (MEM[r] ? 1 : 0) });
}

// ── INSERT / UPDATE / DELETE per table ───────────────────────────────────────────
const inserted = {};
for (const s of SPECS) {
  const label = s.variant ? `${s.table} (${s.variant})` : s.table;
  if (s.I) for (const r of ROLES) {
    const [key, body] = s.insert(r);
    const res = await rest(jwt[r], 'POST', s.table, body);
    const c = code(res);
    // workspace_ad_persona is unique per workspace and the seed exists: RLS passing
    // shows up as 23505 (unique violation), RLS refusing as 42501.
    const rlsPassed = s.uniqueWorkspace ? (res.status === 409 && c === '23505') : res.status === 201;
    const rlsRefused = (res.status === 403 || res.status === 401) && c === '42501';
    let readback = null;
    if (!s.uniqueWorkspace) { readback = await ownerCount(s.table, key); if (rlsPassed && readback === 1) inserted[`${label}|${r}`] = key; }
    const expected = s.I[r];
    const ok = expected ? (rlsPassed && (s.uniqueWorkspace || readback === 1)) : (rlsRefused && (s.uniqueWorkspace || readback === 0));
    record({ table: label, op: 'INSERT', role: r, status: res.status, code: c, owner_readback: readback, expected: expected ? 'allowed' : 'refused', attempts: res.attempts, ok });
  }
  if (s.U) for (const r of ROLES) {
    const res = await rest(jwt[r], 'PATCH', `${s.table}?${q(s.key)}`, s.same);
    const n = affected(res);
    const expected = s.U[r];
    record({ table: label, op: 'UPDATE seed (same values)', role: r, status: res.status, rows_affected: n, expected: expected ? 'allowed' : 'refused', attempts: res.attempts,
      ok: expected ? (res.status === 204 && n === 1) : ((res.status === 204 && n === 0) || code(res) === '42501') });
  }
  if (s.D) for (const r of ROLES) {
    const own = inserted[`${label}|${r}`];
    // A role allowed to delete is only ever pointed at its OWN row. If its insert
    // did not land there is nothing safe to delete: record it, send nothing (never
    // fall back to the seed, which a wrongly-allowed delete would destroy).
    if (s.D[r] && !own) {
      record({ table: label, op: 'DELETE', role: r, target: 'none (own insert missing)', expected: 'allowed', ok: false });
      continue;
    }
    const target = own ?? s.key;
    const res = await rest(jwt[r], 'DELETE', `${s.table}?${q(target)}`);
    const n = affected(res);
    const remaining = await ownerCount(s.table, target);
    const expected = s.D[r];
    record({ table: label, op: 'DELETE', role: r, target: own ? 'own inserted row' : 'seed row', status: res.status, rows_affected: n, owner_readback_after: remaining,
      expected: expected ? 'allowed' : 'refused', attempts: res.attempts,
      ok: expected ? (n === 1 && remaining === 0) : (n === 0 && remaining === 1) });
  }
}

// ── imports bucket: upload into <test team>/kpi7r3-probe-<role>/ ───────────────
for (const r of ROLES) {
  const path = `${T}/${P(r)}/probe.csv`;
  const res = await http(jwt[r], 'POST', `/storage/v1/object/imports/${path}`, 'a,b\n1,2\n', { 'content-type': 'text/csv', 'x-upsert': 'false' });
  const list = await http(jwt.owner, 'POST', '/storage/v1/object/list/imports', { prefix: `${T}/${P(r)}`, limit: 10 }, { 'content-type': 'application/json' });
  const present = Array.isArray(list.body) ? list.body.filter((o) => o.name === 'probe.csv').length : null;
  const expected = MS[r];
  record({ table: 'storage.objects (imports)', op: 'UPLOAD', role: r, status: res.status, error: res.status >= 300 ? (res.body?.message ?? res.body?.error ?? null) : null,
    owner_list: present, expected: expected ? 'allowed' : 'refused', ok: expected ? (res.status === 200 && present === 1) : (res.status >= 400 && present === 0) });
}

// ── cross-tenant: test-workspace owner against the OUTSIDER workspace's seeds ────
for (const [table, k, same] of [['ads', 'AD', { team_id: O_T }], ['campaigns', 'CAMPAIGN', { team_id: O_T }], ['budgets', 'BUDGET', { team_id: O_T }],
  ['workspace_api_keys', 'API_KEY', { team_id: O_T }], ['reports', 'REPORT', { team_id: O_T }], ['social_comments', 'SOCIAL_COMMENT', { team_id: O_T }],
  ['sync_history', 'SYNC_HISTORY', { team_id: O_T }]]) {
  const u = await rest(jwt.owner, 'PATCH', `${table}?id=eq.${seed(k, 'OUTSIDER')}`, same);
  const d = await rest(jwt.owner, 'DELETE', `${table}?id=eq.${seed(k, 'OUTSIDER')}`);
  record({ table, op: 'UPDATE+DELETE outsider-workspace seed', role: 'owner (of test ws)', update_rows: affected(u), delete_rows: affected(d),
    expected: 'refused', ok: affected(u) === 0 && affected(d) === 0 });
}
const xi = await rest(jwt.owner, 'POST', 'ads', { id: did('xt-ads'), team_id: O_T, name: P('owner-cross') });
record({ table: 'ads', op: 'INSERT into outsider workspace', role: 'owner (of test ws)', status: xi.status, code: code(xi), expected: 'refused', ok: xi.status === 403 && code(xi) === '42501' });

out.retries_on_57014 = retries;
out.summary = `${out.cases.filter((c) => c.as_declared).length}/${out.cases.length} as declared`;
writeFileSync(process.argv[2], JSON.stringify(out, null, 2) + '\n');
for (const c of out.cases.filter((x) => !x.as_declared)) console.log('NOT AS DECLARED:', JSON.stringify(c));
console.log(out.summary, `| 57014 retries: ${retries}`);
