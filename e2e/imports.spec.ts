import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Proves the file-import upload path end-to-end: sign in, pick a report type,
// upload a real merchant fixture, and see the job row appear.
// Uses the same dedicated e2e account as visual-walk.spec.ts.
const EMAIL = process.env.E2E_EMAIL || 'e2e@buzzly.test';
const PASSWORD = process.env.E2E_PASSWORD || 'E2eWalk!2026';
const FIXTURE = path.resolve('fixtures/imports/meta/ads-export-clean.csv');

async function login(page: Page) {
  await page.goto('/auth');
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in to buzzly/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 20000 });
  await page.waitForTimeout(2000);
}

test('merchant can upload a report file and see the import job', async ({ page }) => {
  test.setTimeout(120_000);

  await login(page);
  // Navigate the way a merchant would — this also proves the sidebar entry is wired.
  await page.getByRole('link', { name: 'Imports' }).click();
  await page.waitForURL(/\/imports/, { timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'IMPORTS', exact: true })).toBeVisible({
    timeout: 30000,
  });

  // Upload is blocked until a report type is chosen.
  const startButton = page.getByRole('button', { name: /start import/i });
  await expect(startButton).toBeDisabled();

  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Meta Ads' }).click();

  // Unique filename per run, so this can never pass on a row left by an
  // earlier run — the assertion below only matches THIS upload.
  const filename = `ads-export-clean-${Date.now()}.csv`;
  await page.setInputFiles('input[type="file"]', {
    name: filename,
    mimeType: 'text/csv',
    buffer: fs.readFileSync(FIXTURE),
  });
  await expect(page.getByText(filename).first()).toBeVisible();

  await expect(startButton).toBeEnabled();
  await startButton.click();

  // Job row lands in the history list, waiting for Airflow to pick it up.
  // The selected-file chip is cleared on submit, so this match is the list row.
  // exact, so the success toast ("… is queued for processing") doesn't match too.
  await expect(page.getByText(filename, { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('No imports yet')).toHaveCount(0);
  await expect(page.getByText(/Meta Ads ·/).first()).toBeVisible();
  await expect(page.getByText(/Waiting|Queued|Processing/).first()).toBeVisible();

  fs.mkdirSync('e2e/screenshots', { recursive: true });
  await page.screenshot({ path: 'e2e/screenshots/07-imports.png', fullPage: true });
});

test('an unsupported file type is rejected before upload', async ({ page }) => {
  await login(page);
  await page.goto('/imports');

  await page.setInputFiles('input[type="file"]', {
    name: 'not-a-report.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  });

  await expect(page.getByText(/Unsupported file type/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /start import/i })).toBeDisabled();
});
