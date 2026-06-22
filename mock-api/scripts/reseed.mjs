// One-off re-seed helper: finds active platform connections in the cloud DB whose
// stored access_token is a known mock API key, then re-runs POST /api/connect for each
// so ingestion writes campaigns + campaign_ads + rebased dates with the latest server code.
//
// Run from mock-api/:  node scripts/reseed.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

// Load mock-api/.env (same loose parser the server uses)
try {
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
} catch (e) {
  console.error("Failed to load .env:", e);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MOCK_API = process.env.RESEED_API_BASE || "http://localhost:3001";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in mock-api/.env");
  process.exit(1);
}

const VALID_MOCK_KEYS = new Set([
  "FB_TEST_KEY_SHOP_A", "FB_TEST_KEY_SHOP_B",
  "IG_TEST_KEY_SHOP_A", "IG_TEST_KEY_SHOP_B",
  "TT_TEST_KEY_SHOP_A", "TT_TEST_KEY_SHOP_B",
  "SHP_TEST_KEY_SHOP_A", "SHP_TEST_KEY_SHOP_B",
  "GG_TEST_KEY_SHOP_A", "GG_TEST_KEY_SHOP_B",
]);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const { data: conns, error } = await supabase
  .from("workspace_api_keys")
  .select("team_id, platform_id, access_token, is_active, platforms(slug, name)")
  .eq("is_active", true);

if (error) {
  console.error("Query workspace_api_keys failed:", error.message);
  process.exit(1);
}

const targets = (conns ?? []).filter((c) => VALID_MOCK_KEYS.has((c.access_token ?? "").trim()));

console.log(`Found ${conns?.length ?? 0} active connection(s); ${targets.length} use a real mock key.\n`);

if (targets.length === 0) {
  console.log("Nothing to re-seed (no connection stores a known mock key).");
  process.exit(0);
}

for (const c of targets) {
  const slug = c.platforms?.slug;
  const { data: acct } = await supabase
    .from("ad_accounts")
    .select("id")
    .eq("team_id", c.team_id)
    .eq("platform_id", c.platform_id)
    .maybeSingle();

  if (!acct?.id) {
    console.log(`✗ ${slug} (team ${c.team_id}): no ad_account row — skipped`);
    continue;
  }

  const res = await fetch(`${MOCK_API}/api/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey: c.access_token.trim(),
      platformSlug: slug,
      workspaceId: c.team_id,
      adAccountId: acct.id,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.log(`✗ ${slug} (team ${c.team_id}): HTTP ${res.status} — ${body.error ?? "unknown"}`);
    continue;
  }
  console.log(`✓ ${slug} (team ${c.team_id}):`, JSON.stringify({
    campaignsCreated: body.campaignsCreated,
    campaignAdsLinked: body.campaignAdsLinked,
    adsUpserted: body.adsUpserted,
    rowsInserted: body.rowsInserted,
    organicPostsInserted: body.organicPostsInserted,
  }));
}

console.log("\nDone.");
