/**
 * Post-deploy verification — run it right after the Vercel deploy, then again
 * after each dashboard setting is changed.
 *
 *   node scripts/postdeploy-verify.mjs https://<prod>.vercel.app
 *
 * Every check here reads a fact off the live servers. None of them trusts a
 * dashboard screenshot, and none of them can pass by accident:
 *
 *  1. the site answers, and Vercel is applying `vercel.json`'s headers
 *  2. the bundle shipped by Vercel points at the right Supabase project
 *  3. **the Redirect URLs allowlist** — the oracle is `/auth/v1/verify` with a
 *     bogus token: GoTrue 302s back to `redirect_to` when that URL is
 *     allowlisted, and to **Site URL** when it is not. So one call proves the
 *     allowlist AND reveals the Site URL currently configured — no email, no
 *     signup, no waiting. This is the check that decides whether a stranger can
 *     finish signing up, and it was invisible until now.
 *  2b. **is the served bundle actually built from HEAD?** Vercel can report a
 *     deployment "Ready" while production keeps serving an older build. On
 *     2026-09-07 it *blocked* two pushed commits over the git author email and
 *     went on serving the previous one, with no failed build shown anywhere.
 *     A dashboard status is not evidence; the shipped JavaScript is.
 *  4. `APP_BASE_URL` on the edge functions, read off the `location` header the
 *     OAuth callback sends back. `/start` cannot be probed (it checks auth
 *     first); `/callback` answers unauthenticated.
 *  5. which edge functions actually exist (a missing one answers NOT_FOUND; a
 *     deployed one that wants a JWT answers 401 — a different thing entirely).
 */
import fs from "node:fs";

const unq = (v) => v.trim().replace(/^["']|["']$/g, "");
const parseEnv = (p) =>
  Object.fromEntries(
    fs.readFileSync(p, "utf8").split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), unq(l.slice(i + 1))]; }),
  );

const fe = parseEnv(".env");
const SUPA = fe.VITE_SUPABASE_URL.replace(/\/$/, "");
const ANON = fe.VITE_SUPABASE_ANON_KEY;
const PROJECT_REF = new URL(SUPA).host.split(".")[0];

const site = (process.argv[2] || "").replace(/\/$/, "");
if (!site) {
  console.error("usage: node scripts/postdeploy-verify.mjs https://<prod>.vercel.app");
  process.exit(2);
}

let failed = 0;
const line = (verdict, label, detail) => {
  if (verdict.startsWith("FAIL")) failed++;
  console.log(`${verdict.padEnd(9)} ${label.padEnd(34)} ${detail}`);
};

/** Where GoTrue sends a browser for `redirect_to` — the allowlist oracle. */
async function verifyRedirect(target) {
  const url = `${SUPA}/auth/v1/verify?token=bogus000&type=signup&redirect_to=${encodeURIComponent(target)}`;
  const r = await fetch(url, { headers: { apikey: ANON }, redirect: "manual" });
  return (r.headers.get("location") || "").split("#")[0];
}

console.log(`site    : ${site}`);
console.log(`supabase: ${SUPA}\n`);

/** The entry bundle, fetched once in section 1 and re-read in section 2b. */
let entryPath = null;
let entryJs = null;

// ── 1. the deployed site and its headers ───────────────────────────────────
{
  const r = await fetch(`${site}/`, { redirect: "follow" });
  line(r.ok ? "OK" : "FAIL", "site responds", `HTTP ${r.status}`);
  const csp = r.headers.get("content-security-policy") || "";
  line(csp.includes(PROJECT_REF) ? "OK" : "FAIL", "CSP allows the Supabase host",
    csp ? `connect-src …${csp.includes(PROJECT_REF) ? "includes" : "MISSING"} ${PROJECT_REF}` : "no CSP header — vercel.json not applied");
  line(r.headers.get("strict-transport-security") ? "OK" : "WARN", "HSTS header", r.headers.get("strict-transport-security") || "absent");

  // 2. the bundle Vercel actually served must carry the env vars of the build
  const html = await r.text();
  entryPath = (html.match(/src="(\/assets\/index-[^"]+\.js)"/) || [])[1] || null;
  if (!entryPath) line("WARN", "entry bundle", "could not find /assets/index-*.js in the HTML");
  else {
    entryJs = await (await fetch(`${site}${entryPath}`)).text();
    const js = entryJs;
    line(js.includes(PROJECT_REF) ? "OK" : "FAIL", "bundle points at this project", `${entryPath} ${js.includes(PROJECT_REF) ? "contains" : "DOES NOT contain"} ${PROJECT_REF}`);
    line(js.includes("localhost:3001") ? "FAIL" : "OK", "no localhost backend baked in",
      js.includes("localhost:3001") ? "VITE_BACKEND_API_URL=localhost:3001 shipped to production" : "clean");
  }
}

// ── 2b. is the served bundle built from the commit we think it is? ────────
// `marker`  a literal the change being deployed INTRODUCED.
// `control` a literal from the SAME file that predates it, so it is present in
//           both the old and the new build.
//
// The control is what stops this from being a check that cannot fail
// (CLAUDE.md §12): if the marker is missing we must first know we were reading
// the right artefact at all. Marker absent + control absent = INCONCLUSIVE, and
// is reported as a failure rather than a pass. Both strings are grepped out of
// the working tree first, so a typo cannot manufacture either verdict.
//
// Update all three fields whenever you deploy a change you want proven.
const FRESHNESS = {
  source: "src/hooks/useSubscription.tsx",
  marker: "อัปเดตแพลนไม่สำเร็จ",              // ca4a5b6 — the zero-row UPDATE guard
  control: "Cannot downgrade to a lower plan", // predates it in the same file
};

