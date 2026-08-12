import express from "express";
import cors from "cors";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
// Load .env from mock-api directory (tsx doesn't auto-load it)
try {
  const envPath = fileURLToPath(new URL(".env", import.meta.url));
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
} catch (e) {
  console.error("Failed to load .env:", e);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * Where /api/connect fetches fixture data from (GET /:platform/:tenant/ads, etc.).
 * - Explicit EXTERNAL_API_BASE_URL: use it (real platform APIs or a separate mock host).
 * - Vercel: default to this deployment's public URL so server-side fetch does not use localhost.
 * - Local: loop back to same process on localhost.
 */
function resolveExternalApiBaseUrl(): string {
  const explicit = process.env.EXTERNAL_API_BASE_URL?.trim();
  if (explicit) {
    return normalizeBaseUrl(explicit);
  }
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//i, "");
    return normalizeBaseUrl(`https://${host}`);
  }
  return normalizeBaseUrl(`http://localhost:${PORT}`);
}

// ─── Environment Configuration ────────────────────────────────────────
const EXTERNAL_API_BASE_URL = resolveExternalApiBaseUrl();
const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Lazy Supabase client (service role — bypasses RLS for server-side writes)
let _supabase: SupabaseClient | null = null;
function getSupabaseClient() {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. " +
      "Add it to mock-api/.env (run: supabase status to get the key)."
    );
  }
  if (!_supabase) {
    _supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}

app.use(cors());
app.use(express.json());

// ─── Mock API Key Dictionary ──────────────────────────────────────────
// Each key maps to a { tenant, platform, shopLabel }
const MOCK_API_KEYS: Record<string, { tenant: string; platform: string; shopLabel: string }> = {
  "FB_TEST_KEY_SHOP_A": { tenant: "shop-a", platform: "facebook", shopLabel: "Shop A – High Volume" },
  "FB_TEST_KEY_SHOP_B": { tenant: "shop-b", platform: "facebook", shopLabel: "Shop B – Niche/High-Conversion" },
  "IG_TEST_KEY_SHOP_A": { tenant: "shop-a", platform: "instagram", shopLabel: "Shop A – High Volume" },
  "IG_TEST_KEY_SHOP_B": { tenant: "shop-b", platform: "instagram", shopLabel: "Shop B – Niche/High-Conversion" },
  "TT_TEST_KEY_SHOP_A": { tenant: "shop-a", platform: "tiktok", shopLabel: "Shop A – High Volume" },
  "TT_TEST_KEY_SHOP_B": { tenant: "shop-b", platform: "tiktok", shopLabel: "Shop B – Niche/High-Conversion" },
  "SHP_TEST_KEY_SHOP_A": { tenant: "shop-a", platform: "shopee", shopLabel: "Shop A – High Volume" },
  "SHP_TEST_KEY_SHOP_B": { tenant: "shop-b", platform: "shopee", shopLabel: "Shop B – Niche/High-Conversion" },
  "GG_TEST_KEY_SHOP_A": { tenant: "shop-a", platform: "google", shopLabel: "Shop A – High Volume" },
  "GG_TEST_KEY_SHOP_B": { tenant: "shop-b", platform: "google", shopLabel: "Shop B – Niche/High-Conversion" },
};

// Helper: load fixture JSON
function loadFixture(platform: string, tenant: string, endpoint: string) {
  const filePath = join(__dirname, "fixtures", platform, `${tenant}-${endpoint}.json`);
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (e) {
    return { error: `Fixture not found: ${filePath}` };
  }
}

interface ExternalAdRecord {
  ad_group_external_id?: string | null;
  ad_group_name?: string | null;
  ad_name?: string | null;
  amount_spent?: number | string | null;
  cost?: number | string | null;
  ctr?: number | string | null;
  clicks?: number | string | null;
  cpc?: number | string | null;
  cpm?: number | string | null;
  conversions?: number | string | null;
  creative?: {
    body?: string | null;
    call_to_action?: string | null;
    headline?: string | null;
    image_url?: string | null;
    video_url?: string | null;
  } | null;
  date_start: string;
  date_stop: string;
  delivery_info?: {
    status?: string | null;
  } | null;
  external_ad_id?: string | null;
  impressions?: number | string | null;
  persona_data?: unknown;
  platform?: string | null;
  reach?: number | string | null;
  roas?: number | string | null;
  spend?: number | string | null;
  start_time?: string | null;
  status?: string | null;
  total_cost?: number | string | null;
  total_clicks?: number | string | null;
  targeting?: {
    interests?: string[] | null;
  } | null;
  created_at?: string | null;
}

interface ExternalAdGroupRecord {
  ads_external_ids?: string[] | null;
  description?: string | null;
  external_group_id?: string | null;
  group_name?: string | null;
  group_type?: string | null;
}

interface ExternalLeadField {
  name: string;
  values?: string[] | null;
}

interface ExternalLeadRecord {
  ad_id?: string | null;
  created_time?: string | null;
  field_data?: ExternalLeadField[] | null;
  form_id?: string | null;
  id: string;
}

interface ExternalConversationRecord {
  last_message_time?: string | null;
  messages?: ExternalConversationMessageRecord[] | null;
  page_id?: string | null;
  participant?: {
    id?: string | null;
    name?: string | null;
    profile_pic?: string | null;
  } | null;
  tags?: string[] | null;
  thread_id?: string | null;
  unread_count?: number | null;
}

interface ExternalConversationMessageRecord {
  from?: string | null;
  id?: string | null;
  text?: string | null;
  timestamp?: string | null;
}

interface SimulatedAdPayload {
  name?: string | null;
}

interface OrganicPostTemplate {
  clicks: number;
  content: string;
  daysOffset: number;
  hashtags: string[];
  impressions: number;
  postType: "carousel" | "image" | "video";
  status: "published" | "scheduled";
  title: string;
}

interface CreateAdWithMirrorPostRpcPayload {
  p_team_id?: string;
  p_name?: string;
  p_status?: string | null;
  p_creative_type?: string | null;
  p_headline?: string | null;
  p_ad_copy?: string | null;
  p_call_to_action?: string | null;
  p_content?: string | null;
  p_media_urls?: string[] | null;
  p_scheduled_at?: string | null;
  p_ad_group_id?: string | null;
  p_platform_id?: string | null;
  p_creative_url?: string | null;
  p_platform_ad_id?: string | null;
  p_preview_url?: string | null;
  p_budget?: number | null;
}

interface InsertedPersonaRecord {
  custom_fields: unknown;
  id: string;
}

