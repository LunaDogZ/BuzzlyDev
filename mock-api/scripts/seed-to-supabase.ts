/**
 * seed-to-supabase.ts
 *
 * Transforms mock API fixtures → INSERT into Buzzly Supabase tables.
 * Each row is tagged with `team_id` for workspace isolation.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_KEY=... TEAM_ID=... npx tsx scripts/seed-to-supabase.ts [shop-a|shop-b]
 *
 * Run once per workspace:
 *   TEAM_ID=<shop-a-workspace-id> npx tsx scripts/seed-to-supabase.ts shop-a
 *   TEAM_ID=<shop-b-workspace-id> npx tsx scripts/seed-to-supabase.ts shop-b
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || ""; // service_role key recommended
const TEAM_ID      = process.env.TEAM_ID      || "";
const TENANT       = (process.argv[2] || "shop-a") as "shop-a" | "shop-b";

if (!SUPABASE_URL || !SUPABASE_KEY || !TEAM_ID) {
  console.error("❌ Missing env: SUPABASE_URL, SUPABASE_KEY, TEAM_ID");
  console.error("   Usage: SUPABASE_URL=... SUPABASE_KEY=... TEAM_ID=... npx tsx scripts/seed-to-supabase.ts [shop-a|shop-b]");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Platform slugs we ingest ─────────────────────────────────────────
const PLATFORMS = ["facebook", "instagram", "tiktok", "shopee", "google"] as const;
type PlatformSlug = typeof PLATFORMS[number];

// ─── Persona–Ad correlation map ───────────────────────────────────────
// Maps substrings in ad/campaign names to the persona names they target.
// Each entry is checked in declaration order; first match wins.
const PERSONA_KEYWORDS: Record<"shop-a" | "shop-b", Record<string, string[]>> = {
  "shop-a": {
    "Retargeting":     ["Tech-Savvy Millennial", "Small Business Owner"],
    "Lead Gen":        ["Small Business Owner"],
    "Flash Deal":      ["Budget-Conscious Parent"],
    "Flash Sale":      ["Budget-Conscious Parent"],
    "In-Feed":         ["Budget-Conscious Parent"],
    "Flash Deals":     ["Budget-Conscious Parent"],
    "Search":          ["Small Business Owner", "Tech-Savvy Millennial"],
    "Shopping":        ["Budget-Conscious Parent", "Tech-Savvy Millennial"],
    "Display":         ["Small Business Owner"],
    "Mega Sale":       ["Budget-Conscious Parent"],
    "Search Ads":      ["Small Business Owner"],
    "Product Catalog": ["Budget-Conscious Parent", "Tech-Savvy Millennial"],
    "Brand Awareness": ["Tech-Savvy Millennial"],
    "TopView":         ["Tech-Savvy Millennial"],
    "Viral Challenge": ["Tech-Savvy Millennial"],
    "Reels":           ["Tech-Savvy Millennial"],
    "Explore Feed":    ["Tech-Savvy Millennial", "Budget-Conscious Parent"],
    "Top Products":    ["Budget-Conscious Parent", "Tech-Savvy Millennial"],
    "Summer":          ["Tech-Savvy Millennial", "Budget-Conscious Parent"],
    "UGC":             ["Tech-Savvy Millennial"],
    "Influencer":      ["Tech-Savvy Millennial"],
    "Trending":        ["Tech-Savvy Millennial"],
    "Story":           ["Budget-Conscious Parent"],
  },
  "shop-b": {
    "VIP":              ["Luxury Beauty Buyer"],
    "Luxury":           ["Luxury Beauty Buyer"],
    "Premium Serum":    ["Luxury Beauty Buyer"],
    "Premium Skincare": ["Luxury Beauty Buyer"],
    "PMax":             ["Luxury Beauty Buyer"],
    "Retargeting":      ["Luxury Beauty Buyer"],
    "Premium":          ["Luxury Beauty Buyer", "Skincare Enthusiast"],
    "Organic":          ["Skincare Enthusiast"],
    "Skincare":         ["Skincare Enthusiast"],
    "Spark":            ["Skincare Enthusiast"],
    "Beauty Trends":    ["Skincare Enthusiast"],
    "Awareness":        ["Skincare Enthusiast"],
    "Beauty":           ["Skincare Enthusiast", "Luxury Beauty Buyer"],
    "Serum":            ["Luxury Beauty Buyer"],
    "Wellness":         ["Skincare Enthusiast"],
  },
};

function resolvePersonasForName(name: string, allPersonaNames: string[]): string[] {
  const map = PERSONA_KEYWORDS[TENANT];
  for (const [keyword, personas] of Object.entries(map)) {
    if (name.includes(keyword)) {
      return personas.filter((p) => allPersonaNames.includes(p));
    }
  }
  // fallback: link to the first known persona for this shop
  return allPersonaNames.slice(0, 1);
}

// ─── Helpers ──────────────────────────────────────────────────────────
function loadFixture(platform: string, file: string): any {
  const path = join(__dirname, "..", "fixtures", platform, file);
  return JSON.parse(readFileSync(path, "utf-8"));
}

function tenantLabel(): string {
  return TENANT === "shop-a" ? "Shop A – High Volume" : "Shop B – Niche/High-Conv";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Get or create a per-platform ad_account for the current TEAM_ID. */
