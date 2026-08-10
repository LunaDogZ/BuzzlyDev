import { test, expect } from "@playwright/test";

/**
 * Visual proof for /dev/imports, run against the real cloud project as a real
 * employee — the half a component test cannot cover, because the thing being
 * checked is that the RLS policy, the hook and the page agree.
 *
 * Credentials come from the environment. `scripts/dev-employee-fixture.mjs`
 * mints a throwaway dev employee, exports them, and deletes it afterwards; this
 * spec never creates an account of its own.
 */
const EMAIL = process.env.DEV_E2E_EMAIL ?? "";
const PASSWORD = process.env.DEV_E2E_PASSWORD ?? "";

test.skip(!EMAIL || !PASSWORD, "DEV_E2E_EMAIL / DEV_E2E_PASSWORD not set");

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/employee/login");
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dev\//, { timeout: 30000 });
}

test("a dev sees where the pipeline refuses files, without the merchant's values", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await signIn(page);
  await page.goto("/dev/imports");

  await expect(page.getByRole("heading", { name: "Import pipeline" })).toBeVisible();

  // The three refusals that live in the cloud project today, one per code.
  await expect(page.getByText("ads-report.csv")).toBeVisible();
  await expect(page.getByText("headers-only.csv")).toBeVisible();
  await expect(page.getByText("broken-rows.csv")).toBeVisible();

  // Each says which stage stopped it — the question this page exists to answer.
  await expect(page.getByText(/Stopped at hash_dedupe/)).toBeVisible();
  await expect(page.getByText(/Stopped at validate/)).toBeVisible();

  // The gate: nothing is revealed on arrival.
  const revealButtons = page.getByRole("button", { name: /reveal detail/i });
  await expect(revealButtons).toHaveCount(3);
  await expect(page.getByText(/^Detail$/)).toHaveCount(0);

  await page.screenshot({ path: "e2e/screenshots/dev-imports-gated.png", fullPage: true });

  // Reveal exactly one, and only that one opens.
  await revealButtons.first().click();
  await expect(page.getByText(/^Detail$/)).toHaveCount(1);
  await expect(page.getByRole("button", { name: /reveal detail/i })).toHaveCount(2);

  await page.screenshot({ path: "e2e/screenshots/dev-imports-revealed.png", fullPage: true });

  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toHaveLength(0);
});

test("the sidebar offers the page and the route survives a reload", async ({ page }) => {
  await signIn(page);

  await page.getByRole("link", { name: "Import Pipeline" }).click();
  await expect(page).toHaveURL(/\/dev\/imports/);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Import pipeline" })).toBeVisible();
});
