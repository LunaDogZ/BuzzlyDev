// Verify re-seed: inspect campaigns / campaign_ads / ad_insights for one team.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

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
} catch (e) { console.error(e); }

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const TEAM = process.argv[2] || "7c3976f5-bbf4-42b8-bd41-69a9e7f74c92";

const { data: campaigns } = await supabase
  .from("campaigns")
  .select("id, name, status, objective, ad_account_id, start_date, end_date")
  .eq("team_id", TEAM);

console.log(`\n=== campaigns for team ${TEAM}: ${campaigns?.length ?? 0} ===`);
for (const c of campaigns ?? []) {
  console.log(`  • ${c.name} | status=${c.status} | ad_account=${c.ad_account_id ? "set" : "NULL"} | ${String(c.start_date).slice(0,10)} → ${String(c.end_date).slice(0,10)}`);
}

const campIds = (campaigns ?? []).map((c) => c.id);
const { count: linkCount } = await supabase
  .from("campaign_ads")
  .select("*", { count: "exact", head: true })
  .in("campaign_id", campIds.length ? campIds : ["00000000-0000-0000-0000-000000000000"]);
console.log(`\n=== campaign_ads links: ${linkCount ?? 0} ===`);

// ad_insights via the team's ad_accounts
const { data: accts } = await supabase.from("ad_accounts").select("id").eq("team_id", TEAM);
const acctIds = (accts ?? []).map((a) => a.id);
const { data: insights } = await supabase
  .from("ad_insights")
  .select("date, campaign_id, ads_id, impressions, clicks, spend")
  .in("ad_account_id", acctIds.length ? acctIds : ["x"]);

const rows = insights ?? [];
const withCampaign = rows.filter((r) => r.campaign_id).length;
const dates = rows.map((r) => r.date).sort();
const totSpend = rows.reduce((s, r) => s + Number(r.spend || 0), 0);
const totClicks = rows.reduce((s, r) => s + (r.clicks || 0), 0);
console.log(`\n=== ad_insights: ${rows.length} rows ===`);
console.log(`  with campaign_id: ${withCampaign}/${rows.length}`);
console.log(`  date range: ${dates[0]} → ${dates[dates.length - 1]}`);
console.log(`  today (UTC): ${new Date().toISOString().slice(0,10)}`);
console.log(`  totals: clicks=${totClicks}, spend=${totSpend.toFixed(2)}`);
console.log();
