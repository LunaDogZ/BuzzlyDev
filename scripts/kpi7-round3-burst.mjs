// KPI-7 round 3 — burst test: N parallel real-browser page loads per role on the
// deployed app, capturing every Supabase 5xx WITH its response headers, so the
// error code (proxy-status) is recorded rather than inferred. Reads only.
// Each session logs in itself. A second run in quick succession left 19/20
// logins uncompleted after 60 s, and a variant sharing one login's storage
// state produced ~0 data requests; both are recorded as invalid harness runs.
//
//   node scripts/kpi7-round3-burst.mjs <out.json> [parallel=10] [role ...]

import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readEnv = (p) => Object.fromEntries(readFileSync(p, 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const fx = readEnv(resolve(ROOT, '.env.kpi7-round2.local'));
const SITE = 'https://buzzly-dev.vercel.app';
const [outPath, nArg, ...rolesArg] = process.argv.slice(2);
const N = Number(nArg ?? 10);
const roles = rolesArg.length ? rolesArg : ['viewer', 'editor'];
const PAGES = ['/dashboard', '/personas'];

const browser = await chromium.launch();
const out = { site: SITE, at: new Date().toISOString(), parallel: N, pages: PAGES, roles: {} };
for (const role of roles) {
  const sessions = await Promise.all(Array.from({ length: N }, async (_, i) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const s = { session: i, requests: 0, fivexx: [], error: null };
    page.on('response', async (r) => {
      if (!/supabase\.co\/rest\//.test(r.url())) return;
      s.requests++;
      if (r.status() >= 500) {
        let body = ''; try { body = (await r.text()).slice(0, 300); } catch { /* HEAD has no body */ }
        const h = r.headers();
        s.fivexx.push({ status: r.status(), method: r.request().method(), table: (/\/rest\/v1\/([a-z_]+)/.exec(r.url()) ?? [])[1],
          proxy_status: h['proxy-status'] ?? null, body });
      }
    });
    try {
      await page.goto(`${SITE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.fill('#email', fx[`KPI7_${role.toUpperCase()}_EMAIL`]);
      await page.fill('#password', fx[`KPI7_${role.toUpperCase()}_PASSWORD`]);
      await page.click('button[type="submit"]');
      await page.waitForURL(/\/dashboard/, { timeout: 60000 });
      for (const p of PAGES) { await page.goto(`${SITE}${p}`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.waitForTimeout(8000); }
    } catch (e) { s.error = e.message.split('\n')[0]; }
    await ctx.close();
    return s;
  }));
  const all = sessions.flatMap((s) => s.fivexx);
  const byCode = {};
  for (const f of all) { const k = `${f.status} ${f.proxy_status ?? 'no proxy-status'} ${f.table}`; byCode[k] = (byCode[k] ?? 0) + 1; }
  out.roles[role] = { sessions, rest_requests: sessions.reduce((a, s) => a + s.requests, 0), fivexx_total: all.length, by_code: byCode,
    session_errors: sessions.filter((s) => s.error).map((s) => s.error) };
  console.log(`${role}: ${out.roles[role].rest_requests} REST responses, ${all.length} 5xx`, JSON.stringify(byCode), out.roles[role].session_errors.length ? `session errors: ${out.roles[role].session_errors.length}` : '');
}
await browser.close();
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
