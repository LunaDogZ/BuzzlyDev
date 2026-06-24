import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

// Authenticated visual walk of the customer pages, using a dedicated e2e account
// (e2e@buzzly.test) that owns a seeded workspace with real ad data.
// Credentials come from env with test-account defaults (account is throwaway).
const EMAIL = process.env.E2E_EMAIL || 'e2e@buzzly.test';
const PASSWORD = process.env.E2E_PASSWORD || 'E2eWalk!2026';
const SHOT_DIR = 'e2e/screenshots';

test.describe.configure({ mode: 'serial' });

async function login(page: Page) {
  await page.goto('/auth');
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in to buzzly/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 20000 });
  // let the Supabase auth session fully propagate, then reload so all react-query
  // hooks (plan, platform connections) run with an established session — avoids the
  // transient "connect a platform" onboarding flash on first post-login render.
  await page.waitForTimeout(2000);
  await page.reload({ waitUntil: 'domcontentloaded' });
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  // wait for loading spinners (animate-spin) to disappear
  await page.waitForFunction(() => document.querySelectorAll('.animate-spin').length === 0, null, { timeout: 15000 }).catch(() => {});
  // wait for common loading text ("Synchronizing…", "Loading…") to clear
  await page.waitForFunction(() => !/Synchronizing|Loading…|กำลังโหลด/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500); // let charts finish painting
}

test('customer pages render with data after login', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  await login(page);
  await settle(page);
  await page.screenshot({ path: `${SHOT_DIR}/01-dashboard.png`, fullPage: true });

  const pages = [
    { path: '/campaigns', name: '02-campaigns' },
    { path: '/analytics', name: '03-analytics' },
    { path: '/customer-journey', name: '04-customer-journey' },
    { path: '/aarrr-funnel', name: '05-aarrr-funnel' },
    { path: '/reports', name: '06-reports' },
  ];

  for (const p of pages) {
    await page.goto(p.path, { waitUntil: 'domcontentloaded' });
    // staying authenticated is the hard assertion; a bounce to /auth = session/guard failure
    expect(page.url(), `${p.path} should not redirect to /auth`).not.toMatch(/\/auth(\?|$)/);
    await settle(page);
    await page.screenshot({ path: `${SHOT_DIR}/${p.name}.png`, fullPage: true });
  }

  // Campaign detail — best effort: open the first campaign if the list links out.
  await page.goto('/campaigns', { waitUntil: 'domcontentloaded' });
  await settle(page);
  const firstCampaign = page.locator('a[href^="/campaigns/"]').first();
  if (await firstCampaign.count()) {
    await firstCampaign.click();
    await page.waitForURL(/\/campaigns\/[^/]+$/, { timeout: 10000 }).catch(() => {});
    await settle(page);
    await page.screenshot({ path: `${SHOT_DIR}/07-campaign-detail.png`, fullPage: true });
  }
});