const SYNTHETIC_ORGANIC_POSTS_BY_PLATFORM: Record<string, OrganicPostTemplate[]> = {
  facebook: [
    {
      title: "5 Tips for Digital Marketing That Actually Convert",
      content: "Want stronger campaign performance this quarter? Start with sharper audience segments, stronger hooks, and creative that matches buyer intent from the first scroll.",
      postType: "carousel",
      status: "published",
      daysOffset: 12,
      impressions: 18400,
      clicks: 742,
      hashtags: ["#DigitalMarketing", "#GrowthStrategy", "#Buzzly"],
    },
    {
      title: "Our New Spring Collection Is Live",
      content: "The Spring Collection is now available with lighter colors, faster shipping, and limited launch bundles for repeat customers across every channel.",
      postType: "image",
      status: "published",
      daysOffset: 7,
      impressions: 22600,
      clicks: 918,
      hashtags: ["#SpringCollection", "#NewArrival", "#ShopOnline"],
    },
    {
      title: "Why Buzzly Helps Teams Move Faster",
      content: "Buzzly brings paid and organic performance into one workflow so teams can spot winners faster, tighten spend, and publish with confidence.",
      postType: "video",
      status: "scheduled",
      daysOffset: 2,
      impressions: 15600,
      clicks: 611,
      hashtags: ["#MarketingOps", "#Analytics", "#Buzzly"],
    },
  ],
  instagram: [
    {
      title: "Behind the Scenes: Spring Launch Prep",
      content: "From moodboards to final creatives, here is how the team built a launch that feels premium, fast, and unmistakably on-brand.",
      postType: "video",
      status: "published",
      daysOffset: 10,
      impressions: 19800,
      clicks: 884,
      hashtags: ["#BehindTheScenes", "#BrandLaunch", "#CreativeTeam"],
    },
    {
      title: "3 Content Formats Driving Better Reach This Month",
      content: "Carousels, UGC clips, and short educational posts are leading the way for reach and saves right now. Here is how to use each one effectively.",
      postType: "carousel",
      status: "published",
      daysOffset: 5,
      impressions: 24100,
      clicks: 1035,
      hashtags: ["#ContentStrategy", "#SocialGrowth", "#InstagramMarketing"],
    },
    {
      title: "Weekend Offer Preview",
      content: "This weekend we are highlighting best sellers, exclusive bundles, and a limited free-shipping window for high-intent shoppers.",
      postType: "image",
      status: "scheduled",
      daysOffset: 1,
      impressions: 14900,
      clicks: 563,
      hashtags: ["#WeekendPromo", "#ShopNow", "#BrandStory"],
    },
  ],
  tiktok: [
    {
      title: "3 Hooks That Stop the Scroll",
      content: "Fast cuts, bold claims, and product-in-action intros are still winning attention. Here are three proven hooks your team can test this week.",
      postType: "video",
      status: "published",
      daysOffset: 9,
      impressions: 28700,
      clicks: 1344,
      hashtags: ["#TikTokMarketing", "#CreativeTesting", "#ShortFormVideo"],
    },
    {
      title: "Customer Favorites This Week",
      content: "These are the products customers keep coming back for, with quick demos, social proof, and clear value messaging built into every frame.",
      postType: "video",
      status: "published",
      daysOffset: 4,
      impressions: 25200,
      clicks: 1181,
      hashtags: ["#CustomerFavorites", "#ProductDemo", "#Buzzly"],
    },
    {
      title: "Why Consistent Posting Still Wins",
      content: "The best-performing brands are not guessing. They post on a rhythm, learn from retention, and double down on the formats that keep viewers watching.",
      postType: "carousel",
      status: "scheduled",
      daysOffset: 2,
      impressions: 17300,
      clicks: 722,
      hashtags: ["#OrganicGrowth", "#SocialStrategy", "#MarketingTips"],
    },
  ],
  shopee: [
    {
      title: "Top Picks for Fast-Moving Catalogs",
      content: "Here are the listings, bundles, and price points driving faster checkouts in high-volume storefronts this week.",
      postType: "image",
      status: "published",
      daysOffset: 8,
      impressions: 16100,
      clicks: 708,
      hashtags: ["#ShopeeSeller", "#EcommerceGrowth", "#TopPicks"],
    },
    {
      title: "How to Improve PDP Conversion in 3 Steps",
      content: "Sharper hero images, clearer benefit bullets, and promotion timing are making a measurable difference in catalog conversion.",
      postType: "carousel",
      status: "published",
      daysOffset: 3,
      impressions: 14200,
      clicks: 622,
      hashtags: ["#ProductPage", "#ConversionRate", "#EcommerceTips"],
    },
    {
      title: "Upcoming Payday Campaign Preview",
      content: "We are preparing a payday push focused on bundles, urgency messaging, and lower-friction offers for repeat buyers.",
      postType: "image",
      status: "scheduled",
      daysOffset: 1,
      impressions: 11800,
      clicks: 491,
      hashtags: ["#PaydaySale", "#MarketplaceMarketing", "#ShopeeAds"],
    },
  ],
  google: [
    {
      title: "Search Demand Is Shifting: Here Is What Matters",
      content: "Query intent is becoming more specific, so landing pages, message match, and offer clarity matter even more than volume.",
      postType: "carousel",
      status: "published",
      daysOffset: 11,
      impressions: 12900,
      clicks: 538,
      hashtags: ["#SearchMarketing", "#DemandGen", "#Performance"],
    },
    {
      title: "Why High-Intent Keywords Need Better Creative Support",
      content: "Paid search performs best when creative, offer structure, and remarketing work together instead of in isolation.",
      postType: "image",
      status: "published",
      daysOffset: 6,
      impressions: 13700,
      clicks: 601,
      hashtags: ["#GoogleAds", "#MarketingStrategy", "#LeadGen"],
    },
    {
      title: "Next Month's Demand Capture Plan",
      content: "The next phase focuses on cleaner segmentation, tighter budgets, and remarketing sequences built around top-performing themes.",
      postType: "video",
      status: "scheduled",
      daysOffset: 2,
      impressions: 10400,
      clicks: 412,
      hashtags: ["#DemandCapture", "#GrowthPlan", "#Buzzly"],
    },
  ],
};

function enrichMetricFields<T extends object>(record: T): T & {
  clicks: number;
  impressions: number;
  spend: number;
  total_cost: number;
} {
  const metricRecord = record as Record<string, unknown>;
  const spend = toFiniteNumber(
    metricRecord.spend as number | string | null | undefined,
    metricRecord.total_cost as number | string | null | undefined,
    metricRecord.cost as number | string | null | undefined,
    metricRecord.amount_spent as number | string | null | undefined
  );
  const clicks = toFiniteNumber(
    metricRecord.clicks as number | string | null | undefined,
    metricRecord.total_clicks as number | string | null | undefined
  );
  const impressions = toFiniteNumber(metricRecord.impressions as number | string | null | undefined);

  return {
    ...record,
    clicks,
    impressions,
    spend,
    total_cost: spend,
  };
}

function buildSyntheticOrganicPosts(params: {
  adGroupIds: string[];
  platform: string;
  platformId: string | null;
  tenant: string;
  workspaceId: string;
}) {
  const { adGroupIds, platform, platformId, tenant, workspaceId } = params;
  const templates = SYNTHETIC_ORGANIC_POSTS_BY_PLATFORM[platform] ?? SYNTHETIC_ORGANIC_POSTS_BY_PLATFORM.facebook;
  const brandLabel = tenant === "shop-b" ? "Buzzly Beauty" : "Buzzly";

  return templates.map((template, index) => {
    const timestamp = new Date();
    timestamp.setUTCDate(timestamp.getUTCDate() - template.daysOffset);
    timestamp.setUTCHours(9 + index * 2, 0, 0, 0);

    const scheduledAt = timestamp.toISOString();
    const publishedAt = template.status === "published" ? timestamp.toISOString() : null;
    const impressions = template.impressions + index * 320;
    const clicks = template.clicks + index * 17;
    const likes = Math.max(24, Math.round(impressions * (0.035 + index * 0.002)));
    const comments = Math.max(6, Math.round(clicks * 0.12));
    const shares = Math.max(3, Math.round(comments * 0.55));
    const reach = Math.max(clicks, Math.round(impressions * 0.74));

    return {
      team_id: workspaceId,
      platform_id: platformId,
      ad_group_id: adGroupIds.length > 0 ? adGroupIds[index % adGroupIds.length] : null,
      post_channel: "social",
      post_type: template.postType,
      platform_post_id: `organic-${tenant}-${platform}-${index + 1}`,
      name: template.title,
      content: `${template.content} ${brandLabel} is using this post to keep awareness and conversions moving together.`,
      published_at: publishedAt,
      scheduled_at: scheduledAt,
      status: template.status,
      impressions,
      clicks,
      click_count: clicks,
      likes,
      comments,
      shares,
      reach,
      engagement_rate: impressions > 0 ? parseFloat(((clicks / impressions) * 100).toFixed(2)) : 0,
      hashtags: template.hashtags,
    };
  });
}

function normalizeIsoString(value?: string | null, fallback?: string | null): string | null {
  if (!value) {
    return fallback ?? null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback ?? null;
  }

  return parsed.toISOString();
}