async function getOrCreateAdAccount(platformId: string, slug: string): Promise<string> {
  const { data: existing } = await supabase
    .from("ad_accounts")
    .select("id")
    .eq("team_id", TEAM_ID)
    .eq("platform_id", platformId)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("ad_accounts")
    .insert({
      team_id:      TEAM_ID,
      platform_id:  platformId,
      account_name: `${tenantLabel()} – ${capitalize(slug)}`,
      is_active:    true,
    })
    .select("id")
    .single();

  if (error) throw new Error(`ad_accounts insert failed (${slug}): ${error.message}`);
  return created!.id;
}

// ─── 1. Seed Campaigns + Ad Insights (all platforms) ─────────────────
async function seedCampaignsAndInsights(): Promise<void> {
  console.log("📊 Seeding campaigns + ad_insights (all 5 platforms)...");

  const { data: platforms, error: pErr } = await supabase
    .from("platforms")
    .select("id, slug")
    .in("slug", [...PLATFORMS]);

  if (pErr || !platforms?.length) {
    throw new Error(`platforms fetch failed: ${pErr?.message ?? "empty result"}`);
  }

  for (const platform of platforms) {
    const slug = platform.slug as PlatformSlug;

    let data: any;
    try {
      data = loadFixture(slug, `${TENANT}-insights.json`);
    } catch {
      console.warn(`  ⚠️  No insights fixture for ${slug}/${TENANT}-insights.json — skipping`);
      continue;
    }

    const adAccountId = await getOrCreateAdAccount(platform.id, slug);

    for (const campaign of data.data) {
      const { data: upsertedCampaign, error: campErr } = await supabase
        .from("campaigns")
        .upsert(
          {
            ad_account_id: adAccountId,
            name:          campaign.campaign_name,
            status:        "active",
            objective:     campaign.objective,
            budget_amount: parseFloat(campaign.spend),
            start_date:    campaign.date_start,
            end_date:      campaign.date_stop,
          },
          { onConflict: "id" }
        )
        .select("id")
        .single();

      if (campErr) {
        console.warn(`  ⚠️  Campaign [${slug}] ${campaign.campaign_name}:`, campErr.message);
        continue;
      }

      // Build 30-day daily ad_insights with realistic jitter
      const startDate = new Date(campaign.date_start);
      const endDate   = new Date(campaign.date_stop);
      const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;

      const totalImpressions = parseInt(campaign.impressions);
      const totalClicks      = parseInt(campaign.clicks);
      const totalSpend       = parseFloat(campaign.spend);
      const totalReach       = parseInt(campaign.reach);
      const totalConversions = parseInt(campaign.conversions);
      const totalLeads       = parseInt(
        campaign.actions?.find((a: any) => a.action_type === "lead")?.value ?? "0"
      );
      const totalAddsToCart  = parseInt(
        campaign.actions?.find((a: any) => a.action_type === "add_to_cart")?.value ?? "0"
      );

      const dailyInsights = [];
      for (let d = 0; d < totalDays; d++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + d);

        // Add a mild weekly rhythm: weekends get a slight lift for B2C
        const dayOfWeek = date.getDay(); // 0=Sun, 6=Sat
        const weekendBoost = (dayOfWeek === 0 || dayOfWeek === 6) ? 1.15 : 1.0;
        const jitter = (0.7 + Math.random() * 0.6) * weekendBoost;

        dailyInsights.push({
          ad_account_id: adAccountId,
          campaign_id:   upsertedCampaign!.id,
          date:          date.toISOString().split("T")[0],
          impressions:   Math.round((totalImpressions / totalDays) * jitter),
          clicks:        Math.round((totalClicks      / totalDays) * jitter),
          spend:         parseFloat(((totalSpend      / totalDays) * jitter).toFixed(2)),
          reach:         Math.round((totalReach       / totalDays) * jitter),
          conversions:   Math.round((totalConversions / totalDays) * jitter),
          leads:         Math.round((totalLeads       / totalDays) * jitter),
          adds_to_cart:  Math.round((totalAddsToCart  / totalDays) * jitter),
          ctr:           parseFloat(campaign.ctr),
          cpc:           parseFloat(campaign.cpc),
          cpm:           parseFloat(campaign.cpm),
          roas:          parseFloat(campaign.roas),
          // The other mock writer. Seeded fixtures, same rule as
          // mock-api/server.ts: say what you are. See 20260812060000.
          data_source:   "mock",
        });
      }

      const { error: insightErr } = await supabase.from("ad_insights").insert(dailyInsights);
      if (insightErr) {
        console.warn(`  ⚠️  Insights [${slug}/${campaign.campaign_name}]:`, insightErr.message);
      } else {
        console.log(`  ✅ [${slug}] ${campaign.campaign_name}: ${dailyInsights.length} days of insights`);
      }
    }
  }
}

