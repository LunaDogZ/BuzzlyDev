/**
 * KPI-4 — Lighthouse Performance, measured per the pre-registered protocol in
 * `docs/KPI_SPEC.md` § "KPI-4 — Lighthouse Performance" (spec commit da02849).
 *
 *   LIGHTHOUSE_DIR=/path/to/lighthouse-install \
 *   node scripts/kpi4-lighthouse.mjs --site https://buzzly-dev.vercel.app
 *
 * Protocol implemented here, not re-decided here:
 *   · three locked routes — R1 `/` (no auth), R2 `/dashboard`, R3 `/imports`
 *   · both presets, 6 runs each, run 1 discarded, median of runs 2–6
 *   · full JSON kept for every run, the discarded one included
 *   · desktop gates the verdict; mobile is informational (see the spec)
 *
 * THE TRAP THE SPEC NAMES, and the two ways it actually bites.
 *
 * Supabase keeps its session in `localStorage`, so a Lighthouse tab that does
 * not share the logged-in profile scores some *other* page — a small, fast one
 * that scores well. The measurement then looks like a pass and means nothing.
 *
 *  1. `browser.newPage()` in Playwright opens an **incognito** BrowserContext,
 *     while Lighthouse creates its tab in the browser's **default** context.
 *     Different storage partitions: the login simply is not there. Measured,
 *     not guessed — the first smoke run reported `/dashboard` while every run
 *     actually finished on `/`. The session therefore has to travel through a
 *     persistent profile on disk, and the two tools must never drive the same
 *     browser at once: Playwright auto-attaches to the tabs Lighthouse creates
 *     and destroys, which crashed the second run with
 *     `Protocol error (Page.enable): Session closed`. So this runs in two
 *     phases — Playwright logs in and exits, then Chrome is relaunched on the
 *     same `--user-data-dir` for Lighthouse alone.
 *  2. The guard must compare the URL Lighthouse finished on against the route
 *     it was asked for. An earlier version only rejected `/auth`, and the app
 *     does not send an unauthenticated visitor to `/auth` — it sends them to
 *     `/`. A guard that names one wrong destination passes every other wrong
 *     destination. Now anything but the requested path aborts the run.
 *
 * Lighthouse is deliberately NOT a devDependency of this repo: KPI-7 criterion
 * 4 counts `npm audit` findings over this project's dependency tree, and adding
 * a measurement tool to that tree would change a number another KPI reports.
 * Install it anywhere and point LIGHTHOUSE_DIR at the directory holding its
 * `node_modules`. The exact version is recorded in meta.json.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const SITE = (arg("site", "") || "").replace(/\/$/, "");
const RUNS = Number(arg("runs", 6));
const PRESETS = (arg("presets", "desktop,mobile")).split(",");
const ONLY = arg("route", "");            // R1 | R2 | R3 — for a smoke check
const LABEL = arg("label", "");           // e.g. "smoke" → writes outside evidence/
const EMAIL = process.env.E2E_EMAIL || "e2e@buzzly.test";
const PASSWORD = process.env.E2E_PASSWORD || "E2eWalk!2026";
const LH_DIR = process.env.LIGHTHOUSE_DIR;
const PORT = Number(arg("port", 9222));

if (!SITE || !LH_DIR) {
  console.error("usage: LIGHTHOUSE_DIR=<dir> node scripts/kpi4-lighthouse.mjs --site https://<host>");
  process.exit(2);
}

const require_ = createRequire(path.join(LH_DIR, "package.json"));
const { launch: launchChrome } = require_("chrome-launcher");
const lighthouse = (await import(path.join(LH_DIR, "node_modules/lighthouse/core/index.js"))).default;
const desktopConfig = (await import(path.join(LH_DIR, "node_modules/lighthouse/core/config/desktop-config.js"))).default;
const LH_VERSION = require_("lighthouse/package.json").version;

/** The three routes are locked by the spec. Do not add, drop or reorder them. */
const ROUTES = [
  { id: "R1", slug: "R1-landing",   route: "/",          auth: false },
  { id: "R2", slug: "R2-dashboard", route: "/dashboard", auth: true },
  { id: "R3", slug: "R3-imports",   route: "/imports",   auth: true },
].filter((r) => !ONLY || r.id === ONLY);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ── environment pin, per the spec's "Pin into every report header" ─────────
const commit = execSync("git rev-parse HEAD").toString().trim();
const deploymentId = await fetch(`${SITE}/`).then((r) => r.headers.get("x-vercel-id") || "(no x-vercel-id header)");
const outRoot = LABEL
  ? path.join("/tmp", `kpi4-${LABEL}`)
  : path.join("evidence", "kpi4-lighthouse", commit.slice(0, 7));

console.log(`site        : ${SITE}`);
console.log(`commit      : ${commit}`);
console.log(`deployment  : ${deploymentId}`);
console.log(`lighthouse  : ${LH_VERSION}`);
console.log(`output      : ${outRoot}${LABEL ? "   ← LABELLED RUN, NOT EVIDENCE" : ""}\n`);

