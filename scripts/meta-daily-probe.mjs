// Probe the DAILY shape of Meta insights, so a field mapping can be decided
// from real data instead of from the docs.
//
// Read-only — every call is a GET. Nothing is written to Meta or to Supabase.
//
// Run:  node scripts/meta-daily-probe.mjs
//       node scripts/meta-daily-probe.mjs --since 2025-08-01 --until 2026-08-11
//
// The primary call is exactly:
//   /{account}/insights?fields=spend,impressions,clicks&time_increment=1&date_preset=last_30d
//
// With --since/--until the same call is made with time_range={"since":…,"until":…}
// instead of date_preset. Meta only returns days that had delivery, so the row
// count is the count of active days, not the length of the window.
//
// Token handling matches scripts/meta-probe.mjs: read from mock-api/.env
// (gitignored), never printed, redacted out of every line including error
// bodies and the paging URLs Meta hands back (those carry the token inline).

import { readFileSync } from "fs";
import { fileURLToPath } from "url";

// ── env ──────────────────────────────────────────────────────────────────────
const envPath = fileURLToPath(new URL("../mock-api/.env", import.meta.url));
const env = {};
try {
  for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    env[t.slice(0, i).trim()] = v;
  }
} catch (e) {
  console.error(`Cannot read ${envPath}\n${e.message}`);
  process.exit(1);
}

const TOKEN = env.META_ACCESS_TOKEN;
const APP_SECRET = env.META_APP_SECRET;
const VERSION = env.META_API_VERSION || "v23.0";
const AD_ACCOUNT = env.META_AD_ACCOUNT_ID;

if (!TOKEN) {
  console.error("META_ACCESS_TOKEN is not set in mock-api/.env");
  process.exit(1);
}
if (!AD_ACCOUNT) {
  console.error("META_AD_ACCOUNT_ID is not set in mock-api/.env");
  process.exit(1);
}

// ── window ───────────────────────────────────────────────────────────────────
// Default stays the call the mapping was decided on; --since/--until widen it.
const argOf = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const SINCE = argOf("since");
const UNTIL = argOf("until");
if ((SINCE && !UNTIL) || (!SINCE && UNTIL)) {
  console.error("--since and --until must be given together (YYYY-MM-DD)");
  process.exit(1);
}
for (const [n, v] of [["since", SINCE], ["until", UNTIL]]) {
  if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    console.error(`--${n} must be YYYY-MM-DD, got "${v}"`);
    process.exit(1);
  }
}
const WINDOW = SINCE
  ? { time_range: JSON.stringify({ since: SINCE, until: UNTIL }) }
  : { date_preset: "last_30d" };
const WINDOW_LABEL = SINCE ? `time_range ${SINCE} → ${UNTIL}` : "date_preset=last_30d";

const BASE = `https://graph.facebook.com/${VERSION}`;
const redact = (s) => {
  let out = String(s).split(TOKEN).join("<TOKEN>");
  if (APP_SECRET) out = out.split(APP_SECRET).join("<APP_SECRET>");
  return out;
};

// ── http ─────────────────────────────────────────────────────────────────────
async function getUrl(url) {
  const res = await fetch(url);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, error: { message: redact(text.slice(0, 300)) } };
  }
  if (!res.ok || body.error) {
    const e = body.error ?? {};
    return {
      ok: false,
      error: {
        message: redact(e.message ?? text.slice(0, 300)),
        code: e.code,
        subcode: e.error_subcode,
      },
    };
  }
  return { ok: true, body };
}

function buildUrl(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", TOKEN);
  return url;
}

const get = (path, params) => getUrl(buildUrl(path, params));

const line = (t) => console.log(`\n${"─".repeat(72)}\n${t}\n${"─".repeat(72)}`);
const fail = (label, r) =>
  console.log(`  ✗ ${label}: ${r.error.message}${r.error.code ? `  [code ${r.error.code}${r.error.subcode ? `/${r.error.subcode}` : ""}]` : ""}`);

// ── 1. the account object itself ─────────────────────────────────────────────
// Asked directly rather than read off /me/adaccounts, so currency and timezone
// come from the account we will actually ingest.
line(`1. ACCOUNT  (${AD_ACCOUNT})`);
const STATUS = { 1: "ACTIVE", 2: "DISABLED", 3: "UNSETTLED", 7: "PENDING_REVIEW", 9: "IN_GRACE_PERIOD", 101: "CLOSED" };