// ─── 2. Seed Prospects (from FB /leads) ──────────────────────────────
async function seedProspects(): Promise<void> {
  console.log("👤 Seeding prospects...");

  let data: any;
  try { data = loadFixture("facebook", `${TENANT}-leads.json`); }
  catch { console.warn("  ⚠️  No leads fixture — skipping"); return; }

  const prospects = (data.data as any[]).map((lead) => {
    const fields: Record<string, string> = {};
    lead.field_data.forEach((f: any) => { fields[f.name] = f.values[0]; });
    const [firstName, ...lastParts] = (fields.full_name || "Unknown").split(" ");
    return {
      team_id:      TEAM_ID,
      first_name:   firstName,
      last_name:    lastParts.join(" ") || "",
      email:        fields.email || "",
      phone:        fields.phone_number || "",
      company_name: fields.company_name || "",
      source:       "facebook",
      status:       "new",
      created_at:   lead.created_time,
    };
  });

  const { error } = await supabase.from("prospects").insert(prospects);
  if (error) console.warn("  ⚠️  Prospects:", error.message);
  else console.log(`  ✅ ${prospects.length} prospects seeded`);
}

// ─── 3. Seed Social Posts (synthetic) ────────────────────────────────
async function seedSocialPosts(): Promise<void> {
  console.log("📱 Seeding social posts...");

  const { data: platforms } = await supabase
    .from("platforms")
    .select("id, slug")
    .in("slug", ["facebook", "instagram", "tiktok"]);

  if (!platforms?.length) { console.warn("  ⚠️  No platforms found"); return; }

  const contents = [
    "🔥 Flash Sale! Up to 50% off all items this weekend only!",
    "✨ New arrivals just dropped! Check out our latest collection",
    "💡 Tips: 5 ways to boost your productivity with our tools",
    "🎉 Thank you for 10K followers! Here's a special discount code",
    "📦 Behind the scenes: How we pack and ship your orders",
    "🌟 Customer spotlight: See what @happy_customer says about us",
    "⚡ Limited time offer: Buy 2 Get 1 Free on selected items",
    "🎯 Pro tips for using our premium features effectively",
  ];
  const postTypes    = ["image", "video", "carousel", "reel", "story"];
  const isHighVolume = TENANT === "shop-a";
  const posts: any[] = [];

  for (const platform of platforms) {
    const numPosts = isHighVolume ? 12 : 5;
    for (let i = 0; i < numPosts; i++) {
      const baseImpressions = isHighVolume
        ? 15_000 + Math.random() * 85_000
        : 2_000  + Math.random() * 8_000;
      const engagementRate  = isHighVolume
        ? 2 + Math.random() * 4
        : 5 + Math.random() * 10;

      const daysAgo    = Math.floor(Math.random() * 30);
      const published  = new Date();
      published.setDate(published.getDate() - daysAgo);

      posts.push({
        team_id:         TEAM_ID,
        platform_id:     platform.id,
        post_type:       postTypes[Math.floor(Math.random() * postTypes.length)],
        content:         contents[Math.floor(Math.random() * contents.length)],
        status:          "published",
        published_at:    published.toISOString(),
        impressions:     Math.round(baseImpressions),
        reach:           Math.round(baseImpressions * (0.6 + Math.random() * 0.3)),
        likes:           Math.round(baseImpressions * engagementRate / 100 * 0.60),
        comments:        Math.round(baseImpressions * engagementRate / 100 * 0.15),
        shares:          Math.round(baseImpressions * engagementRate / 100 * 0.10),
        saves:           Math.round(baseImpressions * engagementRate / 100 * 0.05),
        clicks:          Math.round(baseImpressions * engagementRate / 100 * 0.10),
        engagement_rate: parseFloat(engagementRate.toFixed(2)),
        hashtags:        ["#buzzly", `#${platform.slug}`, "#marketing"],
      });
    }
  }

  const { error } = await supabase.from("social_posts").insert(posts);
  if (error) console.warn("  ⚠️  Social posts:", error.message);
  else console.log(`  ✅ ${posts.length} social posts seeded`);
}