// ── the profile a route is measured in ────────────────────────────────────
// R1 is specified as "no session" and R2/R3 as authenticated, so they cannot
// share one profile: a logged-in browser is redirected off `/` to `/dashboard`,
// and an anonymous one is redirected off `/dashboard`. Each group's landed-URL
// guard therefore proves the OTHER group's precondition — if the anonymous
// profile were somehow logged in, R1 would abort, and vice versa.
//
// Playwright writes the session and exits before Lighthouse ever starts: the
// two must not drive one browser (Playwright auto-attaches to the tabs
// Lighthouse opens and closes, which crashed the second run with
// `Protocol error (Page.enable): Session closed`).
async function signIn(userDataDir) {
  const context = await chromium.launchPersistentContext(userDataDir, { headless: true });
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(`${SITE}/auth`, { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in to buzzly/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30000 });
  // supabase-js persists the refreshed session asynchronously; closing before
  // that write leaves a profile that looks logged in and is not.
  await page.waitForTimeout(3000);
  const stored = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.includes("auth-token")));
  if (stored.length === 0) {
    console.error("❌ logged in but no supabase auth token in localStorage — the profile would carry no session");
    process.exit(1);
  }
  console.log(`  signed in as ${EMAIL} → ${page.url()}  (localStorage: ${stored.join(", ")})`);
  await context.close();
}

let chromeVersion = "(unknown)";
const results = [];
let aborted = null;
let retries = 0;

// A crash before `chrome.kill()` leaves ~18 Chrome processes and a profile
// behind, and they accumulate across attempts. Measured after the first crash:
// 18 orphans still holding the old profile open. Never leave them for the next
// run to trip over.
let activePid = null;
const killChrome = (c) => { try { c?.kill(); } catch {} };
const reap = () => { if (activePid) { try { process.kill(activePid, "SIGKILL"); } catch {} activePid = null; } };
process.on("uncaughtException", (e) => { reap(); console.error(e); process.exit(1); });
process.on("SIGINT", () => { reap(); process.exit(130); });

/** R1 (anonymous) and R2/R3 (authenticated) get one profile each. */
const GROUPS = [false, true]
  .map((auth) => ({ auth, routes: ROUTES.filter((r) => r.auth === auth) }))
  .filter((g) => g.routes.length);

for (const group of GROUPS) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kpi4-profile-"));
  console.log(`profile: ${group.auth ? "authenticated" : "anonymous"} (${group.routes.map((r) => r.id).join(", ")})`);
  if (group.auth) await signIn(userDataDir);
  const launch = () => launchChrome({
    chromePath: chromium.executablePath(),
    userDataDir,
    port: PORT,
    chromeFlags: ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu"],
  });
  let chrome = await launch();
  activePid = chrome.pid;
  if (chromeVersion === "(unknown)")
    chromeVersion = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      .then((r) => r.json()).then((j) => j.Browser).catch(() => "(unknown)");

  for (const preset of PRESETS) {
  for (const r of group.routes) {
    const dir = path.join(outRoot, preset, r.slug);
    fs.mkdirSync(dir, { recursive: true });
    const scored = [];

    for (let n = 1; n <= RUNS; n++) {
      const flags = {
        port: PORT,
        output: "json",
        disableStorageReset: true,   // ← keeps the Supabase session in localStorage
        logLevel: "error",
      };
      // Chrome's renderer occasionally dies mid-run on the heavier routes
      // (`Protocol error (Page.enable): Session closed`). The cause is not
      // established — it survived removing Playwright from the picture and it
      // is not memory exhaustion — so this retries on a fresh browser rather
      // than pretending to have diagnosed it. **Every retry is counted and
      // written into the run row and meta.json**: a measurement that quietly
      // re-rolls the runs it does not like is not a measurement.
      let runner = null, attempts = 0, lastError = null;
      while (attempts < 3 && !runner) {
        attempts++;
        try {
          runner = await lighthouse(
            `${SITE}${r.route}`,
            flags,
            preset === "desktop" ? desktopConfig : undefined,
          );
        } catch (e) {
          lastError = e;
          if (attempts >= 3) break;
          console.log(`    ⟳ ${preset} ${r.id} run ${n} attempt ${attempts} died (${e.protocolMethod || e.code || e.message}) — relaunching Chrome`);
          retries++;
          killChrome(chrome);
          chrome = await launch();
          activePid = chrome.pid;
        }
      }
      if (!runner) {
        aborted = `${preset}/${r.id} run ${n} failed 3 times — last error: ${lastError?.message || lastError}`;
        break;
      }
      const lhr = runner.lhr;

      // The trap guard: did Lighthouse finish on the page we asked for? Any
      // other destination means it scored a different page under this route's
      // name, whatever that destination happens to be.
      const landed = lhr.finalDisplayedUrl || lhr.finalUrl || "";
      const landedPath = (() => { try { return new URL(landed).pathname.replace(/\/$/, "") || "/"; } catch { return landed; } })();
      const wantPath = r.route.replace(/\/$/, "") || "/";
      if (landedPath !== wantPath) {
        aborted = `${preset}/${r.id} run ${n} asked for ${r.route} but finished on ${landed}`
          + (r.auth ? " — the session did not reach the Lighthouse tab, so this run scored a different page" : "");
        break;
      }

      fs.writeFileSync(path.join(dir, `run-${n}.json`), JSON.stringify(lhr, null, 2));
      const perf = Math.round(lhr.categories.performance.score * 100);
      const row = {
        run: n,
        attempts,
        discarded: n === 1,
        landed,
        performance: perf,
        accessibility: Math.round(lhr.categories.accessibility.score * 100),
        bestPractices: Math.round(lhr.categories["best-practices"].score * 100),
        seo: Math.round(lhr.categories.seo.score * 100),
        fcp: lhr.audits["first-contentful-paint"].numericValue,
        lcp: lhr.audits["largest-contentful-paint"].numericValue,
        tbt: lhr.audits["total-blocking-time"].numericValue,
        cls: lhr.audits["cumulative-layout-shift"].numericValue,
        si: lhr.audits["speed-index"].numericValue,
      };
      if (n > 1) scored.push(row);
      console.log(`  ${preset.padEnd(7)} ${r.id} run ${n}${n === 1 ? " (discarded)" : "           "} perf ${String(perf).padStart(3)}  ${landed}`);
    }
    if (aborted) break;

    const perfs = scored.map((s) => s.performance);
    results.push({
      preset, route: r.id, path: r.route,
      medianPerformance: median(perfs),
      min: Math.min(...perfs), max: Math.max(...perfs),
      medianAccessibility: median(scored.map((s) => s.accessibility)),
      medianBestPractices: median(scored.map((s) => s.bestPractices)),
      medianSeo: median(scored.map((s) => s.seo)),
      medianFcp: median(scored.map((s) => s.fcp)),
      medianLcp: median(scored.map((s) => s.lcp)),
      medianTbt: median(scored.map((s) => s.tbt)),
      medianCls: median(scored.map((s) => s.cls)),
      medianSi: median(scored.map((s) => s.si)),
      runs: scored,
    });
    fs.writeFileSync(path.join(dir, "runs.json"), JSON.stringify(results.at(-1), null, 2));
  }
  if (aborted) break;
  }

  killChrome(chrome);
  activePid = null;
  fs.rmSync(userDataDir, { recursive: true, force: true });
  if (aborted) break;
}

