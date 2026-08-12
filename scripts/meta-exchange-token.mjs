// Exchange the short-lived Meta user token for a long-lived one (~60 days).
//
// A token straight out of Graph Explorer lives 1–2 hours. This trades it for a
// 60-day one before it dies. Run it while the current token is still valid —
// an expired token cannot be exchanged, only re-issued by hand.
//
// Run:  node scripts/meta-exchange-token.mjs
//
// WRITES: replaces META_ACCESS_TOKEN in mock-api/.env in place, after saving
// mock-api/.env.bak. The new token is never printed — only its expiry is.
//
// 60 days is a reprieve, not a fix. A System User token from Business Manager
// does not expire at all, and that is what a long-running research setup wants.

import { readFileSync, writeFileSync, copyFileSync } from "fs";
import { fileURLToPath } from "url";

const envPath = fileURLToPath(new URL("../mock-api/.env", import.meta.url));
const raw = readFileSync(envPath, "utf-8");

const env = {};
for (const line of raw.split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i === -1) continue;
  let v = t.slice(i + 1).trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
  env[t.slice(0, i).trim()] = v;
}

const { META_ACCESS_TOKEN: TOKEN, META_APP_ID: APP_ID, META_APP_SECRET: APP_SECRET } = env;
const VERSION = env.META_API_VERSION || "v23.0";

const missing = [
  !TOKEN && "META_ACCESS_TOKEN",
  !APP_ID && "META_APP_ID",
  !APP_SECRET && "META_APP_SECRET",
].filter(Boolean);

if (missing.length) {
  console.error(`Missing in mock-api/.env: ${missing.join(", ")}`);
  if (!APP_SECRET) {
    console.error("\nApp Secret: developers.facebook.com → your app → Settings → Basic → App Secret (Show)");
  }
  process.exit(1);
}

const redact = (s) => String(s).split(TOKEN).join("<TOKEN>").split(APP_SECRET).join("<APP_SECRET>");

// ── exchange ─────────────────────────────────────────────────────────────────
const url = new URL(`https://graph.facebook.com/${VERSION}/oauth/access_token`);
url.searchParams.set("grant_type", "fb_exchange_token");
url.searchParams.set("client_id", APP_ID);
url.searchParams.set("client_secret", APP_SECRET);
url.searchParams.set("fb_exchange_token", TOKEN);

const res = await fetch(url);
const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  console.error(`Unexpected response (${res.status}): ${redact(text.slice(0, 300))}`);
  process.exit(1);
}

if (body.error) {
  console.error(`Exchange failed: ${redact(body.error.message)}`);
  if (body.error.code) console.error(`  code ${body.error.code}${body.error.error_subcode ? `/${body.error.error_subcode}` : ""}`);
  console.error("\nIf the short-lived token already expired, mint a new one in Graph Explorer and retry.");
  process.exit(1);
}

const newToken = body.access_token;
if (!newToken) {
  console.error(`No access_token in response: ${redact(text.slice(0, 300))}`);
  process.exit(1);
}

// ── verify before writing ────────────────────────────────────────────────────
// Confirm the thing we are about to save actually works, so a bad exchange
// cannot quietly replace a working token with a broken one.
const dbgUrl = new URL(`https://graph.facebook.com/${VERSION}/debug_token`);
dbgUrl.searchParams.set("input_token", newToken);
dbgUrl.searchParams.set("access_token", `${APP_ID}|${APP_SECRET}`);
const dbg = await (await fetch(dbgUrl)).json();
const d = dbg?.data ?? {};

if (!d.is_valid) {
  console.error("The new token did not validate — leaving mock-api/.env untouched.");
  process.exit(1);
}

const expires = d.expires_at
  ? new Date(d.expires_at * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC"
  : "never (does not expire)";
const daysLeft = d.expires_at ? Math.round((d.expires_at * 1000 - Date.now()) / 86_400_000) : null;

// ── write ────────────────────────────────────────────────────────────────────
copyFileSync(envPath, envPath + ".bak");

let replaced = false;
const out = raw
  .split(/\r?\n/)
  .map((line) => {
    if (/^\s*META_ACCESS_TOKEN\s*=/.test(line)) {
      replaced = true;
      return `META_ACCESS_TOKEN=${newToken}`;
    }
    return line;
  })
  .join("\n");

writeFileSync(envPath, replaced ? out : `${raw.replace(/\s*$/, "")}\nMETA_ACCESS_TOKEN=${newToken}\n`);

console.log("Exchanged and saved.\n");
console.log(`  scopes  : ${(d.scopes ?? []).join(", ")}`);
console.log(`  expires : ${expires}${daysLeft !== null ? `  (${daysLeft} days)` : ""}`);
console.log(`  written : mock-api/.env   (previous saved as mock-api/.env.bak)`);
console.log("\nVerify with:  node scripts/meta-probe.mjs");