// ─── 4. Seed Customer Personas → returns name→id map ────────────────
async function seedCustomerPersonas(): Promise<Record<string, string>> {
  console.log("🎭 Seeding customer personas...");

  const personaIdMap: Record<string, string> = {};

  const personas =
    TENANT === "shop-a"
      ? [
          {
            team_id:      TEAM_ID,
            persona_name: "Tech-Savvy Millennial",
            description:  "Young professional, 25-34, interested in gadgets and tech. Actively shops on multiple platforms.",
            age_min: 25, age_max: 34,
            profession:   "Software Developer",
            company_size: "50-200",
            salary_range: "40K-80K",
            industry:     "Technology",
            interests:    ["technology", "gadgets", "gaming", "productivity"],
            pain_points:  ["price comparison", "shipping speed", "product authenticity"],
            goals:        ["find best deals", "stay updated with latest tech"],
            psychographics: {
              values:      ["innovation", "efficiency", "value-for-money"],
              personality: ["analytical", "early-adopter", "research-driven"],
              lifestyle:   ["urban", "digitally-native", "content-creator"],
            },
            ad_targeting_mapping: {
              facebook_interests: ["Technology", "Consumer Electronics", "Online Shopping"],
              google_audiences:   ["Tech Enthusiasts", "Shoppers"],
              tiktok_interests:   ["Tech & Gadgets", "Gaming"],
              age_range:          "25-34",
              gender:             "all",
            },
            is_active: true,
          },
          {
            team_id:      TEAM_ID,
            persona_name: "Budget-Conscious Parent",
            description:  "Working parent, 30-45, looking for value deals on family products.",
            age_min: 30, age_max: 45,
            profession:   "Office Worker",
            company_size: "10-50",
            salary_range: "25K-50K",
            industry:     "Various",
            interests:    ["family", "education", "home", "discounts"],
            pain_points:  ["limited budget", "product quality", "delivery reliability"],
            goals:        ["save money", "find quality products for family"],
            psychographics: {
              values:      ["family-first", "practicality", "trustworthiness"],
              personality: ["cautious", "comparison-shopper", "brand-loyal"],
              lifestyle:   ["suburban", "busy-schedule", "deal-hunter"],
            },
            ad_targeting_mapping: {
              facebook_interests: ["Parenting", "Family", "Coupons & Deals"],
              google_audiences:   ["Bargain Hunters", "Family-Focused Shoppers"],
              tiktok_interests:   ["Family", "Home & Living"],
              age_range:          "30-45",
              gender:             "all",
            },
            is_active: true,
          },
          {
            team_id:      TEAM_ID,
            persona_name: "Small Business Owner",
            description:  "Entrepreneur, 28-50, buying in bulk for resale or business use.",
            age_min: 28, age_max: 50,
            profession:   "Business Owner",
            company_size: "1-10",
            salary_range: "50K-150K",
            industry:     "Retail",
            interests:    ["wholesale", "business tools", "inventory management"],
            pain_points:  ["bulk pricing", "consistent quality", "supplier reliability"],
            goals:        ["grow business", "reduce costs", "find reliable suppliers"],
            psychographics: {
              values:      ["ROI", "reliability", "scalability"],
              personality: ["decisive", "results-oriented", "risk-aware"],
              lifestyle:   ["entrepreneur", "high-purchase-frequency", "b2b-mindset"],
            },
            ad_targeting_mapping: {
              facebook_interests: ["Small Business", "Entrepreneurship", "Wholesale"],
              google_audiences:   ["Business Buyers", "B2B Shoppers"],
              tiktok_interests:   ["Business & Finance"],
              age_range:          "28-50",
              gender:             "all",
            },
            is_active: true,
          },
        ]
      : [
          {
            team_id:      TEAM_ID,
            persona_name: "Skincare Enthusiast",
            description:  "Beauty-conscious individual, 22-35, willing to pay premium for quality skincare.",
            age_min: 22, age_max: 35,
            profession:   "Creative Professional",
            company_size: "10-50",
            salary_range: "30K-60K",
            industry:     "Beauty & Wellness",
            interests:    ["skincare", "organic products", "self-care", "wellness"],
            pain_points:  ["product ingredients", "skin sensitivity", "authenticity"],
            goals:        ["achieve healthy skin", "find trusted brands"],
            psychographics: {
              values:      ["clean beauty", "self-care", "transparency"],
              personality: ["research-intensive", "community-driven", "ingredient-conscious"],
              lifestyle:   ["health-conscious", "social-media-active", "trend-follower"],
            },
            ad_targeting_mapping: {
              facebook_interests: ["Skincare", "Organic Beauty", "Wellness"],
              google_audiences:   ["Beauty & Personal Care Shoppers"],
              tiktok_interests:   ["Beauty & Skincare", "Health & Wellness"],
              age_range:          "22-35",
              gender:             "female",
            },
            is_active: true,
          },
          {
            team_id:      TEAM_ID,
            persona_name: "Luxury Beauty Buyer",
            description:  "High-income individual, 30-50, loyal to premium brands with repeat purchases.",
            age_min: 30, age_max: 50,
            profession:   "Executive",
            company_size: "200+",
            salary_range: "80K-200K",
            industry:     "Corporate",
            interests:    ["luxury", "premium skincare", "anti-aging", "spa treatments"],
            pain_points:  ["finding genuine products", "personalized recommendations"],
            goals:        ["maintain youthful appearance", "discover new premium brands"],
            psychographics: {
              values:      ["exclusivity", "quality-over-price", "brand-prestige"],
              personality: ["status-conscious", "brand-loyal", "low-price-sensitivity"],
              lifestyle:   ["high-income", "frequent-traveler", "luxury-consumer"],
            },
            ad_targeting_mapping: {
              facebook_interests: ["Luxury Goods", "Premium Brands", "Anti-Aging"],
              google_audiences:   ["Luxury Shoppers", "Frequent Beauty Buyers"],
              tiktok_interests:   ["Luxury & Fashion", "Premium Beauty"],
              age_range:          "30-50",
              gender:             "female",
            },
            is_active: true,
          },
        ];

  for (const persona of personas) {
    const { data: inserted, error } = await supabase
      .from("customer_personas")
      .insert(persona)
      .select("id, persona_name")
      .single();

    if (error) console.warn(`  ⚠️  Persona (${persona.persona_name}):`, error.message);
    else {
      personaIdMap[inserted!.persona_name] = inserted!.id;
      console.log(`  ✅ Persona: ${inserted!.persona_name}`);
    }
  }

  return personaIdMap;
}