function inferMessageSentiment(text?: string | null): "positive" | "negative" | "neutral" {
  const normalized = (text ?? "").toLowerCase();

  if (
    /(ขอบคุณ|thank|great|perfect|love|ยอดเยี่ยม|ดีมาก|awesome|excellent)/i.test(normalized)
  ) {
    return "positive";
  }

  if (
    /(complaint|problem|issue|delay|ไม่ได้|เสีย|refund|อีเมลยืนยัน|not received|spam)/i.test(normalized)
  ) {
    return "negative";
  }

  return "neutral";
}

function isMessageReplied(
  messages: ExternalConversationMessageRecord[],
  index: number
): boolean {
  const current = messages[index];
  if (current.from !== "user") {
    return false;
  }

  return messages.slice(index + 1).some((message) => message.from === "page");
}

function getJsonStringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const fieldValue = (value as Record<string, unknown>)[key];
  return typeof fieldValue === "string" ? fieldValue : null;
}

function logIngestionWarning(
  message: string,
  error: unknown,
  details?: Record<string, unknown>,
) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.warn("[/api/connect]", message, { ...details, error: errorMessage });
}

async function saveAdRecord(params: {
  ad: ExternalAdRecord;
  adGroupId?: string | null;
  platform: string;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const { ad, adGroupId = null, platform, supabase, workspaceId } = params;
  const adPayload = {
    ad_copy: ad.creative?.body ?? null,
    ad_group_id: adGroupId,
    call_to_action: ad.creative?.call_to_action?.replace(/_/g, " ") ?? null,
    creative_type: ad.creative?.video_url ? "video" : "image",
    headline: ad.creative?.headline ?? null,
    media_urls: [ad.creative?.image_url, ad.creative?.video_url].filter(
      (url): url is string => Boolean(url)
    ),
    team_id: workspaceId,
    name: ad.ad_name ?? "Untitled Ad",
    status: ad.status === "ACTIVE" ? "active" : "paused",
    platform,
    platform_ad_id: ad.external_ad_id ?? null,
    external_status: "published",
    persona_data: ad.persona_data ?? null,
    content: ad.targeting?.interests?.length
      ? `Target interests: ${ad.targeting.interests.join(", ")}`
      : null,
  };

  try {
    if (ad.external_ad_id) {
      const { data: existingAd, error: existingAdError } = await supabase
        .from("ads")
        .select("id")
        .eq("team_id", workspaceId)
        .eq("platform", platform)
        .eq("platform_ad_id", ad.external_ad_id)
        .maybeSingle();

      if (existingAdError) {
        throw existingAdError;
      }

      if (existingAd?.id) {
        const { data: updatedAd, error: updateError } = await supabase
          .from("ads")
          .update(adPayload)
          .eq("id", existingAd.id)
          .select("id")
          .single();

        if (updateError) {
          throw updateError;
        }

        return updatedAd?.id ?? null;
      }
    }

    const { data: insertedAd, error: insertError } = await supabase
      .from("ads")
      .insert(adPayload)
      .select("id")
      .single();

    if (insertError) {
      throw insertError;
    }

    return insertedAd?.id ?? null;
  } catch (error) {
    logIngestionWarning("ad save failed", error, {
      adName: ad.ad_name ?? null,
      externalAdId: ad.external_ad_id ?? null,
      platform,
      workspaceId,
    });
    return null;
  }
}

async function saveAdGroupRecord(params: {
  group: ExternalAdGroupRecord;
  platform: string;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const { group, platform, supabase, workspaceId } = params;
  const groupName = group.group_name?.trim();

  if (!groupName) {
    return null;
  }

  const groupPayload = {
    name: groupName,
    description: group.description ?? null,
    group_type: group.group_type ?? null,
    source_platform: platform,
    external_group_id: group.external_group_id ?? null,
    status: "active",
    team_id: workspaceId,
    updated_at: new Date().toISOString(),
  };

  try {
    if (group.external_group_id) {
      const { data: existingGroup, error: existingGroupError } = await supabase
        .from("ad_groups")
        .select("id")
        .eq("team_id", workspaceId)
        .eq("source_platform", platform)
        .eq("external_group_id", group.external_group_id)
        .maybeSingle();

      if (existingGroupError) {
        throw existingGroupError;
      }

      if (existingGroup?.id) {
        const { data: updatedGroup, error: updateError } = await supabase
          .from("ad_groups")
          .update(groupPayload)
          .eq("id", existingGroup.id)
          .select("id")
          .single();

        if (updateError) {
          throw updateError;
        }

        return updatedGroup?.id ?? null;
      }
    }

    const { data: existingManualGroup, error: existingManualGroupError } = await supabase
      .from("ad_groups")
      .select("id")
      .eq("team_id", workspaceId)
      .eq("name", groupName)
      .maybeSingle();

    if (existingManualGroupError) {
      throw existingManualGroupError;
    }

    if (existingManualGroup?.id) {
      const { data: updatedGroup, error: updateError } = await supabase
        .from("ad_groups")
        .update(groupPayload)
        .eq("id", existingManualGroup.id)
        .select("id")
        .single();

      if (updateError) {
        throw updateError;
      }

      return updatedGroup?.id ?? null;
    }

    const { data: insertedGroup, error: insertError } = await supabase
      .from("ad_groups")
      .insert(groupPayload)
      .select("id")
      .single();

    if (insertError) {
      throw insertError;
    }

    return insertedGroup?.id ?? null;
  } catch (error) {
    logIngestionWarning("ad group save failed", error, {
      groupName,
      externalGroupId: group.external_group_id ?? null,
      platform,
      workspaceId,
    });
    return null;
  }
}

async function saveCampaignRecord(params: {
  adAccountId: string;
  name: string;
  objective?: string | null;
  startDate: string;
  endDate: string;
  supabase: SupabaseClient;
  workspaceId: string;
}): Promise<string | null> {
  const { adAccountId, name, objective = "CONVERSIONS", startDate, endDate, supabase, workspaceId } = params;

  try {
    const { data, error } = await supabase
      .from("campaigns")
      .insert({
        team_id: workspaceId,
        ad_account_id: adAccountId,
        name,
        status: "active",
        objective,
        start_date: startDate,
        end_date: endDate,
      })
      .select("id")
      .single();

    if (error) {
      throw error;
    }

    return (data?.id as string | undefined) ?? null;
  } catch (error) {
    logIngestionWarning("campaign save failed", error, {
      campaignName: name,
      adAccountId,
      workspaceId,
    });
    return null;
  }
}

async function resolvePlatformId(supabase: SupabaseClient, platformSlug: string) {
  const { data, error } = await supabase
    .from("platforms")
    .select("id")
    .eq("slug", platformSlug)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.id ?? null;
}

function resolveAdPublishedAt(ad: ExternalAdRecord): string {
  const rawTimestamp = ad.start_time ?? ad.created_at ?? null;

  if (rawTimestamp) {
    const parsed = new Date(rawTimestamp);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  if (ad.date_start) {
    const parsed = new Date(`${ad.date_start}T09:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

function toFiniteNumber(...values: Array<number | string | null | undefined>): number {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

async function upsertSyncedAdPost(params: {
  ad: ExternalAdRecord;
  adId: string;
  adGroupId?: string | null;
  dateShiftMs?: number;
  platformId: string | null;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const { ad, adGroupId = null, adId, dateShiftMs = 0, platformId, supabase, workspaceId } = params;
  const publishedAt = new Date(new Date(resolveAdPublishedAt(ad)).getTime() + dateShiftMs).toISOString();
  const impressions = toFiniteNumber(ad.impressions);
  const clicks = toFiniteNumber(ad.clicks, ad.total_clicks);
  const reach = toFiniteNumber(ad.reach);
  const engagementRate = impressions > 0 ? parseFloat(((clicks / impressions) * 100).toFixed(2)) : 0;

  console.log("[upsertSyncedAdPost] date resolution:", {
    adName: ad.ad_name ?? "unknown",
    externalAdId: ad.external_ad_id ?? "unknown",
    raw_start_time: ad.start_time ?? null,
    raw_created_at: ad.created_at ?? null,
    raw_date_start: ad.date_start ?? null,
    resolved_published_at: publishedAt,
  });

  const payload = {
    id: adId,
    team_id: workspaceId,
    platform_id: platformId,
    ad_group_id: adGroupId,
    post_channel: "ad",
    post_type: ad.creative?.video_url ? "video" : "image",
    platform_post_id: ad.external_ad_id ?? adId,
    name: ad.creative?.headline ?? ad.ad_name ?? "Untitled Ad",
    content: ad.creative?.body ?? null,
    media_urls: [ad.creative?.image_url, ad.creative?.video_url].filter(
      (url): url is string => Boolean(url)
    ),
    published_at: publishedAt,
    scheduled_at: publishedAt,
    status: ad.status === "ACTIVE" ? "active" : "paused",
    impressions,
    clicks,
    click_count: clicks,
    reach,
    engagement_rate: engagementRate,
  };

  const { error } = await supabase.from("social_posts").upsert(payload, { onConflict: "id" });

  if (error) {
    throw error;
  }

  return payload.id;
}

async function seedInboxThreads(params: {
  conversations: ExternalConversationRecord[];
  platformId: string | null;
  supabase: SupabaseClient;
  workspaceId: string;
}) {
  const { conversations, platformId, supabase, workspaceId } = params;
  const threadRows: Record<string, unknown>[] = [];
  const commentRows: Record<string, unknown>[] = [];

  for (const conversation of conversations.slice(0, 5)) {
    const threadMessages = (conversation.messages ?? [])
      .filter((message): message is ExternalConversationMessageRecord & { text: string } => Boolean(message.text))
      .sort((a, b) => {
        const aTime = new Date(a.timestamp ?? 0).getTime();
        const bTime = new Date(b.timestamp ?? 0).getTime();
        return aTime - bTime;
      });

    if (threadMessages.length === 0) {
      continue;
    }

    const lastMessageAt =
      normalizeIsoString(conversation.last_message_time, normalizeIsoString(threadMessages[threadMessages.length - 1]?.timestamp))
      ?? new Date().toISOString();
    const firstMessageAt =
      normalizeIsoString(threadMessages[0]?.timestamp, lastMessageAt)
      ?? lastMessageAt;
    const unreadCount = Math.max(0, Number(conversation.unread_count ?? 0));
    const threadId = crypto.randomUUID();
    const participantName = conversation.participant?.name?.trim() || "Social Customer";
    const previewText = threadMessages[threadMessages.length - 1]?.text ?? threadMessages[0]?.text ?? "";

    threadRows.push({
      id: threadId,
      team_id: workspaceId,
      platform_id: platformId,
      post_channel: "social",
      post_type: "chat",
      platform_post_id: conversation.thread_id ?? null,
      name: participantName,
      content: previewText,
      comments: threadMessages.length,
      created_at: firstMessageAt,
      updated_at: lastMessageAt,
      published_at: lastMessageAt,
      scheduled_at: firstMessageAt,
      status: "published",
    });

    const unreadStartIndex = Math.max(0, threadMessages.length - unreadCount);

    for (const [index, message] of threadMessages.entries()) {
      const createdAt =
        normalizeIsoString(message.timestamp, index === 0 ? firstMessageAt : lastMessageAt)
        ?? lastMessageAt;
      const isOutbound = message.from === "page";

      commentRows.push({
        id: crypto.randomUUID(),
        post_id: threadId,
        team_id: workspaceId,
        platform_id: platformId,
        platform_comment_id: message.id ?? null,
        author_name: isOutbound ? "You" : participantName,
        author_avatar_url: isOutbound ? null : conversation.participant?.profile_pic ?? null,
        author_platform_id: isOutbound
          ? "__outbound__"
          : conversation.participant?.id ?? conversation.thread_id ?? null,
        content: message.text,
        sentiment: isOutbound ? null : inferMessageSentiment(message.text),
        is_read: isOutbound ? true : index < unreadStartIndex,
        is_replied: isOutbound ? false : isMessageReplied(threadMessages, index),
        replied_at: null,
        reply_content: null,
        created_at: createdAt,
        updated_at: createdAt,
      });
    }
  }

  if (threadRows.length === 0) {
    return { threadsInserted: 0, commentsInserted: 0 };
  }

  const { error: threadError } = await supabase.from("social_posts").insert(threadRows);
  if (threadError) {
    throw threadError;
  }

  if (commentRows.length > 0) {
    const { error: commentError } = await supabase.from("social_comments").insert(commentRows);
    if (commentError) {
      throw commentError;
    }
  }

  return {
    threadsInserted: threadRows.length,
    commentsInserted: commentRows.length,
  };
}

// ─── Facebook Endpoints ──────────────────────────────────────────────
app.get("/facebook/:tenant/insights", (req, res) => {
  const payload = loadFixture("facebook", req.params.tenant, "insights");
  const rows = Array.isArray(payload.data) ? payload.data.map((row: Record<string, unknown>) => enrichMetricFields(row)) : [];
  res.json({ ...payload, data: rows });
});

app.get("/facebook/:tenant/leads", (req, res) => {
  res.json(loadFixture("facebook", req.params.tenant, "leads"));
});

app.get("/facebook/:tenant/ads", (req, res) => {
  const payload = loadFixture("facebook", req.params.tenant, "ads");
  const rows = Array.isArray(payload.data) ? payload.data.map((row: Record<string, unknown>) => enrichMetricFields(row)) : [];
  res.json({ ...payload, data: rows });
});

app.get("/facebook/:tenant/chats", (req, res) => {
  res.json(loadFixture("facebook", req.params.tenant, "chats"));
});

// ─── Instagram Endpoints ─────────────────────────────────────────────
app.get("/instagram/:tenant/ads", (req, res) => {
  const payload = loadFixture("instagram", req.params.tenant, "ads");
  const rows = Array.isArray(payload.data) ? payload.data.map((row: Record<string, unknown>) => enrichMetricFields(row)) : [];
  res.json({ ...payload, data: rows });
});

// ─── TikTok Endpoints ────────────────────────────────────────────────
app.get("/tiktok/:tenant/ads", (req, res) => {
  const payload = loadFixture("tiktok", req.params.tenant, "ads");
  const rows = Array.isArray(payload.data) ? payload.data.map((row: Record<string, unknown>) => enrichMetricFields(row)) : [];
  res.json({ ...payload, data: rows });
});

// ─── Shopee Endpoints ────────────────────────────────────────────────
app.get("/shopee/:tenant/orders/list", (req, res) => {
  res.json(loadFixture("shopee", req.params.tenant, "orders"));
});

app.get("/shopee/:tenant/marketing/shop_performance", (req, res) => {
  res.json(loadFixture("shopee", req.params.tenant, "performance"));
});

app.get("/shopee/:tenant/ads", (req, res) => {
  const payload = loadFixture("shopee", req.params.tenant, "ads");
  const rows = Array.isArray(payload.data) ? payload.data.map((row: Record<string, unknown>) => enrichMetricFields(row)) : [];
  res.json({ ...payload, data: rows });
});

// ─── Google Endpoints ────────────────────────────────────────────────
app.get("/google/:tenant/ads", (req, res) => {
  const payload = loadFixture("google", req.params.tenant, "ads");
  const rows = Array.isArray(payload.data) ? payload.data.map((row: Record<string, unknown>) => enrichMetricFields(row)) : [];
  res.json({ ...payload, data: rows });
});

// ─── Validate API Key ────────────────────────────────────────────────
app.post("/validate-key", (req, res) => {
  const { apiKey, platformSlug } = req.body as { apiKey?: string; platformSlug?: string };
  if (!apiKey) {
    res.status(400).json({ valid: false, error: "apiKey is required" });
    return;
  }
  const match = MOCK_API_KEYS[apiKey.trim()];
  if (!match) {
    res.json({ valid: false, error: "Unknown API key" });
    return;
  }
  // Optional: reject if key is for a different platform
  if (platformSlug && match.platform !== platformSlug) {
    res.json({ valid: false, error: `This key is for '${match.platform}', not '${platformSlug}'` });
    return;
  }
  res.json({ valid: true, tenant: match.tenant, platform: match.platform, shopLabel: match.shopLabel });
});

// ─── Backend Ingestion Endpoint ───────────────────────────────────────
// Validates the API key, fetches the full platform dataset (ads, leads),
// and writes everything to Supabase with the correct team_id so
// the frontend's workspace-scoped queries can find the records.
// Raw external data never leaves the server.
app.post("/api/connect", async (req, res) => {
  const { apiKey, platformSlug, workspaceId, adAccountId } = req.body as {
    apiKey?: string;
    platformSlug?: string;
    workspaceId?: string;
    adAccountId?: string;
  };

  if (!apiKey || !workspaceId || !adAccountId) {
    res.status(400).json({ error: "apiKey, workspaceId, and adAccountId are required" });
    return;
  }

  // 1. Validate API key
  const keyInfo = MOCK_API_KEYS[apiKey.trim()];
  if (!keyInfo) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }
  if (platformSlug && keyInfo.platform !== platformSlug) {
    res.status(401).json({
      error: `This key is for '${keyInfo.platform}', not '${platformSlug}'`,
    });
    return;
  }

  const tenant = keyInfo.tenant;
  const platform = keyInfo.platform;

  try {
    const supabase = getSupabaseClient();
    const platformId = await resolvePlatformId(supabase, platform);

    // 2. Fetch ads and (for Facebook) leads + inbox chats in parallel
    const [adsRes, leadsRes, chatsRes] = await Promise.all([
      fetch(`${EXTERNAL_API_BASE_URL}/${platform}/${tenant}/ads`),
      platform === "facebook"
        ? fetch(`${EXTERNAL_API_BASE_URL}/facebook/${tenant}/leads`)
        : Promise.resolve(null),
      platform === "facebook"
        ? fetch(`${EXTERNAL_API_BASE_URL}/facebook/${tenant}/chats`)
        : Promise.resolve(null),
    ]);

    if (!adsRes.ok) throw new Error(`Ads endpoint responded with ${adsRes.status}`);
    const rawAdsPayload = (await adsRes.json()) as {
      ad_groups?: ExternalAdGroupRecord[];
      data?: ExternalAdRecord[];
      groups?: ExternalAdGroupRecord[];
    };
    const adsPayload: {
      ad_groups?: ExternalAdGroupRecord[];
      data: ExternalAdRecord[];
      groups?: ExternalAdGroupRecord[];
    } = {
      ...rawAdsPayload,
      data: (rawAdsPayload.data ?? []).map((ad) => enrichMetricFields(ad) as ExternalAdRecord),
    };
    const adsData = adsPayload.data ?? [];
    const externalGroups = adsPayload.ad_groups ?? adsPayload.groups ?? [];

    const leadsData: ExternalLeadRecord[] = leadsRes?.ok
      ? ((await leadsRes.json()) as { data?: ExternalLeadRecord[] }).data ?? []
      : [];
    const conversationsData: ExternalConversationRecord[] = chatsRes?.ok
      ? ((await chatsRes.json()) as { conversations?: ExternalConversationRecord[] }).conversations ?? []
      : [];

    // 3. Clear stale data for this workspace + platform (full-replace sync)
    //
    // A sync may only delete what a sync wrote. `ad_accounts` is
    // UNIQUE (team_id, platform_id), so a file import has no account of its
    // own — `resolve_ad_account` must adopt the one the merchant connected, and
    // imported rows therefore sit on exactly the `adAccountId` being replaced
    // here. Scoping these deletes by account alone would make re-connecting a
    // platform destroy every row the merchant uploaded, silently and with no
    // way back: the pipeline records the file as imported, so `hash_dedupe`
    // would refuse to re-ingest it.
    //
    // This is the contract the real platform ingestion inherits when it
    // replaces this mock, so the rule is stated once here: full-replace means
    // full replacement of THIS SOURCE, never of the account.
    // 'mock', not 'api', since 20260812060000 renamed this writer's rows. This
    // line has to move with the label: a full-replace sync that matches nothing
    // does not degrade quietly — the insert that follows hits the
    // (ad_account_id, ads_id, date) unique index and the whole connect fails.
    // It also must not widen to 'meta_live': a mock re-sync deleting real Meta
    // rows is the same "a sync may only delete what a sync wrote" violation the
    // note above is about.
    await supabase
      .from("ad_insights")
      .delete()
      .eq("ad_account_id", adAccountId)
      .eq("data_source", "mock");

    // Ads carry their origin in `platform_ad_id` (`import:<uuid>`, stamped by
    // targets.py). The NULL branch is not optional: `not.like` on a NULL column
    // yields NULL, which PostgREST drops from the result, so an API-synced ad
    // that never got an external id would survive every future sync and
    // accumulate. Today Meta escapes this delete only because the import writes
    // `platform = 'meta'` while the sync writes the slug `facebook` — an
    // accident of naming, not a safeguard, and TikTok collides on both sides.
    await supabase
      .from("ads")
      .delete()
      .eq("team_id", workspaceId)
      .eq("platform", platform)
      .or("platform_ad_id.is.null,platform_ad_id.not.like.import:*");

    // Campaigns are the one table with no origin marker — both sources write a
    // plain row — so ownership is derived instead: a campaign an imported
    // insight points at belongs to the import. Deriving it beats adding a
    // column here, because the same query also protects campaigns the merchant
    // built by hand in the Campaign Builder and then attached uploaded data to.
    const { data: importedCampaigns } = await supabase
      .from("ad_insights")
      .select("campaign_id")
      .eq("ad_account_id", adAccountId)
      .eq("data_source", "import")
      .not("campaign_id", "is", null);

    const preservedCampaignIds = [
      ...new Set((importedCampaigns ?? []).map((r) => r.campaign_id as string)),
    ];

    // Remove previously synced campaigns for this connection (campaign_ads cascade-delete).
    let campaignDelete = supabase
      .from("campaigns")
      .delete()
      .eq("team_id", workspaceId)
      .eq("ad_account_id", adAccountId);
    if (preservedCampaignIds.length > 0) {
      // The empty case is skipped rather than relying on `in.()`. PostgREST
      // does accept it today (checked against this project's instance, where
      // it correctly matches every row), but an empty IN list is a shape worth
      // not depending on, and "nothing to preserve" reads better as no filter.
      campaignDelete = campaignDelete.not("id", "in", `(${preservedCampaignIds.join(",")})`);
    }
    await campaignDelete;
    if (platformId) {
      await supabase
        .from("social_posts")
        .delete()
        .eq("team_id", workspaceId)
        .eq("post_channel", "ad")
        .eq("platform_id", platformId)
        .not("platform_post_id", "is", null);
    }
    if (platform === "facebook") {
      // Remove previously synced legacy chat rows so they never appear as organic content again
      const { data: existingChatPosts, error: existingChatPostsError } = await supabase
        .from("social_posts")
        .select("id")
        .eq("team_id", workspaceId)
        .eq("platform_id", platformId)
        .eq("post_channel", "social")
        .eq("post_type", "chat");

      if (existingChatPostsError) {
        throw existingChatPostsError;
      }

      const existingChatPostIds = (existingChatPosts ?? []).map((post) => post.id);
      if (existingChatPostIds.length > 0) {
        const { error: existingCommentsError } = await supabase
          .from("social_comments")
          .delete()
          .eq("team_id", workspaceId)
          .in("post_id", existingChatPostIds);

        if (existingCommentsError) {
          throw existingCommentsError;
        }
      }

      await supabase
        .from("social_posts")
        .delete()
        .eq("team_id", workspaceId)
        .eq("platform_id", platformId)
        .eq("post_channel", "social")
        .eq("post_type", "chat");
    }
    if (platformId) {
      await supabase
        .from("social_posts")
        .delete()
        .eq("team_id", workspaceId)
        .eq("platform_id", platformId)
        .eq("post_channel", "social")
        .like("platform_post_id", `organic-${tenant}-${platform}-%`);
    }

    // 4. Upsert ads with team_id and generate daily ad_insights.
    //    Ads are ingested as ORPHANS — not linked to any campaign.
    //    Users assign ads to campaigns in the Campaign Builder.
    const insightRows: Record<string, unknown>[] = [];
    const adIdByExternalId = new Map<string, string>();
    const adGroupIdByExternalId = new Map<string, string>();
    const adGroupIdByName = new Map<string, string>();

    for (const group of externalGroups) {
      const groupId = await saveAdGroupRecord({
        group,
        platform,
        supabase,
        workspaceId,
      });

      if (!groupId) {
        continue;
      }

      if (group.external_group_id) {
        adGroupIdByExternalId.set(group.external_group_id, groupId);
      }

      if (group.group_name) {
        adGroupIdByName.set(group.group_name, groupId);
      }
    }

    for (const group of externalGroups) {
      const resolvedGroupId = group.external_group_id
        ? adGroupIdByExternalId.get(group.external_group_id) ?? null
        : group.group_name
          ? adGroupIdByName.get(group.group_name) ?? null
          : null;

      if (!resolvedGroupId) {
        continue;
      }

      for (const externalAdId of group.ads_external_ids ?? []) {
        if (!externalAdId) {
          continue;
        }

        const matchingAd = adsData.find((ad) => ad.external_ad_id === externalAdId);
        if (matchingAd && !matchingAd.ad_group_external_id) {
          matchingAd.ad_group_external_id = group.external_group_id ?? null;
          matchingAd.ad_group_name = group.group_name ?? null;
        }
      }
    }

    // 4b. Create one campaign per ad_group (+ a lazy catch-all for ungrouped ads).
    //     useCampaigns aggregates metrics via campaign_ads → ad_insights.ads_id, so
    //     populating these tables makes /campaigns (and campaign-scoped analytics) render.
    const campaignWindowStart = new Date();
    campaignWindowStart.setUTCDate(campaignWindowStart.getUTCDate() - 45);
    const campaignWindowEnd = new Date();
    campaignWindowEnd.setUTCDate(campaignWindowEnd.getUTCDate() + 15);

    const distinctAdGroupIds = new Set<string>(
      [...adGroupIdByExternalId.values(), ...adGroupIdByName.values()].filter(
        (value): value is string => Boolean(value)
      )
    );
    const groupNameByDbId = new Map<string, string>();
    for (const [name, id] of adGroupIdByName.entries()) {
      if (!groupNameByDbId.has(id)) {
        groupNameByDbId.set(id, name);
      }
    }

    const campaignIdByAdGroupId = new Map<string, string>();
    for (const adGroupDbId of distinctAdGroupIds) {
      const campaignId = await saveCampaignRecord({
        adAccountId,
        name: groupNameByDbId.get(adGroupDbId) ?? "Imported Campaign",
        startDate: campaignWindowStart.toISOString(),
        endDate: campaignWindowEnd.toISOString(),
        supabase,
        workspaceId,
      });
      if (campaignId) {
        campaignIdByAdGroupId.set(adGroupDbId, campaignId);
      }
    }

    let catchAllCampaignId: string | null = null;
    const ensureCatchAllCampaign = async (): Promise<string | null> => {
      if (!catchAllCampaignId) {
        const platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1);
        catchAllCampaignId = await saveCampaignRecord({
          adAccountId,
          name: `${platformLabel} – Imported Ads`,
          startDate: campaignWindowStart.toISOString(),
          endDate: campaignWindowEnd.toISOString(),
          supabase,
          workspaceId,
        });
      }
      return catchAllCampaignId;
    };

    const campaignAdRows: { campaign_id: string; ad_id: string }[] = [];

    // Re-base fixture insight dates so the most recent flight ends today.
    // Fixtures are historical (e.g. Feb–Mar), so default short date windows render
    // empty; shifting every row by the same delta preserves relative spacing.
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    let maxStopMs = Number.NEGATIVE_INFINITY;
    for (const ad of adsData) {
      const stopMs = new Date(ad.date_stop ?? ad.date_start ?? "").getTime();
      if (Number.isFinite(stopMs)) {
        maxStopMs = Math.max(maxStopMs, stopMs);
      }
    }
    const dateShiftMs = Number.isFinite(maxStopMs) ? todayUtc.getTime() - maxStopMs : 0;

    for (const ad of adsData) {
      const adGroupId =
        (ad.ad_group_external_id
          ? adGroupIdByExternalId.get(ad.ad_group_external_id)
          : undefined) ??
        (ad.ad_group_name ? adGroupIdByName.get(ad.ad_group_name) : undefined) ??
        null;

      const adId = await saveAdRecord({
        ad,
        adGroupId,
        platform,
        supabase,
        workspaceId,
      });

      if (!adId) {
        console.warn("[/api/connect] skipping ad_insights for unsaved ad", {
          adName: ad.ad_name ?? null,
          externalAdId: ad.external_ad_id ?? null,
        });
        continue;
      }

      if (ad.external_ad_id) {
        adIdByExternalId.set(ad.external_ad_id, adId);
      }

      const campaignId =
        (adGroupId ? campaignIdByAdGroupId.get(adGroupId) ?? null : null) ??
        (await ensureCatchAllCampaign());

      if (campaignId) {
        campaignAdRows.push({ campaign_id: campaignId, ad_id: adId });
      }

      await upsertSyncedAdPost({
        ad,
        adId,
        adGroupId,
        dateShiftMs,
        platformId,
        supabase,
        workspaceId,
      });

      const totalImpressions = toFiniteNumber(ad.impressions);
      const totalClicks = Math.max(1, toFiniteNumber(ad.clicks, ad.total_clicks));
      const totalSpend = Math.max(1, toFiniteNumber(ad.spend, ad.total_cost, ad.cost, ad.amount_spent));
      const totalReach = toFiniteNumber(ad.reach);
      const totalConversions = toFiniteNumber(ad.conversions);

      // Spread totals evenly over the flight window with light jitter
      const startDate = new Date(new Date(ad.date_start).getTime() + dateShiftMs);
      const endDate = new Date(new Date(ad.date_stop).getTime() + dateShiftMs);
      const totalDays = Math.max(
        1,
        Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1
      );

      for (let d = 0; d < totalDays; d++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + d);
        const jitter = 0.7 + Math.random() * 0.6;
        const dailyImpressions = Math.round((totalImpressions / totalDays) * jitter);
        const dailyClicks = Math.max(1, Math.round((totalClicks / totalDays) * jitter));
        const dailySpend = Math.max(0.25, parseFloat(((totalSpend / totalDays) * jitter).toFixed(2)));
        const dailyReach = Math.round((totalReach / totalDays) * jitter);
        const dailyConversions = Math.round((totalConversions / totalDays) * jitter);

        insightRows.push({
          ad_account_id: adAccountId,
          campaign_id: campaignId,
          ads_id: adId,
          date: date.toISOString().split("T")[0],
          impressions: dailyImpressions,
          clicks: dailyClicks,
          spend: dailySpend,
          reach: dailyReach,
          conversions: dailyConversions,
          ctr: dailyImpressions > 0 ? parseFloat(((dailyClicks / dailyImpressions) * 100).toFixed(2)) : toFiniteNumber(ad.ctr),
          cpc: parseFloat((dailySpend / dailyClicks).toFixed(4)),
          cpm: dailyImpressions > 0 ? parseFloat(((dailySpend / dailyImpressions) * 1000).toFixed(2)) : toFiniteNumber(ad.cpm),
          roas: toFiniteNumber(ad.roas),
          // Stated, never left to the column DEFAULT. Every number above is
          // derived from a fixture and a Math.random() jitter, so the row has
          // to say so: once a real Meta connector writes 'meta_live' into the
          // same table, an unlabelled row is indistinguishable from money that
          // was actually spent. See 20260812060000.
          data_source: "mock",
        });
      }
    }

    if (campaignAdRows.length > 0) {
      const { error: campaignAdsError } = await supabase
        .from("campaign_ads")
        .upsert(campaignAdRows, { onConflict: "campaign_id,ad_id" });
      if (campaignAdsError) {
        logIngestionWarning("campaign_ads upsert failed", campaignAdsError, {
          linkCount: campaignAdRows.length,
        });
      }
    }

    if (insightRows.length > 0) {
      const { error: insertError } = await supabase.from("ad_insights").insert(insightRows);
      if (insertError) throw insertError;
    }

    // 5. Upsert Facebook leads as customer_personas
    let personasInserted = 0;
    let personaLinksInserted = 0;
    let insertedPersonas: InsertedPersonaRecord[] = [];
    if (leadsData.length > 0) {
      const getField = (lead: ExternalLeadRecord, name: string): string | null =>
        lead.field_data?.find((field) => field.name === name)?.values?.[0] ?? null;

      const personaRows = leadsData.map((lead) => ({
        team_id: workspaceId,
        persona_name: getField(lead, "full_name") ?? `Lead ${lead.id}`,
        description: getField(lead, "company_name"),
        profession: getField(lead, "company_name"),
        is_active: true,
        is_template: false,
        custom_fields: {
          source: "facebook_lead_ad",
          lead_id: lead.id,
          email: getField(lead, "email"),
          phone: getField(lead, "phone_number"),
          form_id: lead.form_id ?? null,
          ad_id: lead.ad_id ?? null,
          created_time: lead.created_time ?? null,
        },
      }));

      const { data: createdPersonas, error: personaError } = await supabase
        .from("customer_personas")
        .insert(personaRows)
        .select("id, custom_fields");
      if (personaError) {
        console.warn("[/api/connect] personas insert warn:", personaError.message);
      } else {
        insertedPersonas = (createdPersonas ?? []) as InsertedPersonaRecord[];
        personasInserted = insertedPersonas.length;
      }
    }

    // 6. Link synced ads to newly inserted personas so persona insights can join data
    if (insertedPersonas.length > 0) {
      const fallbackLeadAdIds = adsData
        .filter((ad) => /lead|signup|trial|form/i.test(ad.ad_name ?? ""))
        .map((ad) => (ad.external_ad_id ? adIdByExternalId.get(ad.external_ad_id) : null))
        .filter((adId): adId is string => Boolean(adId));

      const linkKeySet = new Set<string>();
      const adPersonaRows: { ad_id: string; persona_id: string }[] = [];

      for (const persona of insertedPersonas) {
        const sourceAdId = getJsonStringField(persona.custom_fields, "ad_id");
        const directAdId = sourceAdId ? adIdByExternalId.get(sourceAdId) ?? null : null;
        const candidateAdIds = (directAdId ? [directAdId] : fallbackLeadAdIds).filter(
          (adId): adId is string => Boolean(adId)
        );

        for (const adId of candidateAdIds) {
          const linkKey = `${adId}:${persona.id}`;
          if (linkKeySet.has(linkKey)) {
            continue;
          }

          linkKeySet.add(linkKey);
          adPersonaRows.push({ ad_id: adId, persona_id: persona.id });
        }
      }

      if (adPersonaRows.length > 0) {
        const { error: adPersonaError } = await supabase
          .from("ad_personas")
          .upsert(adPersonaRows, { onConflict: "ad_id,persona_id" });

        if (adPersonaError) {
          logIngestionWarning("ad_personas upsert failed", adPersonaError, {
            personaCount: insertedPersonas.length,
            linkCount: adPersonaRows.length,
          });
        } else {
          personaLinksInserted = adPersonaRows.length;
        }
      }
    }

    // 7. Seed synthetic organic posts so analytics can compare paid vs organic without chat artifacts
    const adGroupIds = Array.from(
      new Set([
        ...adGroupIdByExternalId.values(),
        ...adGroupIdByName.values(),
      ].filter((value): value is string => Boolean(value)))
    );
    const organicRows = buildSyntheticOrganicPosts({
      adGroupIds,
      platform,
      platformId,
      tenant,
      workspaceId,
    });
    let organicPostsInserted = 0;
    if (organicRows.length > 0) {
      const { data: insertedOrganicPosts, error: organicError } = await supabase
        .from("social_posts")
        .insert(organicRows)
        .select("id");

      if (organicError) {
        console.warn("[/api/connect] organic posts insert warn:", organicError.message);
      } else {
        organicPostsInserted = insertedOrganicPosts?.length ?? 0;
      }
    }

    let inboxThreadsInserted = 0;
    let inboxCommentsInserted = 0;
    if (platform === "facebook" && conversationsData.length > 0) {
      const inboxSeedResult = await seedInboxThreads({
        conversations: conversationsData,
        platformId,
        supabase,
        workspaceId,
      });
      inboxThreadsInserted = inboxSeedResult.threadsInserted;
      inboxCommentsInserted = inboxSeedResult.commentsInserted;
    }

    // 8. Return summary — raw external data stays on the server
    res.json({
      message: "Data synced successfully",
      adGroupsUpserted: externalGroups.length,
      campaignsCreated: campaignIdByAdGroupId.size + (catchAllCampaignId ? 1 : 0),
      campaignAdsLinked: campaignAdRows.length,
      adsUpserted: adsData.length,
      rowsInserted: insightRows.length,
      personasInserted,
      personaLinksInserted,
      organicPostsInserted,
      inboxThreadsInserted,
      inboxCommentsInserted,
      platform,
      tenant,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/connect] ingestion error:", message);
    res.status(500).json({ error: message });
  }
});

// ─── Ad Creation Endpoint (Simulated) ──────────────────────────────────
// This simulates the creation of an ad on an external platform.
// Called by the create-platform-ad Edge Function.
app.post("/api/ads", async (req, res) => {
  const { ad, platform } = req.body as { ad: SimulatedAdPayload; platform: string };

  if (!ad || !platform) {
    res.status(400).json({ error: "ad and platform are required" });
    return;
  }

  console.log(`[POST /api/ads] Simulating ad creation on ${platform} for: ${ad.name ?? "Unnamed Ad"}`);

  // Simulating platform latency
  await new Promise(r => setTimeout(r, 1200));

  // 10% chance of failure to test error handling
  if (Math.random() < 0.1) {
    console.error(`[POST /api/ads] Simulated platform error for ${platform}`);
    res.status(502).json({ error: `Simulated ${platform} API error` });
    return;
  }

  const externalId = `${platform.slice(0, 2)}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  res.json({
    success: true,
    platform_ad_id: externalId,
    status: "active",
    metadata: {
      creative_id: `ct_${Math.random().toString(36).substring(7)}`,
      published_at: new Date().toISOString()
    }
  });
});

app.post("/api/rpc/create_ad_with_mirror_post", async (req, res) => {
  const payload = req.body as CreateAdWithMirrorPostRpcPayload;

  if (!payload.p_team_id || !payload.p_name) {
    res.status(400).json({
      error: "p_team_id and p_name are required",
    });
    return;
  }

  try {
    const supabase = getSupabaseClient();

    const adInsertPayload = {
      team_id: payload.p_team_id,
      name: payload.p_name,
      status: payload.p_status ?? "draft",
      creative_type: payload.p_creative_type ?? "image",
      headline: payload.p_headline ?? null,
      ad_copy: payload.p_ad_copy ?? null,
      call_to_action: payload.p_call_to_action ?? null,
      content: payload.p_content ?? null,
      media_urls: payload.p_media_urls ?? null,
      scheduled_at: payload.p_scheduled_at ?? null,
      ad_group_id: payload.p_ad_group_id ?? null,
      creative_url: payload.p_creative_url ?? "/placeholder.svg",
      platform_ad_id: payload.p_platform_ad_id ?? null,
      preview_url: payload.p_preview_url ?? null,
      budget: payload.p_budget ?? null,
      updated_at: new Date().toISOString(),
    };

    const { data: createdAd, error: adError } = await supabase
      .from("ads")
      .insert(adInsertPayload)
      .select()
      .single();

    if (adError) {
      throw adError;
    }

    const socialPayload = {
      id: createdAd.id,
      team_id: payload.p_team_id,
      platform_id: payload.p_platform_id ?? null,
      post_type: payload.p_creative_type ?? "image",
      post_channel: "ad",
      name: payload.p_name,
      content: payload.p_content ?? null,
      media_urls: payload.p_media_urls ?? null,
      status: payload.p_status ?? "draft",
      scheduled_at: payload.p_scheduled_at ?? null,
      ad_group_id: payload.p_ad_group_id ?? null,
    };

    const { error: socialError } = await supabase.from("social_posts").insert(socialPayload);
    if (socialError) {
      // Keep behavior aligned with SQL RPC: mirror insert failure should not leave orphan ad rows.
      await supabase.from("ads").delete().eq("id", createdAd.id);
      throw socialError;
    }

    res.json({ data: createdAd });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get("/api/ad-groups", async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : "";

  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("ad_groups")
      .select("id, name, description, group_type, status, team_id, created_at, updated_at")
      .eq("team_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    res.json({ data: data ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post("/api/ad-groups", async (req, res) => {
  const {
    adIds = [],
    description = null,
    groupType = null,
    name,
    status = "draft",
    workspaceId,
  } = req.body as {
    adIds?: string[];
    description?: string | null;
    groupType?: string | null;
    name?: string;
    status?: string;
    workspaceId?: string;
  };

  if (!workspaceId || !name?.trim()) {
    res.status(400).json({ error: "workspaceId and name are required" });
    return;
  }

  try {
    const supabase = getSupabaseClient();
    const { data: createdGroup, error: groupError } = await supabase
      .from("ad_groups")
      .insert({
        description,
        group_type: groupType,
        name: name.trim(),
        status,
        team_id: workspaceId,
      })
      .select()
      .single();

    if (groupError) {
      throw groupError;
    }

    if (adIds.length > 0) {
      const [{ error: adsError }, { error: postsError }] = await Promise.all([
        supabase
          .from("ads")
          .update({ ad_group_id: createdGroup.id })
          .eq("team_id", workspaceId)
          .in("id", adIds),
        supabase
          .from("social_posts")
          .update({ ad_group_id: createdGroup.id })
          .eq("team_id", workspaceId)
          .in("id", adIds),
      ]);

      if (adsError) throw adsError;
      if (postsError) throw postsError;
    }

    res.status(201).json({ data: createdGroup });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.put("/api/ad-groups/:id", async (req, res) => {
  const groupId = req.params.id;
  const {
    adIds,
    description,
    groupType,
    name,
    status,
    workspaceId,
  } = req.body as {
    adIds?: string[];
    description?: string | null;
    groupType?: string | null;
    name?: string;
    status?: string;
    workspaceId?: string;
  };

  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }

  try {
    const supabase = getSupabaseClient();
    const updatePayload = {
      description,
      group_type: groupType,
      name,
      status,
      updated_at: new Date().toISOString(),
    };

    const { data: updatedGroup, error: groupError } = await supabase
      .from("ad_groups")
      .update(updatePayload)
      .eq("id", groupId)
      .eq("team_id", workspaceId)
      .select()
      .single();

    if (groupError) {
      throw groupError;
    }

    if (Array.isArray(adIds)) {
      const { data: currentlyLinkedAds, error: currentAdsError } = await supabase
        .from("ads")
        .select("id")
        .eq("team_id", workspaceId)
        .eq("ad_group_id", groupId);

      if (currentAdsError) {
        throw currentAdsError;
      }

      const adIdsToClear = (currentlyLinkedAds ?? [])
        .map((ad) => ad.id)
        .filter((adId) => !adIds.includes(adId));

      if (adIdsToClear.length > 0) {
        const [{ error: clearAdsError }, { error: clearPostsError }] = await Promise.all([
          supabase
            .from("ads")
            .update({ ad_group_id: null })
            .eq("team_id", workspaceId)
            .in("id", adIdsToClear),
          supabase
            .from("social_posts")
            .update({ ad_group_id: null })
            .eq("team_id", workspaceId)
            .in("id", adIdsToClear),
        ]);

        if (clearAdsError) throw clearAdsError;
        if (clearPostsError) throw clearPostsError;
      }

      if (adIds.length > 0) {
        const [{ error: assignAdsError }, { error: assignPostsError }] = await Promise.all([
          supabase
            .from("ads")
            .update({ ad_group_id: groupId })
            .eq("team_id", workspaceId)
            .in("id", adIds),
          supabase
            .from("social_posts")
            .update({ ad_group_id: groupId })
            .eq("team_id", workspaceId)
            .in("id", adIds),
        ]);

        if (assignAdsError) throw assignAdsError;
        if (assignPostsError) throw assignPostsError;
      }
    }

    res.json({ data: updatedGroup });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.delete("/api/ad-groups/:id", async (req, res) => {
  const groupId = req.params.id;
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : "";

  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }

  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("ad_groups")
      .delete()
      .eq("id", groupId)
      .eq("team_id", workspaceId);

    if (error) {
      throw error;
    }

    res.status(204).send();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Health Check ────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", tenants: ["shop-a", "shop-b"] });
});

// ─── List all routes ─────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({
    name: "Buzzly Mock API Server",
    version: "1.0.0",
    endpoints: [
      "POST /validate-key                          — validate a mock API key",
      "POST /api/connect                           — ingest external data → Supabase (returns status only)",
      "POST /api/rpc/create_ad_with_mirror_post   — mock RPC for ad + mirror post creation",
      "GET  /api/ad-groups?workspaceId=<uuid>      — list ad groups for a workspace",
      "POST /api/ad-groups                         — create an ad group and optionally assign ads",
      "PUT  /api/ad-groups/:id                     — update an ad group and sync assigned ads",
      "DELETE /api/ad-groups/:id?workspaceId=<id>  — delete an ad group",
      "GET  /facebook/:tenant/insights",
      "GET  /facebook/:tenant/leads",
      "GET  /facebook/:tenant/ads",
      "GET  /facebook/:tenant/chats",
      "GET  /instagram/:tenant/ads",
      "GET  /tiktok/:tenant/ads",
      "GET  /shopee/:tenant/orders/list",
      "GET  /shopee/:tenant/marketing/shop_performance",
      "GET  /shopee/:tenant/ads",
      "GET  /google/:tenant/ads",
      "GET  /health",
    ],
    tenants: ["shop-a", "shop-b"],
    docs: "Use shop-a for high-volume data or shop-b for niche/high-conversion data",
    validKeys: Object.entries(MOCK_API_KEYS).map(([key, val]) => ({ key, ...val })),
  });
});

/** Exported for Vercel serverless (`api/index.ts`). Local dev uses `app.listen` below. */
export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n🐝 Buzzly Mock API Server running at http://localhost:${PORT}`);
    console.log(`   Tenants: shop-a (high volume) | shop-b (niche)`);
    console.log(`\n   Endpoints:`);
    console.log(`   POST /validate-key`);
    console.log(`   POST /api/rpc/create_ad_with_mirror_post`);
    console.log(`   GET  /api/ad-groups?workspaceId=<uuid>`);
    console.log(`   POST /api/ad-groups`);
    console.log(`   PUT  /api/ad-groups/:id`);
    console.log(`   DELETE /api/ad-groups/:id?workspaceId=<uuid>`);
    console.log(`   GET  /facebook/:tenant/insights`);
    console.log(`   GET  /facebook/:tenant/leads`);
    console.log(`   GET  /facebook/:tenant/ads`);
    console.log(`   GET  /facebook/:tenant/chats`);
    console.log(`   GET  /instagram/:tenant/ads`);
    console.log(`   GET  /tiktok/:tenant/ads`);
    console.log(`   GET  /shopee/:tenant/orders/list`);
    console.log(`   GET  /shopee/:tenant/marketing/shop_performance`);
    console.log(`   GET  /shopee/:tenant/ads`);
    console.log(`   GET  /google/:tenant/ads`);
    console.log(`\n   Valid API Keys:`);
    Object.entries(MOCK_API_KEYS).forEach(([key, val]) => {
      console.log(`   ${key.padEnd(22)} → ${val.shopLabel}`);
    });
    console.log();
  });
}
