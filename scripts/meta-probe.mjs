// Probe a real Meta Marketing API token: what it is, how long it lives, and
// whether it can actually read ad insights.
//
// Read-only — every call is a GET. Nothing is written to Meta or to Supabase.
//
// Run:  node scripts/meta-probe.mjs
//
// The token is read from mock-api/.env (gitignored) and is NEVER printed: it is
// redacted out of every line of output, including error bodies, because Meta
// echoes the request back in some error payloads.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";

// ── env ──────────────────────────────────────────────────────────────────────
// mock-api/.env, not the root .env: this is a server-side secret. A VITE_* var
// would be compiled into the browser bundle and handed to every visitor.
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
const APP_ID = env.META_APP_ID;
const APP_SECRET = env.META_APP_SECRET;
const VERSION = env.META_API_VERSION || "v23.0";
const AD_ACCOUNT = env.META_AD_ACCOUNT_ID;

if (!TOKEN) {
  console.error("META_ACCESS_TOKEN is not set in mock-api/.env");
  process.exit(1);
}

const BASE = `https://graph.facebook.com/${VERSION}`;
const redact = (s) => {
  let out = String(s).split(TOKEN).join("<TOKEN>");
  if (APP_SECRET) out = out.split(APP_SECRET).join("<APP_SECRET>");
  return out;
};

// ── http ─────────────────────────────────────────────────────────────────────
async function get(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (!url.searchParams.has("access_token")) url.searchParams.set("access_token", TOKEN);

  const res = await fetch(url);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, status: res.status, error: { message: redact(text.slice(0, 300)) } };
  }
  if (!res.ok || body.error) {
    const e = body.error ?? {};
    return {
      ok: false,
      status: res.status,
      error: {
        message: redact(e.message ?? text.slice(0, 300)),
        type: e.type,
        code: e.code,
        subcode: e.error_subcode,
      },
    };
  }
  return { ok: true, body };
}