// ─── 5. Seed Customer Activities ─────────────────────────────────────
async function seedCustomerActivities(): Promise<void> {
  console.log("🚶 Seeding customer activities...");

  const { data: eventTypes } = await supabase.from("event_types").select("id, name").limit(10);
  if (!eventTypes?.length) { console.warn("  ⚠️  No event_types found — skipping"); return; }

  // Grab the first ad_account for this team to associate campaign IDs
  const { data: adAccount } = await supabase
    .from("ad_accounts").select("id").eq("team_id", TEAM_ID).limit(1).maybeSingle();

  let campaignIds: string[] = [];
  if (adAccount) {
    const { data: campaigns } = await supabase
      .from("campaigns").select("id").eq("ad_account_id", adAccount.id).limit(5);
    campaignIds = campaigns?.map((c: any) => c.id) ?? [];
  }

  const { data: profiles } = await supabase.from("profile_customers").select("id").limit(20);
  const profileIds    = profiles?.map((p: any) => p.id) ?? [];
  const devices       = ["mobile", "desktop", "tablet"];
  const browsers      = ["Chrome", "Safari", "Firefox", "Edge"];
  const numActivities = TENANT === "shop-a" ? 80 : 30;
  const activities: any[] = [];

  for (let i = 0; i < numActivities; i++) {
    const daysAgo   = Math.floor(Math.random() * 30);
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - daysAgo);
    createdAt.setHours(Math.floor(Math.random() * 24));
    createdAt.setMinutes(Math.floor(Math.random() * 60));

    activities.push({
      profile_customer_id: profileIds.length > 0
        ? profileIds[Math.floor(Math.random() * profileIds.length)]
        : null,
      event_type_id: eventTypes[Math.floor(Math.random() * eventTypes.length)].id,
      campaign_id:   campaignIds.length > 0
        ? campaignIds[Math.floor(Math.random() * campaignIds.length)]
        : null,
      session_id:    `sess_${Date.now().toString(36)}_${i}`,
      device_type:   devices[Math.floor(Math.random() * devices.length)],
      browser:       browsers[Math.floor(Math.random() * browsers.length)],
      created_at:    createdAt.toISOString(),
    });
  }

  const { error } = await supabase.from("customer_activities").insert(activities);
  if (error) console.warn("  ⚠️  Activities:", error.message);
  else console.log(`  ✅ ${activities.length} customer activities seeded`);
}

