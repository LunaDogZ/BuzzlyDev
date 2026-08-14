import { test, expect, type Page } from '@playwright/test';

/**
 * Proof on screen that the frequency gate is real.
 *
 * `computeReachStats` is unit-tested, but the rule it enforces is only worth
 * anything if the page obeys it against the actual database. The seeded
 * workspace happens to contain both halves of the rule, which is why this can
 * be asserted rather than argued (measured 2026-08-14):
 *
 *   meta_live  31 of 31 rows carry `reach`  -> frequency may be stated
 *   import    150 of 273 rows carry `reach` -> frequency must be withheld
 *
 * So selecting one source must show the card and selecting the other must
 * remove it, from the same page, minutes apart. A test that only checked the
 * card appears would pass just as well against a version with no gate at all.
 */

const EMAIL = process.env.E2E_EMAIL || 'e2e@buzzly.test';
const PASSWORD = process.env.E2E_PASSWORD || 'E2eWalk!2026';

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
  // Both, and `animate-pulse` is the one that matters: the dashboard's loading
  // placeholders are Skeletons, which pulse rather than spin. Waiting only on
  // spinners returned a page of grey boxes and read it as settled.
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll('.animate-spin').length === 0 &&
        document.querySelectorAll('.animate-pulse').length === 0,
      null,
      { timeout: 30000 }
    )
    .catch(() => {});
  await page.waitForTimeout(1000);
}

/** Pick a source in the dashboard's data-source dropdown by its visible label. */
async function selectSource(page: Page, label: RegExp) {
  await page.getByRole('combobox').filter({ hasText: /ข้อมูล|Meta|ไฟล์|เซิร์ฟเวอร์/ }).first().click();
  await page.getByRole('option', { name: label }).click();
  await settle(page);
}

test.describe('reach and the frequency gate', () => {
  // Serial: all three sign in as the same account, and concurrent logins to
  // the same Supabase user made `waitForURL('/dashboard')` time out — a failure
  // of the harness, not of the page.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await login(page);
    // All time — the window has to reach the 2025 Meta rows, which a default
    // 30-day view would miss entirely.
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /All time/i }).click();
    await settle(page);
  });

  test('states frequency as a lower bound when every row reported reach', async ({ page }) => {
    await selectSource(page, /Meta API/);

    await expect(page.getByText('ความถี่ต่อคน')).toBeVisible();
    // The `≥` is the claim, not decoration: summing daily reach over-counts
    // people, so the quotient can only be at or under the truth.
    await expect(page.getByText(/≥\s*[\d.]+\s*ครั้ง/)).toBeVisible();
    await expect(page.getByText('การเข้าถึง (รวมรายวัน)')).toBeVisible();
  });

  test('withholds frequency when the reach column is only partly filled', async ({ page }) => {
    await selectSource(page, /ไฟล์ที่อัปโหลด/);

    // The gate. Reach is still shown — it is a real sum — but nothing divides
    // by it, because the missing rows push the quotient up by an unknown
    // amount and no `≥` would cover that.
    await expect(page.getByText('การเข้าถึง (รวมรายวัน)')).toBeVisible();
    await expect(page.getByText('ความถี่ต่อคน')).toHaveCount(0);

    // And the partial coverage is stated rather than hidden.
    await expect(page.getByText(/จาก \d+ ใน \d+ แถว/)).toBeVisible();
  });

  test('no longer prints total spend twice on one screen', async ({ page }) => {
    await selectSource(page, /Meta API/);

    // The reach card replaced a duplicate. "Ad spend" in the ROAS panel is the
    // one that stays.
    await expect(page.getByText('Total spend')).toHaveCount(0);
    await expect(page.getByText('Ad spend')).toBeVisible();
  });
});