/**
 * Vite normally emits non-ASCII literally, but esbuild can escape it depending
 * on `build.charset`, so look for both forms. BMP only — enough for Thai.
 */
const asciiEscaped = (s) =>
  [...s].map((c) => (c.codePointAt(0) > 0x7f
    ? "\\u" + c.codePointAt(0).toString(16).padStart(4, "0")
    : c)).join("");
const holds = (text, needle) => text.includes(needle) || text.includes(asciiEscaped(needle));

/** Entry chunk first, then every lazy chunk the entry names. Returns its path. */
async function findInBundles(needle) {
  if (holds(entryJs, needle)) return entryPath;
  const chunks = [...new Set(entryJs.match(/assets\/[A-Za-z0-9._-]+\.js/g) || [])];
  for (const c of chunks) {
    const r = await fetch(`${site}/${c}`);
    if (!r.ok) continue;
    if (holds(await r.text(), needle)) return `/${c}`;
  }
  return null;
}

if (!entryJs) {
  line("WARN", "bundle freshness", "no entry bundle to read");
} else {
  const local = fs.readFileSync(FRESHNESS.source, "utf8");
  const localHasMarker = local.includes(FRESHNESS.marker);
  const localHasControl = local.includes(FRESHNESS.control);
  if (!localHasMarker || !localHasControl) {
    line("FAIL", "freshness markers are stale",
      `${FRESHNESS.source} no longer contains ${!localHasMarker ? "the marker" : "the control"} — update FRESHNESS in this script`);
  } else {
    const controlAt = await findInBundles(FRESHNESS.control);
    const markerAt = controlAt ? await findInBundles(FRESHNESS.marker) : null;
    if (!controlAt)
      line("FAIL", "bundle freshness INCONCLUSIVE",
        "the control string is in no chunk — we read the wrong artefact, so a missing marker would prove nothing");
    else if (markerAt)
      line("OK", "deployed build carries HEAD", `marker found in ${markerAt}`);
    else
      line("FAIL", "production is serving an OLDER build",
        `control is in ${controlAt} but the marker is in no chunk — the push did not reach production`);
  }
}

// ── 3. Redirect URLs allowlist + the Site URL it falls back to ─────────────
{
  const FOREIGN = "https://definitely-not-allowlisted-xyz.example/";
  const control = await verifyRedirect(FOREIGN);
  line("INFO", "Site URL (fallback target)", control || "(no location header)");

  for (const target of [`${site}/`, `${site}/dashboard`]) {
    const got = await verifyRedirect(target);
    const allowed = got.startsWith(site);
    line(allowed ? "OK" : "FAIL", `redirect allowlisted: ${target.replace(site, "")|| "/"}`,
      allowed ? "echoed back" : `fell back to ${got} → NOT in Redirect URLs`);
  }
  // The check must be able to fail: a URL that must NOT be allowlisted. Ask
  // whether the FOREIGN url was echoed back — not whether the fallback happens
  // to sit on `site`. Once Site URL is correctly set to the deployed domain
  // (as it should be), the fallback always starts with `site`, so the old
  // comparison reported a wildcard allowlist on a correctly configured project.
  const echoedForeign = control.startsWith(FOREIGN.replace(/\/$/, ""));
  line(echoedForeign ? "FAIL" : "OK", "oracle still discriminates",
    echoedForeign ? "a URL nobody allowlisted echoes back — allowlist is a wildcard" : `a foreign URL falls back to ${control || "(nothing)"}`);
  if (!echoedForeign && control.includes("localhost"))
    line("FAIL", "Site URL is still localhost", `${control} — a confirmation mail sent to a stranger points here`);
}

// ── 4. APP_BASE_URL on the edge functions ──────────────────────────────────
{
  const r = await fetch(`${SUPA}/functions/v1/meta-oauth/callback`, { redirect: "manual" });
  const loc = r.headers.get("location") || "";
  const onSite = loc.startsWith(site);
  line(onSite ? "OK" : "FAIL", "APP_BASE_URL", loc || "(no redirect — function may be down)");
  if (!onSite && loc) console.log(`          → supabase secrets set APP_BASE_URL=${site}`);
}

// ── 5. edge functions that exist vs. are merely referenced ─────────────────
for (const fn of ["meta-oauth", "meta-sync", "secure-upload", "create-platform-ad", "campaign-auto-stop", "airflow-trigger"]) {
  const r = await fetch(`${SUPA}/functions/v1/${fn}`);
  const body = await r.text();
  const missing = body.includes("NOT_FOUND") && body.includes("Requested function was not found");
  line(missing ? "WARN" : "OK", `edge function ${fn}`, missing ? "NOT DEPLOYED" : `deployed (HTTP ${r.status})`);
}

console.log(`\n${failed === 0 ? "✅ every hard check passed" : `❌ ${failed} check(s) failed`}`);
process.exit(failed === 0 ? 0 : 1);