// ─── 6. Seed Cohort Analysis ──────────────────────────────────────────
async function seedCohortAnalysis(): Promise<void> {
  console.log("📈 Seeding cohort analysis...");
  const isHighVolume = TENANT === "shop-a";
  const cohorts: any[] = [];

  for (let month = 0; month < 6; month++) {
    const date = new Date();
    date.setMonth(date.getMonth() - month);
    date.setDate(1);

    const baseSize         = isHighVolume
      ? 500 + Math.floor(Math.random() * 1500)
      : 50  + Math.floor(Math.random() * 150);
    const retentionData: Record<string, number> = {};
    let retention = 100;
    for (let w = 0; w <= 12; w++) {
      retentionData[`week_${w}`] = Math.round(retention * 10) / 10;
      retention *= isHighVolume ? 0.82 + Math.random() * 0.08 : 0.88 + Math.random() * 0.06;
    }

    cohorts.push({
      team_id:           TEAM_ID,
      cohort_date:       date.toISOString().split("T")[0],
      cohort_type:       "monthly",
      cohort_size:       baseSize,
      retention_data:    retentionData,
      revenue_data: {
        month_0: baseSize * (isHighVolume ? 18 : 85),
        month_1: Math.round(baseSize * (isHighVolume ? 18 : 85) * 0.6),
        month_2: Math.round(baseSize * (isHighVolume ? 18 : 85) * 0.35),
      },
      average_retention: parseFloat(retention.toFixed(2)),
      lifetime_value:    parseFloat((isHighVolume ? 42 + Math.random() * 20 : 180 + Math.random() * 80).toFixed(2)),
      churn_rate:        parseFloat((isHighVolume ? 12 + Math.random() * 8  : 5   + Math.random() * 5).toFixed(2)),
    });
  }

  const { error } = await supabase.from("cohort_analysis").insert(cohorts);
  if (error) console.warn("  ⚠️  Cohort:", error.message);
  else console.log(`  ✅ ${cohorts.length} cohort records seeded`);
}

