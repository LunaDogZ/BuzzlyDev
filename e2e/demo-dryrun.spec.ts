import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

/**
 * Dry run of the 5-minute demo path in docs/DEMO_RUNBOOK.md, against the real
 * deployed site the presenter will open tomorrow.
 *
 * Absolute URLs on purpose: the project baseURL is localhost, and localhost is
 * not what gets demoed. The host is spelled out rather than an alias — an alias
 * answers 302 into Vercel SSO, which looks like a pass.
 *
 * Measures time-to-useful-content per page, because the runbook's §3 warns the
 * free-tier backend floor moves on its own (29s and 41s were both observed with
 * no code change). A number from tonight is worth more than a number from
 * 2026-09-10.
 */
const SITE = 'https://buzzly-dev.vercel.app';
const EMAIL = process.env.E2E_EMAIL || 'e2e@buzzly.test';
const PASSWORD = process.env.E2E_PASSWORD || 'E2eWalk!2026';
const SHOT = 'e2e/screenshots/demo-dryrun';

type Step = { name: string; path: string; anchor: RegExp; note: string };

const STEPS: Step[] = [
  { name: '1-dashboard',  path: '/dashboard',  anchor: /IMPRESSIONS|Dashboard/i,        note: 'source line + stat cards' },
  { name: '2-imports',    path: '/imports',    anchor: /IMPORTS/i,                       note: '3 jobs, one failed' },
  { name: '3-campaigns',  path: '/campaigns',  anchor: /CAMPAIGNS/i,                     note: '18 campaigns' },
  { name: '4-personas',   path: '/personas',   anchor: /persona|Modern|อายุ/i,           note: 'charts' },
];

test.describe.configure({ mode: 'serial' });

test('demo path works on production, and how slow it is', async ({ page }) => {
  test.setTimeout(600_000);
  fs.mkdirSync(SHOT, { recursive: true });

  const timings: Record<string, number> = {};
  const t0 = Date.now();
  await page.goto(`${SITE}/auth`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in to buzzly/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 120_000 });
  timings['0-login'] = Date.now() - t0;

  for (const step of STEPS) {
    const start = Date.now();
    await page.goto(`${SITE}${step.path}`, { waitUntil: 'domcontentloaded' });
    // first moment the presenter has something to point at
    await expect(page.locator('body')).toContainText(step.anchor, { timeout: 120_000 });
    timings[`${step.name}-first-content`] = Date.now() - start;
    // then let it finish, which is when the numbers are trustworthy
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    await page
      .waitForFunction(() => document.querySelectorAll('.animate-spin').length === 0, null, { timeout: 60_000 })
      .catch(() => {});
    await page.waitForTimeout(1500);
    timings[`${step.name}-settled`] = Date.now() - start;
    await page.screenshot({ path: `${SHOT}/${step.name}.png`, fullPage: true });

    const text = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync(`${SHOT}/${step.name}.txt`, text);
    expect(page.url(), `${step.path} must not bounce to /auth`).not.toMatch(/\/auth(\?|$)/);
  }

  fs.writeFileSync(`${SHOT}/timings.json`, JSON.stringify(timings, null, 2));
  console.log('\n=== DEMO DRY RUN (production) ===');
  for (const [k, v] of Object.entries(timings)) {
    console.log(`  ${k.padEnd(28)} ${(v / 1000).toFixed(1)}s`);
  }
});
