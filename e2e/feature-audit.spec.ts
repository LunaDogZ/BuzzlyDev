import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Feature audit — does each sidebar destination actually work?
 *
 * Two accounts, because one cannot answer both questions:
 *
 *   TEAM  (e2e@buzzly.test)      — every feature unlocked, workspace has real
 *                                  ad data. Answers "does the page render?"
 *   FREE  (k6-load-01@…)         — no subscription row at all, so PlanContext
 *                                  falls back to `free`. Answers "is the plan
 *                                  lock actually enforced on the route?"
 *
 * Neither account is mutated. The free account is used as it already exists.
 */

const TEAM = { email: process.env.E2E_EMAIL || 'e2e@buzzly.test', password: process.env.E2E_PASSWORD || 'E2eWalk!2026' };
const FREE = { email: process.env.FREE_EMAIL || 'k6-load-01@buzzly.test', password: process.env.FREE_PASSWORD || 'K6Load!2026' };

const SHOT_DIR = 'e2e/screenshots/feature-audit';
const OUT = 'e2e/screenshots/feature-audit/report.json';

/** Every destination the customer sidebar can reach (Social expanded to its tabs). */
const ROUTES = [
  { path: '/dashboard',        name: '01-dashboard',        label: 'Dashboard',         requiresPlan: null },
  { path: '/social/planner',   name: '02-social-planner',   label: 'Social · Planner',  requiresPlan: null },
  { path: '/social/analytics', name: '03-social-analytics', label: 'Social · Analytics',requiresPlan: null },
  { path: '/social/inbox',     name: '04-social-inbox',     label: 'Social · Inbox',    requiresPlan: null },
  { path: '/personas',         name: '05-personas',         label: 'Customer Personas', requiresPlan: null },
  { path: '/campaigns',        name: '06-campaigns',        label: 'Campaigns',         requiresPlan: 'pro'  },
  { path: '/customer-journey', name: '07-customer-journey', label: 'Customer Journey',  requiresPlan: 'pro'  },
  { path: '/aarrr-funnel',     name: '08-aarrr-funnel',     label: 'AARRR Funnel',      requiresPlan: 'pro'  },
  { path: '/analytics',        name: '09-analytics',        label: 'Analytics',         requiresPlan: 'pro'  },
  { path: '/team',             name: '10-team',             label: 'Team Management',   requiresPlan: 'team' },
  { path: '/reports',          name: '11-reports',          label: 'Reports',           requiresPlan: 'pro'  },
  { path: '/api-keys',         name: '12-api-keys',         label: 'API Keys',          requiresPlan: null },
  { path: '/imports',          name: '13-imports',          label: 'Imports',           requiresPlan: null },
  { path: '/settings',         name: '14-settings',         label: 'Settings',          requiresPlan: null },
];

type Probe = {
  label: string; path: string; requiresPlan: string | null;
  finalUrl: string; bouncedToAuth: boolean; planGateBlocked: boolean;
  crashed: boolean; stillLoading: boolean; heading: string; textLen: number;
  tableRows: number; charts: number; emptyState: boolean;
  consoleErrors: string[]; failedRequests: string[];
};

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto('/auth');
  await page.locator('#email').fill(who.email);
  await page.locator('#password').fill(who.password);
  await page.getByRole('button', { name: /sign in to buzzly/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.reload({ waitUntil: 'domcontentloaded' });
}

/** Copy that pages show *while still loading* — none of it is a finished state. */
const LOADING_COPY = /Mapping customer paths|Analyzing funnel stages|Synchronizing|Loading…|กำลังโหลด|Crunching|Preparing/i;

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('.animate-spin').length === 0, null, { timeout: 20000 }).catch(() => {});
  // Several pages use a bespoke loader that is not .animate-spin, so waiting on
  // the spinner class alone screenshots them mid-load and calls it "rendered".
  await page
    .waitForFunction(
      (src) => !new RegExp(src, 'i').test(document.body.innerText || ''),
      LOADING_COPY.source,
      { timeout: 30000 },
    )
    .catch(() => {});
  await page.waitForTimeout(1800);
}