// ─── 7. Seed Conversion Events (Shopee orders) ───────────────────────
async function seedConversionEvents(): Promise<void> {
  console.log("💰 Seeding conversion events...");

  let data: any;
  try { data = loadFixture("shopee", `${TENANT}-orders.json`); }
  catch { console.warn("  ⚠️  No Shopee orders fixture — skipping"); return; }

  const { data: adAccount } = await supabase
    .from("ad_accounts").select("id").eq("team_id", TEAM_ID).limit(1).maybeSingle();
  if (!adAccount) { console.warn("  ⚠️  No ad_account found — skipping"); return; }

  const events = (data.response.order_list as any[])
    .filter((o) => o.order_status === "COMPLETED")
    .map((order) => ({
      ad_account_id:     adAccount.id,
      event_name:        "purchase",
      event_value:       order.total_amount,
      occurred_at:       new Date(order.create_time * 1000).toISOString(),
      processing_status: "completed",
      meta_data: {
        order_sn:       order.order_sn,
        buyer:          order.buyer_username,
        payment_method: order.payment_method,
        items:          order.item_list.length,
        source:         "shopee",
      },
    }));

  const { error } = await supabase.from("conversion_events").insert(events);
  if (error) console.warn("  ⚠️  Conversion events:", error.message);
  else console.log(`  ✅ ${events.length} conversion events seeded`);
}

// ─── 8. Seed Ad Groups → returns platform→id map ─────────────────────
async function seedAdGroups(): Promise<Record<string, string>> {
  console.log("📁 Seeding ad groups...");
  const adGroupIdMap: Record<string, string> = {};

  for (const slug of PLATFORMS) {
    const { data: inserted, error } = await supabase
      .from("ad_groups")
      .insert({
        name:    `${tenantLabel()} – ${capitalize(slug)} Ads`,
        status:  "active",
        team_id: TEAM_ID,
      })
      .select("id")
      .single();

    if (error) console.warn(`  ⚠️  Ad group (${slug}):`, error.message);
    else {
      adGroupIdMap[slug] = inserted!.id;
      console.log(`  ✅ Ad group: ${slug}`);
    }
  }

  return adGroupIdMap;
}

