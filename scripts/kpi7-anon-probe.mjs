// KPI-7 A01 evidence: can the anon role read any table?
// Design note (CLAUDE.md §12): a probe that reports "0 rows everywhere" proves
// nothing unless the same probe is shown to return rows when it is authorised.
// So every table is read twice — once as anon, once as service_role — and a
// table the service_role also finds empty is reported as INCONCLUSIVE, never
// as a pass.
import fs from 'node:fs';

const unquote = v => v.trim().replace(/^["']|["']$/g, '');
const parseEnv = p => Object.fromEntries(
  fs.readFileSync(p, 'utf8').split('\n')
    .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), unquote(l.slice(i + 1))]; })
);
const fe = parseEnv('.env');
const be = parseEnv('mock-api/.env');
const URL_ = fe.VITE_SUPABASE_URL, ANON = fe.VITE_SUPABASE_ANON_KEY, SR = be.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SR) { console.error('missing env'); process.exit(1); }

const tables = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);

async function probe(table, key) {
  const r = await fetch(`${URL_}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
  });
  const cr = r.headers.get('content-range') || '';
  const count = cr.includes('/') ? cr.split('/')[1] : null;
  let body = null;
  try { body = await r.json(); } catch { }
  return { status: r.status, count: count === '*' ? null : (count === null ? null : Number(count)),
           rows: Array.isArray(body) ? body.length : null,
           err: Array.isArray(body) ? null : (body?.message || body?.code || null) };
}

const out = [];
for (const t of tables) {
  const a = await probe(t, ANON);
  const s = await probe(t, SR);
  let verdict;
  if (a.rows > 0)                      verdict = 'ANON-READABLE';
  else if (s.rows === null || s.rows === 0) verdict = 'INCONCLUSIVE (no data even for service_role)';
  else                                 verdict = 'anon blocked';
  out.push({ table: t, anon: a, service_role: s, verdict });
  console.log(`${verdict.padEnd(44)} ${t.padEnd(34)} anon:${a.status}/${a.rows ?? '-'}rows/${a.count ?? '-'}  sr:${s.status}/${s.rows ?? '-'}rows/${s.count ?? '-'}`);
}
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 2));

const n = v => out.filter(o => o.verdict.startsWith(v)).length;
console.log(`\n=== ${out.length} relations ===`);
console.log(`ANON-READABLE : ${n('ANON-READABLE')}`);
console.log(`anon blocked  : ${n('anon blocked')}   <- meaningful: service_role saw rows, anon saw none`);
console.log(`INCONCLUSIVE  : ${n('INCONCLUSIVE')}   <- table empty; proves nothing either way`);

// Usage:
//   node scripts/kpi7-anon-probe.mjs <relations.txt> <out.json>
// where relations.txt is one table/view name per line (see
// evidence/kpi7-security/<sha>/a01-relations.txt, 103 tables + 2 views
// extracted from src/integrations/supabase/types.ts).
// Requires .env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) and
// mock-api/.env (SUPABASE_SERVICE_ROLE_KEY). Read-only: GET only.