const fmtDate = (unix) =>
  !unix ? "never (does not expire)" : new Date(unix * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";

const fmtLeft = (unix) => {
  if (!unix) return "";
  const days = (unix * 1000 - Date.now()) / 86_400_000;
  if (days < 0) return "  ← ALREADY EXPIRED";
  if (days < 1) return `  ← ${Math.round(days * 24)} hours left`;
  return `  ← ${Math.round(days)} days left`;
};

const line = (t) => console.log(`\n${"─".repeat(70)}\n${t}\n${"─".repeat(70)}`);
const fail = (label, r) =>
  console.log(`  ✗ ${label}: ${r.error.message}${r.error.code ? `  [code ${r.error.code}${r.error.subcode ? `/${r.error.subcode}` : ""}]` : ""}`);

// ── 1. what is this token ────────────────────────────────────────────────────
line("1. TOKEN IDENTITY  (/debug_token)");

// debug_token wants an app token; fall back to the token inspecting itself,
// which works when the token belongs to an app you administer.
const inspector = APP_ID && APP_SECRET ? `${APP_ID}|${APP_SECRET}` : TOKEN;
if (!APP_SECRET) {
  console.log("  ℹ META_APP_SECRET not set — inspecting with the token itself.");
}

let scopes = [];
const dbg = await get("/debug_token", { input_token: TOKEN, access_token: inspector });
if (!dbg.ok) {
  fail("debug_token", dbg);
} else {
  const d = dbg.body.data ?? {};
  scopes = d.scopes ?? [];
  console.log(`  valid          : ${d.is_valid ? "YES" : "NO"}`);
  console.log(`  type           : ${d.type ?? "?"}`);
  console.log(`  app            : ${d.application ?? "?"} (id ${d.app_id ?? "?"})`);
  console.log(`  user/entity id : ${d.user_id ?? d.profile_id ?? "—"}`);
  console.log(`  expires        : ${fmtDate(d.expires_at)}${fmtLeft(d.expires_at)}`);
  console.log(`  data access    : ${fmtDate(d.data_access_expires_at)}${fmtLeft(d.data_access_expires_at)}`);
  console.log(`  scopes         : ${scopes.length ? scopes.join(", ") : "(none)"}`);

  const needed = ["ads_read", "ads_management", "business_management", "read_insights"];
  console.log("");
  for (const s of needed) {
    const has = scopes.includes(s);
    const note =
      s === "ads_read" ? "  ← REQUIRED to read insights"
      : s === "ads_management" ? "  (write access — not needed for us)"
      : "";
    console.log(`  ${has ? "✓" : "✗"} ${s}${note}`);
  }
}

// ── 2. who ───────────────────────────────────────────────────────────────────
line("2. IDENTITY  (/me)");
const me = await get("/me", { fields: "id,name" });
if (!me.ok) fail("/me", me);
else console.log(`  ${me.body.name ?? "(no name)"}  (id ${me.body.id})`);

// ── 3. reachable ad accounts ─────────────────────────────────────────────────
line("3. AD ACCOUNTS  (/me/adaccounts)");
const STATUS = { 1: "ACTIVE", 2: "DISABLED", 3: "UNSETTLED", 7: "PENDING_REVIEW", 9: "IN_GRACE_PERIOD", 101: "CLOSED" };

let accounts = [];
const accs = await get("/me/adaccounts", {
  fields: "id,account_id,name,account_status,currency,timezone_name,amount_spent",
  limit: "25",
});
if (!accs.ok) {
  fail("/me/adaccounts", accs);
} else {
  accounts = accs.body.data ?? [];
  if (!accounts.length) {
    console.log("  (none visible to this token)");
  }
  for (const a of accounts) {
    console.log(`  • ${a.id}  ${a.name ?? ""}`);
    console.log(`      status=${STATUS[a.account_status] ?? a.account_status}  currency=${a.currency}  tz=${a.timezone_name}  lifetime_spend=${a.amount_spent}`);
  }
}

// ── 4. can it read real data ─────────────────────────────────────────────────
const target = AD_ACCOUNT || accounts[0]?.id;
line(`4. REAL DATA  (${target ?? "no ad account to try"})`);

if (!target) {
  console.log("  Skipped — no ad account available.");
} else {
  if (!AD_ACCOUNT) console.log(`  ℹ META_AD_ACCOUNT_ID not set — using the first account found.\n`);

  const camps = await get(`/${target}/campaigns`, {
    fields: "id,name,status,objective,created_time",
    limit: "5",
  });
  if (!camps.ok) {
    fail("campaigns", camps);
  } else {
    const rows = camps.body.data ?? [];
    console.log(`  campaigns: ${rows.length}${rows.length === 5 ? "+ (limit 5)" : ""}`);
    for (const c of rows) console.log(`    • ${c.name}  [${c.status}]  ${c.objective ?? ""}`);
  }

  console.log("");
  const ins = await get(`/${target}/insights`, {
    fields: "campaign_name,spend,impressions,clicks,ctr,cpc,actions",
    date_preset: "last_30d",
    level: "campaign",
    limit: "5",
  });
  if (!ins.ok) {
    fail("insights", ins);
  } else {
    const rows = ins.body.data ?? [];
    console.log(`  insights (last 30 days, by campaign): ${rows.length} row(s)`);
    if (!rows.length) console.log("    (no delivery in this window — the call itself succeeded)");
    for (const r of rows) {
      console.log(`    • ${r.campaign_name ?? "?"}`);
      console.log(`        spend=${r.spend}  impressions=${r.impressions}  clicks=${r.clicks}  ctr=${r.ctr}  cpc=${r.cpc}`);
      const purchases = (r.actions ?? []).filter((a) => /purchase/i.test(a.action_type));
      if (purchases.length) {
        console.log(`        purchase actions: ${purchases.map((p) => `${p.action_type}=${p.value}`).join(", ")}`);
      }
    }
    // What the wedge needs beyond ad spend. Meta knows what you paid to
    // advertise; it does not know Shopee's cut or what the goods cost.
    console.log("\n  Note: `spend` here is ad cost only. True Net Profit still needs");
    console.log("  Shopee income + fees and COGS from the other leg.");
  }
}

line("SUMMARY");
console.log(`  API version tried : ${VERSION}`);
console.log(`  ads_read present  : ${scopes.includes("ads_read") ? "YES" : "NO — insights will fail"}`);
console.log(`  ad accounts seen  : ${accounts.length}`);
console.log("");
