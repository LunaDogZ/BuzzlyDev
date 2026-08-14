// Does this Meta account report revenue at all?
//
// Read-only — every call is a GET. Nothing is written to Meta or to Supabase.
//
// The question this answers is prior to any schema work: `ad_insights.roas` is
// stored NULL because the connector has no revenue to divide by, and the
// obvious fix is to request `action_values` from Meta. That is only worth
// building if the account actually reports it, and L-5 says the connected
// account runs *messaging* campaigns — where a "purchase" is a conversion
// signal with no money attached. Measure before mapping.
//
// It prints, over the account's whole history at ad/day grain:
//   1. every distinct `action_type` with a value, and its total count
//   2. every distinct `action_type` in `action_values`, and its total THB
//   3. whether `purchase_roas` / `website_purchase_roas` come back at all
//
// Run:  node scripts/meta-revenue-probe.mjs
//       node scripts/meta-revenue-probe.mjs --since 2025-01-01 --until 2026-08-14
//
// Token handling matches scripts/meta-probe.mjs: read from mock-api/.env
// (gitignored), never printed, redacted out of every line including error
// bodies and the paging URLs Meta hands back, which carry the token inline.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";

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
const VERSION = env.META_API_VERSION || "v23.0";
const AD_ACCOUNT = env.META_AD_ACCOUNT_ID;

if (!TOKEN || !AD_ACCOUNT) {
  console.error("META_ACCESS_TOKEN and META_AD_ACCOUNT_ID must be set in mock-api/.env");
  process.exit(1);
}

/** Strip the token out of anything before it can be printed. Applied to error
 *  bodies and to Meta's own paging URLs, which embed the token inline. */
const redact = (value) => String(value).split(TOKEN).join("<token>");

const argOf = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const SINCE = argOf("since") || "2025-01-01";
const UNTIL = argOf("until") || new Date().toISOString().slice(0, 10);

async function getAllPages(url) {
  const rows = [];
  let next = url;
  while (next) {
    const res = await fetch(next);
    const body = await res.json();
    if (!res.ok || body.error) {
      console.error(`HTTP ${res.status}: ${redact(JSON.stringify(body))}`);
      process.exit(1);
    }
    rows.push(...(body.data ?? []));
    next = body.paging?.next ?? null;
  }
  return rows;
}

const params = new URLSearchParams({
  access_token: TOKEN,
  level: "ad",
  time_increment: "1",
  time_range: JSON.stringify({ since: SINCE, until: UNTIL }),
  // The three revenue-bearing fields, alongside `actions` so counts and values
  // can be compared type by type. A type present in `actions` but absent from
  // `action_values` is a conversion Meta counted and attached no money to —
  // which is the exact shape L-5 predicts for this account.
  fields: "date_start,ad_id,spend,actions,action_values,purchase_roas,website_purchase_roas",
  limit: "200",
});

const url = `https://graph.facebook.com/${VERSION}/${AD_ACCOUNT}/insights?${params}`;

console.log(`Account ${AD_ACCOUNT} · ${SINCE} → ${UNTIL} · level=ad · time_increment=1\n`);

const rows = await getAllPages(url);
console.log(`rows returned: ${rows.length}\n`);

const tally = (rowsIn, key) => {
  const totals = new Map();
  for (const row of rowsIn) {
    for (const entry of row[key] ?? []) {
      const type = entry.action_type ?? "(unnamed)";
      const value = Number(entry.value);
      if (!Number.isFinite(value)) continue;
      totals.set(type, (totals.get(type) ?? 0) + value);
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
};

const actions = tally(rows, "actions");
const values = tally(rows, "action_values");

console.log(`1. actions — ${actions.length} distinct action_type(s)`);
for (const [type, total] of actions) console.log(`   ${total.toString().padStart(10)}  ${type}`);

console.log(`\n2. action_values — ${values.length} distinct action_type(s)  [THIS IS REVENUE]`);
if (values.length === 0) {
  console.log("   (none — the account attaches no monetary value to any conversion)");
} else {
  for (const [type, total] of values) console.log(`   ${total.toFixed(2).padStart(12)}  ${type}`);
}

const roasRows = rows.filter((r) => r.purchase_roas || r.website_purchase_roas);
console.log(`\n3. purchase_roas / website_purchase_roas present on ${roasRows.length} of ${rows.length} rows`);
if (roasRows[0]) console.log(`   sample: ${JSON.stringify(roasRows[0].purchase_roas ?? roasRows[0].website_purchase_roas)}`);

const spend = rows.reduce((sum, r) => sum + Number(r.spend || 0), 0);
console.log(`\nspend over the window: ฿${spend.toFixed(2)}`);
console.log(
  values.length === 0
    ? "\nVERDICT: no revenue is obtainable from this account. ROAS cannot be computed from Meta."
    : "\nVERDICT: revenue IS reported — action_values can fill a revenue column."
);
