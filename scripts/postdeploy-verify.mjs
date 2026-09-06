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
  const entry = (html.match(/src="(\/assets\/index-[^"]+\.js)"/) || [])[1];
  if (!entry) line("WARN", "entry bundle", "could not find /assets/index-*.js in the HTML");
  else {
    const js = await (await fetch(`${site}${entry}`)).text();
    line(js.includes(PROJECT_REF) ? "OK" : "FAIL", "bundle points at this project", `${entry} ${js.includes(PROJECT_REF) ? "contains" : "DOES NOT contain"} ${PROJECT_REF}`);
    line(js.includes("localhost:3001") ? "FAIL" : "OK", "no localhost backend baked in",
      js.includes("localhost:3001") ? "VITE_BACKEND_API_URL=localhost:3001 shipped to production" : "clean");
  }
}

// ── 3. Redirect URLs allowlist + the Site URL it falls back to ─────────────
{
  const control = await verifyRedirect("https://definitely-not-allowlisted-xyz.example/");
  line("INFO", "Site URL (fallback target)", control || "(no location header)");

  for (const target of [`${site}/`, `${site}/dashboard`]) {
    const got = await verifyRedirect(target);
    const allowed = got.startsWith(site);
    line(allowed ? "OK" : "FAIL", `redirect allowlisted: ${target.replace(site, "")|| "/"}`,
      allowed ? "echoed back" : `fell back to ${got} → NOT in Redirect URLs`);
  }
  // the check must be able to fail: a URL that must NOT be allowlisted
  line(control.startsWith(site) ? "FAIL" : "OK", "oracle still discriminates",
    control.startsWith(site) ? "everything echoes back — allowlist is a wildcard?" : "a foreign URL does not echo back");
  if (!control.startsWith(site) && control.includes("localhost"))
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