// ─── 9. Seed Ads → returns externalAdId→dbId map ─────────────────────
async function seedAds(adGroupIdMap: Record<string, string>): Promise<Record<string, string>> {
  console.log("📣 Seeding ads...");
  const adIdMap: Record<string, string> = {};

  for (const slug of PLATFORMS) {
    let data: any;
    try { data = loadFixture(slug, `${TENANT}-ads.json`); }
    catch { console.warn(`  ⚠️  No ads fixture for ${slug}/${TENANT}-ads.json — skipping`); continue; }

    for (const ad of data.data as any[]) {
      const { data: inserted, error } = await supabase
        .from("ads")
        .insert({
          team_id:       TEAM_ID,
          name:          ad.ad_name,
          platform:      ad.platform ?? slug,
          status:        (ad.status ?? "ACTIVE").toLowerCase(),
          creative_type: ad.creative_type ?? "image",
          persona_data:  ad.persona_data ?? null,
          ad_group_id:   adGroupIdMap[slug] ?? null,
        })
        .select("id")
        .single();

      if (error) console.warn(`  ⚠️  Ad [${slug}] ${ad.ad_name}:`, error.message);
      else {
        adIdMap[ad.external_ad_id] = inserted!.id;
        console.log(`  ✅ [${slug}] Ad: ${ad.ad_name}`);
      }
    }
  }

  return adIdMap;
}

// ─── 10. Seed Ad-Persona Links ────────────────────────────────────────
async function seedAdPersonaLinks(
  adIdMap:     Record<string, string>,
  personaIdMap: Record<string, string>
): Promise<void> {
  console.log("🔗 Seeding ad-persona links...");

  const allPersonaNames = Object.keys(personaIdMap);
  const links: { ad_id: string; persona_id: string }[] = [];

  for (const slug of PLATFORMS) {
    let data: any;
    try { data = loadFixture(slug, `${TENANT}-ads.json`); }
    catch { continue; }

    for (const ad of data.data as any[]) {
      const dbAdId = adIdMap[ad.external_ad_id];
      if (!dbAdId) continue;

      const targetNames = resolvePersonasForName(ad.ad_name, allPersonaNames);
      for (const pName of targetNames) {
        const personaId = personaIdMap[pName];
        if (personaId) links.push({ ad_id: dbAdId, persona_id: personaId });
      }
    }
  }

  if (!links.length) { console.warn("  ⚠️  No ad-persona links to insert"); return; }

  const { error } = await supabase.from("ad_personas").insert(links);
  if (error) console.warn("  ⚠️  Ad-persona links:", error.message);
  else console.log(`  ✅ ${links.length} ad-persona links seeded`);
}

// ─── Run All ──────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🐝 Buzzly Mock Data Seeder`);
  console.log(`   Tenant:  ${TENANT}`);
  console.log(`   Team ID: ${TEAM_ID}\n`);

  try {
    // Phase 1: Platform data
    await seedCampaignsAndInsights();
    await seedProspects();
    await seedSocialPosts();
    await seedConversionEvents();
    await seedCohortAnalysis();

    // Phase 2: Audience + Creatives (order matters — personas before links)
    const personaIdMap = await seedCustomerPersonas();
    await seedCustomerActivities();

    // Phase 3: Ads + persona linking
    const adGroupIdMap = await seedAdGroups();
    const adIdMap      = await seedAds(adGroupIdMap);
    await seedAdPersonaLinks(adIdMap, personaIdMap);

    console.log("\n✅ All mock data seeded successfully!\n");
    console.log("   Fixture coverage:");
    console.log("   • campaigns + ad_insights : facebook, instagram, tiktok, shopee, google");
    console.log("   • ads                      : all 5 platforms");
    console.log("   • ad_personas              : linked by keyword correlation");
    console.log("   • customer_personas        : with psychographics + ad_targeting_mapping");
    console.log("   • social_posts             : facebook, instagram, tiktok");
    console.log("   • prospects                : facebook leads");
    console.log("   • conversion_events        : shopee orders");
    console.log("   • cohort_analysis          : 6 months synthetic\n");
  } catch (err) {
    console.error("\n❌ Seed failed:", err);
    process.exit(1);
  }
}

main();
