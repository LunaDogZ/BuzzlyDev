import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

/**
 * Proof that ROAS is on screen as a bound, and withheld where it cannot be one.
 *
 * The dashboard printed "0.0x" for months. Not because the arithmetic was
 * subtly wrong, but because it averaged a stored `roas` column that is NULL on
 * every real Meta row — a fabricated figure that happened to look modest. The
 * fix (2026-08-14) stores Meta's `action_values` as revenue and divides sums.
 *
 * Both halves are asserted here because only one of them is visible at a time,
 * and a rule that hides a number is only trustworthy if you can also see it
 * show one:
 *
 *   - Meta rows → a figure appears, marked `≥` because Meta omits
 *     `action_values` on days it attributed no purchase value to;
 *   - uploaded-file rows → "—" and a sentence naming the source, never 0.0x.
 *
 * Deliberately NOT pinned to "≥ 2.6x": the connected account is real and still
 * spending, so tomorrow's true figure differs and a hard-coded one would fail
 * for the only reason that is not a defect. What is pinned is the shape.
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

/** The ROAS card's value and its caption, read as the merchant sees them. */
async function readRoasCard(page: Page): Promise<{ value: string; caption: string }> {
  const label = page.getByText('ROAS', { exact: true }).first();
  const card = label.locator('xpath=..');
  const lines = (await card.innerText()).split('\n').map((l) => l.trim()).filter(Boolean);
  return { value: lines[1] ?? '', caption: lines[2] ?? '' };
}

async function chooseSource(page: Page, name: RegExp) {
  const [, , dataSource] = await page.locator('header button[role="combobox"]').all();
  await dataSource.click();
  await page.getByRole('option', { name }).click();
  await settle(page);
}

test('ROAS is stated as a bound on Meta rows and withheld on uploads', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  await login(page);
  await settle(page);

  // The account's history spans four disjoint months back to 2025-07, and all
  // six revenue-bearing rows are in the first of them — the default 30-day
  // window contains none of them.
  const [dateRange] = await page.locator('header button[role="combobox"]').all();
  await dateRange.click();
  await page.getByRole('option', { name: 'All time' }).click();
  await settle(page);

  // ── Meta: a figure, marked as a floor ──────────────────────────────────────
  // The stable half of the label only — the parenthetical has already been
  // reworded once (857cdec) and took e2e/meta-live.spec.ts down with it.
  await chooseSource(page, /^Meta API/);

  const live = await readRoasCard(page);
  expect(live.value, 'Meta rows should produce a ROAS').toMatch(/^≥ \d+\.\d+x$/);
  expect(live.value, 'the fabricated 0.0x must be gone').not.toBe('0.0x');
  // The caption has to say whose revenue this is. "ROAS 2.6x" unqualified would
  // claim measured income; what Meta reports is value it attributes to itself.
  expect(live.caption).toMatch(/ตามที่แพลตฟอร์มรายงาน/);

  await page.screenshot({ path: `${SHOT_DIR}/13-dashboard-roas-meta.png`, fullPage: true });

  // ── Uploaded files: no figure, and a reason ────────────────────────────────
  await chooseSource(page, /ไฟล์ที่อัปโหลด/);

  const imported = await readRoasCard(page);
  expect(imported.value, 'uploads report no revenue, so no ratio').toBe('—');
  expect(imported.caption, 'the blank must name its cause').toMatch(
    /ไม่ได้รายงานรายได้|ยังไม่มีข้อมูล/
  );

  await page.screenshot({ path: `${SHOT_DIR}/14-dashboard-roas-import.png`, fullPage: true });
});
