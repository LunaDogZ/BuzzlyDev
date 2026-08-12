import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

/**
 * Proof that the REAL Meta leg reaches the screen.
 *
 * This is the founder's stated bar for the research core — "เชื่อมกับ API จริง →
 * ข้อมูลไหลเข้ามา → เกิดเป็นกราฟจริง" — so the assertions are about what a human
 * sees, not about what the database holds. A DB row nobody can look at proves
 * the pipe, not the product.
 *
 * It asserts against LIVE data and therefore deliberately does NOT hard-code
 * ฿1,316.41: the connected account is a real one that is still spending, and a
 * test pinned to today's total would fail tomorrow for the one reason that is
 * not a defect. What is pinned instead are the invariants that would break if
 * the connector regressed:
 *
 *   - the source filter offers "Meta (ข้อมูลจริง)" at all
 *   - selecting it leaves the dashboard with data rather than the empty state
 *   - the badge stops calling the numbers simulated
 *   - a chart actually paints a series
 *
 * Requires the meta_live rows to exist — run the connector first:
 *   POST /api/meta/sync {workspaceId, adAccountId}
 */

const EMAIL = process.env.E2E_EMAIL || 'e2e@buzzly.test';
const PASSWORD = process.env.E2E_PASSWORD || 'E2eWalk!2026';
const SHOT_DIR = 'e2e/screenshots';

async function login(page: Page) {
  await page.goto('/auth');
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in to buzzly/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 20000 });
  await page.waitForTimeout(2000);
  await page.reload({ waitUntil: 'domcontentloaded' });
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page
    .waitForFunction(() => document.querySelectorAll('.animate-spin').length === 0, null, { timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
}

test('real Meta data reaches the dashboard as a chart', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  await login(page);
  await settle(page);

  // The account's history spans four disjoint months back to 2025-07, so the
  // default 30-day window would show only the newest few rows. "All time" is
  // what makes the whole real series visible.
  const [dateRange, , dataSource] = await page.locator('header button[role="combobox"]').all();
  await dateRange.click();
  await page.getByRole('option', { name: 'All time' }).click();
  await settle(page);

  // 1. The filter must offer the live source at all.
  await dataSource.click();
  const liveOption = page.getByRole('option', { name: /Meta \(ข้อมูลจริง\)/ });
  await expect(liveOption).toBeVisible();
  await liveOption.click();
  await settle(page);

  // 2. Filtered to Meta only, the dashboard must have data — not the "no data
  //    for this source" empty state, which is what it showed before today.
  await expect(page.getByText(/ยังไม่มีข้อมูล|no data/i)).toHaveCount(0);

  // 3. Spend must be a non-zero baht figure. Read from the page, compared as a
  //    number, so the assertion survives the account spending more tomorrow.
  const body = await page.locator('body').innerText();
  const baht = [...body.matchAll(/฿\s?([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, '')));
  expect(baht.some((v) => v > 0), 'dashboard should show a non-zero ฿ figure').toBe(true);

  // 4. The badge must NOT be claiming these are simulated numbers. This is the
  //    provenance work paying off: the same page that renders real spend has to
  //    stop labelling it as fixture data.
  await expect(page.getByText(/ข้อมูลจำลอง/)).toHaveCount(0);

  // 5. A chart has actually painted a series. `d` length rules out an axis-only
  //    SVG — the mount-animation trap that made this look broken once before.
  const painted = await page.evaluate(() => {
    const paths = [...document.querySelectorAll('svg path')];
    return paths.filter((p) => (p.getAttribute('d') ?? '').length > 100).length;
  });
  expect(painted, 'at least one chart series should be drawn').toBeGreaterThan(0);

  await page.screenshot({ path: `${SHOT_DIR}/10-dashboard-meta-live.png`, fullPage: true });
});