const acct = await get(`/${AD_ACCOUNT}`, {
  fields: [
    "id",
    "account_id",
    "name",
    "account_status",
    "currency",
    "timezone_name",
    "timezone_offset_hours_utc",
    "business_country_code",
    "amount_spent",
    "spend_cap",
  ].join(","),
});
if (!acct.ok) {
  fail("account", acct);
} else {
  const a = acct.body;
  console.log(`  name            : ${a.name ?? "?"}`);
  console.log(`  account_id      : ${a.account_id ?? "?"}   (id ${a.id})`);
  console.log(`  account_status  : ${STATUS[a.account_status] ?? a.account_status}`);
  console.log(`  currency        : ${a.currency}`);
  console.log(`  timezone_name   : ${a.timezone_name}   (UTC${a.timezone_offset_hours_utc >= 0 ? "+" : ""}${a.timezone_offset_hours_utc})`);
  console.log(`  country         : ${a.business_country_code ?? "—"}`);
  console.log(`  amount_spent    : ${a.amount_spent}   (minor units, i.e. ${a.currency} ${(Number(a.amount_spent) / 100).toFixed(2)})`);
  console.log(`  spend_cap       : ${a.spend_cap ?? "—"}`);
  console.log("\n  RAW:");
  console.log(indent(JSON.stringify(a, null, 2), 4));
}

function indent(s, n) {
  const pad = " ".repeat(n);
  return s.split("\n").map((l) => pad + l).join("\n");
}

// ── 2. the daily call the mapping will be built on ───────────────────────────
line(`2. DAILY INSIGHTS  (fields=spend,impressions,clicks · time_increment=1 · ${WINDOW_LABEL})`);

const rows = [];
let pages = 0;
let next = buildUrl(`/${AD_ACCOUNT}/insights`, {
  fields: "spend,impressions,clicks",
  time_increment: "1",
  ...WINDOW,
  limit: "100",
});

while (next && pages < 40) {
  const r = await getUrl(next);
  pages += 1;
  if (!r.ok) {
    fail("insights", r);
    break;
  }
  rows.push(...(r.body.data ?? []));
  next = r.body.paging?.next ?? null; // carries the token inline — never printed
}

console.log(`  rows returned   : ${rows.length}  (over ${pages} page${pages === 1 ? "" : "s"})`);

if (rows.length) {
  const dates = rows.map((r) => r.date_start).sort();
  const spent = rows.filter((r) => Number(r.spend) > 0);
  const zero = rows.length - spent.length;

  console.log(`  date range      : ${dates[0]} → ${dates[dates.length - 1]}`);
  console.log(`  days with spend : ${spent.length} of ${rows.length}  (${zero} row(s) at 0)`);
  if (spent.length) {
    const sDates = spent.map((r) => r.date_start).sort();
    console.log(`  spend confined to: ${sDates[0]} → ${sDates[sDates.length - 1]}`);
    const total = spent.reduce((n, r) => n + Number(r.spend), 0);
    const impr = spent.reduce((n, r) => n + Number(r.impressions ?? 0), 0);
    const clicks = spent.reduce((n, r) => n + Number(r.clicks ?? 0), 0);
    console.log(`  totals (spend>0): spend=${total.toFixed(2)}  impressions=${impr}  clicks=${clicks}`);
  }

  // Per-month roll-up first: over a year-wide window the day list is too long
  // to read, and "which months have anything at all" is the question that
  // decides how many rows a KPI can be measured on.
  const byMonth = new Map();
  for (const r of rows) {
    const m = r.date_start.slice(0, 7);
    const acc = byMonth.get(m) ?? { days: 0, spend: 0, impressions: 0, clicks: 0 };
    acc.days += 1;
    acc.spend += Number(r.spend);
    acc.impressions += Number(r.impressions ?? 0);
    acc.clicks += Number(r.clicks ?? 0);
    byMonth.set(m, acc);
  }
  console.log("\n  BY MONTH:");
  console.log("    month     days      spend  impressions  clicks");
  for (const [m, a] of [...byMonth.entries()].sort()) {
    console.log(
      `    ${m}  ${String(a.days).padStart(5)}  ${a.spend.toFixed(2).padStart(9)}  ${String(a.impressions).padStart(11)}  ${String(a.clicks).padStart(6)}`,
    );
  }

  console.log("\n  EVERY DAY RETURNED:");
  for (const r of rows) {
    console.log(`    ${r.date_start}  spend=${String(r.spend).padStart(9)}  impressions=${String(r.impressions ?? "").padStart(7)}  clicks=${String(r.clicks ?? "").padStart(5)}`);
  }

  console.log("\n  RAW — first 2 rows exactly as Meta returned them:");
  console.log(indent(JSON.stringify(rows.slice(0, 2), null, 2), 4));

  const withSpend = spent.slice(0, 1);
  if (withSpend.length && withSpend[0].date_start !== rows[0].date_start) {
    console.log("\n  RAW — first row that actually has spend:");
    console.log(indent(JSON.stringify(withSpend, null, 2), 4));
  }

  console.log("\n  KEYS PRESENT ON A ROW: " + Object.keys(rows[0]).join(", "));
} else {
  console.log("  (no rows — the call itself succeeded, there was just no delivery)");
}

