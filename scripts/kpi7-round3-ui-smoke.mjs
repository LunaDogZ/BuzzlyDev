// KPI-7 round 3 — UI smoke / regression walk on the DEPLOYED app, as a real user.
//
// Opens each page, waits for the network to settle, and records: the final URL
// (a TeamPermissionsGuard redirect shows up here), every Supabase response with
// status >= 400, console errors, visible error text, and a screenshot. It only
// READS: it clicks nothing that writes.
//
//   node scripts/kpi7-round3-ui-smoke.mjs <outDir> <account> [<account> ...]
//
// account = kpi7 role (owner|admin|editor|viewer|…), read from .env.kpi7-round2.local,
//           or "e2e", read from the env vars E2E_EMAIL / E2E_PASSWORD (never written out).
// PAGES   = comma-separated paths (env), default: the round-3 smoke set.

import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readEnv = (p) => Object.fromEntries(
  readFileSync(p, 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
const fx = readEnv(resolve(ROOT, '.env.kpi7-round2.local'));
const SITE = process.env.SITE ?? 'https://buzzly-dev.vercel.app';
const PAGES = (process.env.PAGES ?? '/dashboard,/imports,/campaigns,/api-keys,/team').split(',');
const ERROR_TEXT = /row-level security|permission denied|violates|failed to|error|ไม่สามารถ|ผิดพลาด|42501/i;

const [outDir, ...accounts] = process.argv.slice(2);
if (!outDir || !accounts.length) { console.error('usage: kpi7-round3-ui-smoke.mjs <outDir> <account>...'); process.exit(2); }
mkdirSync(outDir, { recursive: true });

function creds(account) {
  if (account === 'e2e') {
    if (!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD) throw new Error('E2E_EMAIL / E2E_PASSWORD not set');
    return { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD };
  }
  const K = account.toUpperCase();
  return { email: fx[`KPI7_${K}_EMAIL`], password: fx[`KPI7_${K}_PASSWORD`] };
}

const browser = await chromium.launch();
const result = { site: SITE, at: new Date().toISOString(), accounts: {} };
for (const account of accounts) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  let current = 'login';
  const log = { login: null, pages: {} };
  const bucket = () => (log.pages[current] ??= { bad_responses: [], console_errors: [] });
  page.on('response', (r) => {
    if (r.status() >= 400 && /supabase\.co/.test(r.url())) bucket().bad_responses.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https:\/\/[^/]+/, '').slice(0, 160)}`);
  });
  page.on('console', (m) => { if (m.type() === 'error') bucket().console_errors.push(m.text().slice(0, 300)); });

  const { email, password } = creds(account);
  await page.goto(`${SITE}/`, { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !/\/$/.test(u.pathname) || u.pathname !== '/', { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  log.login = { landed_on: new URL(page.url()).pathname };

  for (const path of PAGES) {
    current = path;
    bucket();
    await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => bucket().console_errors.push(`goto: ${e.message}`));
    await page.waitForTimeout(2500);
    const text = await page.locator('main').innerText().catch(() => page.locator('body').innerText());
    const toasts = await page.locator('[data-sonner-toast], [role="status"], [role="alert"]').allInnerTexts().catch(() => []);
    Object.assign(bucket(), {
      final_path: new URL(page.url()).pathname,
      redirected: new URL(page.url()).pathname !== path,
      chars: text.length,
      head: text.slice(0, 300),
      error_lines: text.split('\n').filter((l) => ERROR_TEXT.test(l)).slice(0, 10),
      toasts: toasts.filter(Boolean).slice(0, 10),
    });
    await page.screenshot({ path: resolve(outDir, `${account}${path.replace(/\//g, '_')}.png`), fullPage: false });
  }
  result.accounts[account] = log;
  await ctx.close();
}
await browser.close();
writeFileSync(resolve(outDir, 'smoke.json'), JSON.stringify(result, null, 2) + '\n');
for (const [a, l] of Object.entries(result.accounts)) {
  console.log(`== ${a} (landed ${l.login.landed_on})`);
  for (const [p, r] of Object.entries(l.pages)) {
    if (p === 'login') continue;
    console.log(`  ${p.padEnd(22)} → ${r.final_path}${r.redirected ? ' (REDIRECT)' : ''}  chars=${r.chars}  bad=${r.bad_responses.length}  console=${r.console_errors.length}  err_lines=${r.error_lines.length}  toasts=${r.toasts.length}`);
  }
}