/** Visit one route and describe what actually came back. */
async function probe(page: Page, r: typeof ROUTES[number], shotPrefix: string): Promise<Probe> {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const onConsole = (m: { type: () => string; text: () => string }) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
  };
  const onFailed = (req: { url: () => string; failure: () => { errorText: string } | null }) =>
    failedRequests.push(`${req.url().slice(0, 120)} ${req.failure()?.errorText ?? ''}`);
  const onResponse = (res: { status: () => number; url: () => string }) => {
    if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.url().slice(0, 120)}`);
  };
  page.on('console', onConsole);
  page.on('requestfailed', onFailed);
  page.on('response', onResponse);

  await page.goto(r.path, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.screenshot({ path: path.join(SHOT_DIR, `${shotPrefix}-${r.name}.png`), fullPage: true });

  const facts = await page.evaluate(() => {
    const body = document.body.innerText || '';
    const h = document.querySelector('h1, h2');
    return {
      text: body,
      heading: (h?.textContent || '').trim().slice(0, 80),
      tableRows: document.querySelectorAll('table tbody tr').length,
      charts: document.querySelectorAll('.recharts-surface, svg.recharts-surface, canvas').length,
    };
  });

  page.off('console', onConsole);
  page.off('requestfailed', onFailed);
  page.off('response', onResponse);

  return {
    label: r.label, path: r.path, requiresPlan: r.requiresPlan,
    finalUrl: new URL(page.url()).pathname,
    bouncedToAuth: /\/auth(\?|$)/.test(page.url()),
    // There are TWO plan gates in this codebase and they look nothing alike:
    //   <PlanGate>            -> UpgradePrompt      "PRO Plan Required" / "Unlock X"
    //   <PlanRestrictedPage>  -> Thai placeholder   "ฟีเจอร์นี้ต้องการ PRO Plan หรือสูงกว่า"
    //                            + UpgradeRequiredDialog "requires a plan upgrade"
    // Matching only the first reports the second as a normally rendered page.
    planGateBlocked:
      (/Plan Required/i.test(facts.text) && /Unlock /i.test(facts.text)) ||
      /ฟีเจอร์นี้ต้องการ/.test(facts.text) ||
      /requires a plan upgrade/i.test(facts.text) ||
      /Requires\s+(PRO|TEAM)\s+Plan or higher/i.test(facts.text),
    crashed: /Something went wrong|Application error|Unexpected Application Error/i.test(facts.text),
    stillLoading: LOADING_COPY.test(facts.text),
    heading: facts.heading,
    textLen: facts.text.length,
    tableRows: facts.tableRows,
    charts: facts.charts,
    emptyState: /No data|no results|ยังไม่มี|ไม่พบข้อมูล|Nothing here|empty/i.test(facts.text),
    consoleErrors: [...new Set(consoleErrors)].slice(0, 5),
    failedRequests: [...new Set(failedRequests)].slice(0, 5),
  };
}

test.describe.configure({ mode: 'serial' });

const results: Record<string, Probe[]> = {};

test('TEAM plan — all 14 sidebar destinations render', async ({ page }) => {
  test.setTimeout(600_000);
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await login(page, TEAM);

  const out: Probe[] = [];
  for (const r of ROUTES) out.push(await probe(page, r, 'team'));
  results.team = out;

  for (const p of out) {
    expect(p.bouncedToAuth, `${p.path} bounced to /auth — session or guard failure`).toBe(false);
  }
});

test('FREE plan — which plan-locked routes are actually enforced', async ({ page }) => {
  test.setTimeout(600_000);
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await login(page, FREE);

  const out: Probe[] = [];
  for (const r of ROUTES) out.push(await probe(page, r, 'free'));
  results.free = out;

  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));

  const at = (path: string) => out.find((p) => p.path === path)!;

  // CONTROLS. A "not blocked" verdict only means something if the detector is
  // shown to catch blocking when it happens — and this app blocks in two
  // different ways, so one positive control is not enough. The first run had
  // only the <PlanGate> control, passed it, and still reported five
  // <PlanRestrictedPage> routes as freely reachable. All three must hold:
  //   1. PlanGate-style block is detected
  expect(at('/campaigns').planGateBlocked, 'CONTROL 1 FAILED: <PlanGate> block on /campaigns not detected').toBe(true);
  //   2. PlanRestrictedPage-style block is detected (the one that was missed)
  expect(at('/analytics').planGateBlocked, 'CONTROL 2 FAILED: <PlanRestrictedPage> block on /analytics not detected').toBe(true);
  //   3. ...and the detector does not simply answer "blocked" to everything
  expect(at('/dashboard').planGateBlocked, 'CONTROL 3 FAILED: /dashboard reported as plan-blocked — detector matches everything').toBe(false);

  for (const p of out) {
    expect(p.bouncedToAuth, `${p.path} bounced to /auth`).toBe(false);
  }
});

test.afterAll(() => {
  if (!results.team || !results.free) return;
  const row = (p: Probe) =>
    p.bouncedToAuth ? 'BOUNCED'
      : p.crashed ? 'CRASH'
      : p.planGateBlocked ? 'plan-blocked'
      : p.stillLoading ? 'STUCK-LOADING'
      : 'rendered';
  console.log('\n=== FEATURE AUDIT ===');
  console.log('route'.padEnd(20), 'plan?'.padEnd(6), 'TEAM'.padEnd(14), 'FREE'.padEnd(14), 'rows/charts(team)');
  for (let i = 0; i < ROUTES.length; i++) {
    const t = results.team[i], f = results.free[i];
    console.log(
      t.path.padEnd(20),
      String(t.requiresPlan ?? '-').padEnd(6),
      row(t).padEnd(14),
      row(f).padEnd(14),
      `${t.tableRows}/${t.charts}`,
    );
  }
  console.log(`\nreport: ${OUT}`);
});