if (aborted) {
  console.error(`\n❌ ABORTED — ${aborted}`);
  console.error("Nothing was written for that route. Fix the session, then re-run; a partial");
  console.error("measurement is not a measurement.");
  process.exit(1);
}

// ── meta.json — the environment pin the spec requires ─────────────────────
fs.mkdirSync(outRoot, { recursive: true });
fs.writeFileSync(path.join(outRoot, "meta.json"), JSON.stringify({
  kpi: "KPI-4",
  commit,
  spec_commit: "da02849",
  deployment_id: deploymentId,
  site: SITE,
  lighthouse_version: LH_VERSION,
  chrome_version: chromeVersion,
  driver: "playwright chromium (spec says Puppeteer; same mechanism — CDP on --remote-debugging-port, disableStorageReset:true). Recorded as a tool substitution, not a protocol change.",
  os: `${os.type()} ${os.release()}`,
  cpu: os.cpus()[0]?.model,
  cores: os.cpus().length,
  memory_gb: +(os.totalmem() / 1024 ** 3).toFixed(1),
  runs_per_route: RUNS,
  chrome_relaunches_after_a_crashed_run: retries,
  discarded: "run 1 of each route/preset",
  account: EMAIL,
  measured_at_ict: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Bangkok" }),
  label: LABEL || null,
}, null, 2));
fs.writeFileSync(path.join(outRoot, "summary.json"), JSON.stringify(results, null, 2));

// ── report ────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(78));
for (const preset of PRESETS) {
  const rows = results.filter((r) => r.preset === preset);
  if (!rows.length) continue;
  console.log(`\n${preset.toUpperCase()}${preset === "mobile" ? "  (informational — not gated)" : "  (gates the verdict)"}`);
  console.log("route  path        median  min  max   FCP     LCP     TBT     CLS    SI");
  for (const r of rows)
    console.log(`${r.route}     ${r.path.padEnd(11)} ${String(r.medianPerformance).padStart(6)} ${String(r.min).padStart(4)} ${String(r.max).padStart(4)}   ${Math.round(r.medianFcp).toString().padStart(5)}ms ${Math.round(r.medianLcp).toString().padStart(5)}ms ${Math.round(r.medianTbt).toString().padStart(5)}ms ${r.medianCls.toFixed(3)} ${Math.round(r.medianSi).toString().padStart(5)}ms`);
}

const desktop = results.filter((r) => r.preset === "desktop");
if (desktop.length === ROUTES.length && !ONLY) {
  const failing = desktop.filter((r) => r.medianPerformance < 80);
  console.log("\n" + "─".repeat(78));
  console.log(failing.length === 0
    ? "✅ KPI-4 PASS — every desktop route ≥ 80"
    : `❌ KPI-4 FAIL — ${failing.map((f) => `${f.route} ${f.medianPerformance}`).join(", ")} below 80 (one failing route fails the KPI)`);
  process.exit(failing.length === 0 ? 0 : 1);
}