// ── 3. what else a daily row can carry ───────────────────────────────────────
// Not part of the question asked, but the mapping needs to know which columns
// can be filled from one call and which cannot. Same daily grain, wider fields,
// narrowed to the days that had delivery so the output stays short.
line("3. EXTRA — the same daily grain with a wider field list (for mapping only)");

const wide = await get(`/${AD_ACCOUNT}/insights`, {
  fields: [
    "date_start",
    "date_stop",
    "account_currency",
    "account_id",
    "campaign_id",
    "campaign_name",
    "spend",
    "impressions",
    "clicks",
    "reach",
    "frequency",
    "ctr",
    "cpc",
    "cpm",
    "actions",
    "action_values",
  ].join(","),
  time_increment: "1",
  ...WINDOW,
  level: "campaign",
  limit: "5",
});
if (!wide.ok) {
  fail("wide insights", wide);
} else {
  const w = (wide.body.data ?? []).filter((r) => Number(r.spend) > 0).slice(0, 2);
  const show = w.length ? w : (wide.body.data ?? []).slice(0, 1);
  console.log(`  rows: ${(wide.body.data ?? []).length} (showing ${show.length}, campaign level)`);
  console.log(indent(JSON.stringify(show, null, 2), 4));
}

// ── 4. how many rows the chosen grain actually yields ────────────────────────
// The mapping was approved at ad-level daily (`ads_id` is in the ad_insights
// idempotency key). Account-level day count is NOT that number: one day with
// three ads delivering is three rows. This counts the real thing.
line(`4. ROW COUNT AT THE INGEST GRAIN  (level=ad · time_increment=1 · ${WINDOW_LABEL})`);

const adRows = [];
let adPages = 0;
let adNext = buildUrl(`/${AD_ACCOUNT}/insights`, {
  fields: "ad_id,ad_name,campaign_id,adset_id,spend,impressions,clicks",
  time_increment: "1",
  ...WINDOW,
  level: "ad",
  limit: "200",
});
while (adNext && adPages < 40) {
  const r = await getUrl(adNext);
  adPages += 1;
  if (!r.ok) {
    fail("ad-level insights", r);
    break;
  }
  adRows.push(...(r.body.data ?? []));
  adNext = r.body.paging?.next ?? null;
}

if (adRows.length) {
  const days = new Set(adRows.map((r) => r.date_start));
  const ads = new Set(adRows.map((r) => r.ad_id));
  const adsets = new Set(adRows.map((r) => r.adset_id));
  const camps = new Set(adRows.map((r) => r.campaign_id));
  const total = adRows.reduce((n, r) => n + Number(r.spend), 0);
  console.log(`  ad_insights rows this would write : ${adRows.length}`);
  console.log(`  distinct days                     : ${days.size}`);
  console.log(`  distinct ads (→ rows in ads)      : ${ads.size}`);
  console.log(`  distinct ad sets                  : ${adsets.size}`);
  console.log(`  distinct campaigns (→ campaigns)  : ${camps.size}`);
  console.log(`  total spend at this grain         : ${total.toFixed(2)}`);
  console.log("\n  RAW — 1 row at the ingest grain:");
  console.log(indent(JSON.stringify(adRows[0], null, 2), 4));
} else {
  console.log("  (no rows)");
}

line("DONE — read-only, nothing was written");
