/**
 * mock-api-data.ts
 *
 * Static snapshot of all Mock API fixture data for the Marketing Intelligence module.
 * Covers Ads, Insights, and Personas across 5 platforms × 2 shop scenarios.
 *
 * Toggle between live Supabase data and this mock snapshot via:
 *   VITE_USE_MOCK_DATA=true   in your .env.local
 */

import type { Json } from "@/integrations/supabase/types";
import type { CustomerPersona } from "@/hooks/useCustomerPersonas";

// ─────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT FLAG
// ─────────────────────────────────────────────────────────────────────────────

export const USE_MOCK_DATA = import.meta.env.VITE_USE_MOCK_DATA === "true";

// ─────────────────────────────────────────────────────────────────────────────
// RAW FIXTURE TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface MockAction {
  action_type: string;
  value: string;
}

export interface MockInsightRecord {
  campaign_id: string;
  campaign_name: string;
  objective: string;
  impressions: string;
  reach: string;
  clicks: string;
  ctr: string;
  cpc: string;
  cpm: string;
  spend: string;
  conversions: string;
  roas: string;
  actions: MockAction[];
  cost_per_action_type: MockAction[];
  date_start: string;
  date_stop: string;
  account_currency: string;
}

export interface MockInsightFile {
  data: MockInsightRecord[];
  paging: { cursors: { before: string; after: string } };
  summary: {
    account_currency: string;
    total_spend: string;
    total_impressions: string;
    total_clicks: string;
  };
}

export interface MockPersonaData {
  age_distribution: Record<string, number>;
  gender: { male: number; female: number; unknown: number };
  top_locations: Array<{ name: string; pct: number }>;
  interests: Array<{ name: string; pct: number }>;
  device_type: { mobile: number; desktop: number; tablet: number };
}

export interface MockAdRecord {
  external_ad_id: string;
  ad_name: string;
  status: string;
  platform: string;
  impressions: number;
  reach: number;
  clicks: number;
  conversions: number;
  spend: number;
  ctr: number;
  cpc: number;
  cpm: number;
  roas: number;
  date_start: string;
  date_stop: string;
  persona_data: MockPersonaData;
}

export interface MockAdFile {
  data: MockAdRecord[];
}

// ─────────────────────────────────────────────────────────────────────────────
// LEADS FIXTURE TYPES
// Mirrors the Facebook Lead Ads API field_data schema.
// ─────────────────────────────────────────────────────────────────────────────

export interface MockLeadFieldData {
  name: string;
  values: string[];
}

export interface MockLeadRecord {
  id: string;
  created_time: string;
  field_data: MockLeadFieldData[];
  form_id: string;
  ad_id: string;
}

export interface MockLeadFile {
  data: MockLeadRecord[];
  paging: { cursors: { before: string; after: string } };
}

/** Convenience: pull a named field value from a lead's field_data array. */
export function getLeadField(lead: MockLeadRecord, fieldName: string): string {
  return lead.field_data.find((f) => f.name === fieldName)?.values[0] ?? "";
}

// ─────────────────────────────────────────────────────────────────────────────
// RAW FIXTURE IMPORTS — INSIGHTS (campaign-level aggregates)
// ─────────────────────────────────────────────────────────────────────────────

import _fbShopAInsights from "../../mock-api/fixtures/facebook/shop-a-insights.json";
import _fbShopBInsights from "../../mock-api/fixtures/facebook/shop-b-insights.json";
import _igShopAInsights from "../../mock-api/fixtures/instagram/shop-a-insights.json";
import _igShopBInsights from "../../mock-api/fixtures/instagram/shop-b-insights.json";
import _ttShopAInsights from "../../mock-api/fixtures/tiktok/shop-a-insights.json";
import _ttShopBInsights from "../../mock-api/fixtures/tiktok/shop-b-insights.json";
import _ggShopAInsights from "../../mock-api/fixtures/google/shop-a-insights.json";
import _ggShopBInsights from "../../mock-api/fixtures/google/shop-b-insights.json";
import _spShopAInsights from "../../mock-api/fixtures/shopee/shop-a-insights.json";
import _spShopBInsights from "../../mock-api/fixtures/shopee/shop-b-insights.json";

export const FACEBOOK_SHOP_A_INSIGHTS = _fbShopAInsights as unknown as MockInsightFile;
export const FACEBOOK_SHOP_B_INSIGHTS = _fbShopBInsights as unknown as MockInsightFile;
export const INSTAGRAM_SHOP_A_INSIGHTS = _igShopAInsights as unknown as MockInsightFile;
export const INSTAGRAM_SHOP_B_INSIGHTS = _igShopBInsights as unknown as MockInsightFile;
export const TIKTOK_SHOP_A_INSIGHTS = _ttShopAInsights as unknown as MockInsightFile;
export const TIKTOK_SHOP_B_INSIGHTS = _ttShopBInsights as unknown as MockInsightFile;
export const GOOGLE_SHOP_A_INSIGHTS = _ggShopAInsights as unknown as MockInsightFile;
export const GOOGLE_SHOP_B_INSIGHTS = _ggShopBInsights as unknown as MockInsightFile;
export const SHOPEE_SHOP_A_INSIGHTS = _spShopAInsights as unknown as MockInsightFile;
export const SHOPEE_SHOP_B_INSIGHTS = _spShopBInsights as unknown as MockInsightFile;

// ─────────────────────────────────────────────────────────────────────────────
// RAW FIXTURE IMPORTS — ADS (creative + audience breakdown)
// ─────────────────────────────────────────────────────────────────────────────

import _fbShopAAds from "../../mock-api/fixtures/facebook/shop-a-ads.json";
import _fbShopBAds from "../../mock-api/fixtures/facebook/shop-b-ads.json";
import _igShopAAds from "../../mock-api/fixtures/instagram/shop-a-ads.json";
import _igShopBAds from "../../mock-api/fixtures/instagram/shop-b-ads.json";
import _ttShopAAds from "../../mock-api/fixtures/tiktok/shop-a-ads.json";
import _ttShopBAds from "../../mock-api/fixtures/tiktok/shop-b-ads.json";
import _ggShopAAds from "../../mock-api/fixtures/google/shop-a-ads.json";
import _ggShopBAds from "../../mock-api/fixtures/google/shop-b-ads.json";
import _spShopAAds from "../../mock-api/fixtures/shopee/shop-a-ads.json";
import _spShopBAds from "../../mock-api/fixtures/shopee/shop-b-ads.json";

// ─────────────────────────────────────────────────────────────────────────────
// RAW FIXTURE IMPORTS — LEADS (Facebook Lead Ads form submissions)
// ─────────────────────────────────────────────────────────────────────────────

import _fbShopALeads from "../../mock-api/fixtures/facebook/shop-a-leads.json";
import _fbShopBLeads from "../../mock-api/fixtures/facebook/shop-b-leads.json";

export const FACEBOOK_SHOP_A_LEADS = _fbShopALeads as unknown as MockLeadFile;
export const FACEBOOK_SHOP_B_LEADS = _fbShopBLeads as unknown as MockLeadFile;

export const FACEBOOK_SHOP_A_ADS = _fbShopAAds as unknown as MockAdFile;
export const FACEBOOK_SHOP_B_ADS = _fbShopBAds as unknown as MockAdFile;
export const INSTAGRAM_SHOP_A_ADS = _igShopAAds as unknown as MockAdFile;
export const INSTAGRAM_SHOP_B_ADS = _igShopBAds as unknown as MockAdFile;
export const TIKTOK_SHOP_A_ADS = _ttShopAAds as unknown as MockAdFile;
export const TIKTOK_SHOP_B_ADS = _ttShopBAds as unknown as MockAdFile;
export const GOOGLE_SHOP_A_ADS = _ggShopAAds as unknown as MockAdFile;
export const GOOGLE_SHOP_B_ADS = _ggShopBAds as unknown as MockAdFile;
export const SHOPEE_SHOP_A_ADS = _spShopAAds as unknown as MockAdFile;
export const SHOPEE_SHOP_B_ADS = _spShopBAds as unknown as MockAdFile;

// Convenience: all ads across a shop
export const ALL_SHOP_A_ADS: MockAdRecord[] = [
  ...FACEBOOK_SHOP_A_ADS.data,
  ...INSTAGRAM_SHOP_A_ADS.data,
  ...TIKTOK_SHOP_A_ADS.data,
  ...GOOGLE_SHOP_A_ADS.data,
  ...SHOPEE_SHOP_A_ADS.data,
];

export const ALL_SHOP_B_ADS: MockAdRecord[] = [
  ...FACEBOOK_SHOP_B_ADS.data,
  ...INSTAGRAM_SHOP_B_ADS.data,
  ...TIKTOK_SHOP_B_ADS.data,
  ...GOOGLE_SHOP_B_ADS.data,
  ...SHOPEE_SHOP_B_ADS.data,
];

// ─────────────────────────────────────────────────────────────────────────────
// AdInsight DB Row shape
// Mirrors Database["public"]["Tables"]["ad_insights"]["Row"] — kept in sync
// manually so this file has zero dependency on the Supabase client.
// ─────────────────────────────────────────────────────────────────────────────

export interface AdInsightRow {
  id: string;
  date: string;
  ad_account_id: string | null;
  ads_id: string | null;
  ad_group_id: string | null;
  campaign_id: string | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  conversions: number | null;
  spend: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  roas: number | null;
  adds_to_cart: number | null;
  leads: number | null;
  created_at: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spreads a campaign aggregate record evenly over its date range,
 * producing one AdInsightRow per day with a bell-curve distribution
 * so the time-series looks realistic (ramps up, peaks mid-flight, tapers).
 */
function spreadInsightOverDays(
  record: MockInsightRecord,
  platform: string,
  shopId: string,
): AdInsightRow[] {
  const startMs = new Date(record.date_start).getTime();
  const endMs = new Date(record.date_stop).getTime();
  const days = Math.round((endMs - startMs) / 86_400_000) + 1;

  const totalImpressions = parseInt(record.impressions, 10);
  const totalReach = parseInt(record.reach, 10);
  const totalClicks = parseInt(record.clicks, 10);
  const totalConversions = parseInt(record.conversions, 10);
  const totalSpend = parseFloat(record.spend);

  const addToCartAction = record.actions.find((a) => a.action_type === "add_to_cart");
  const leadsAction = record.actions.find((a) => a.action_type === "lead");
  const totalAddToCart = addToCartAction ? parseInt(addToCartAction.value, 10) : 0;
  const totalLeads = leadsAction ? parseInt(leadsAction.value, 10) : 0;

  // Precompute day weights (bell curve via sin) so each weight sums to ~days
  const rawWeights = Array.from({ length: days }, (_, i) =>
    1 + 0.5 * Math.sin((i / Math.max(days - 1, 1)) * Math.PI),
  );
  const weightSum = rawWeights.reduce((s, w) => s + w, 0);
  const weights = rawWeights.map((w) => (w / weightSum) * days);

  return Array.from({ length: days }, (_, i) => {
    const d = new Date(startMs + i * 86_400_000);
    const dateStr = d.toISOString().slice(0, 10);
    const w = weights[i];
    const rowClicks = Math.round((totalClicks / days) * w);
    const rowSpend = parseFloat(((totalSpend / days) * w).toFixed(2));
    // CPC = Spend / Clicks — compute when clicks > 0 to avoid ฿0 when spend has value
    const rowCpc =
      rowClicks > 0 ? rowSpend / rowClicks : parseFloat(record.cpc) || 0;

    return {
      id: `mock-${shopId}-${platform}-${record.campaign_id}-${dateStr}`,
      date: dateStr,
      ad_account_id: `mock-acc-${shopId}-${platform}`,
      ads_id: null,
      ad_group_id: `mock-ad-group-${shopId}-${platform}`,
      campaign_id: `mock-campaign-${record.campaign_id}`,
      impressions: Math.round((totalImpressions / days) * w),
      reach: Math.round((totalReach / days) * w),
      clicks: rowClicks,
      conversions: Math.round((totalConversions / days) * w),
      spend: rowSpend,
      ctr: parseFloat(record.ctr),
      cpc: rowCpc,
      cpm: parseFloat(record.cpm),
      roas: parseFloat(record.roas),
      // Aggregate-only fields: bucket into the first day to avoid double-counting
      adds_to_cart: i === 0 ? totalAddToCart : 0,
      leads: i === 0 ? totalLeads : 0,
      created_at: null,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATED AdInsightRow[] — ready for useAdInsights / useCampaignInsights
// ─────────────────────────────────────────────────────────────────────────────

export const MOCK_AD_INSIGHTS_SHOP_A: AdInsightRow[] = [
  ...FACEBOOK_SHOP_A_INSIGHTS.data.flatMap((r) => spreadInsightOverDays(r, "facebook", "shop-a")),
  ...INSTAGRAM_SHOP_A_INSIGHTS.data.flatMap((r) => spreadInsightOverDays(r, "instagram", "shop-a")),
  ...TIKTOK_SHOP_A_INSIGHTS.data.flatMap((r) => spreadInsightOverDays(r, "tiktok", "shop-a")),
  ...GOOGLE_SHOP_A_INSIGHTS.data.flatMap((r) => spreadInsightOverDays(r, "google", "shop-a")),
  ...SHOPEE_SHOP_A_INSIGHTS.data.flatMap((r) => spreadInsightOverDays(r, "shopee", "shop-a")),
];

export const MOCK_AD_INSIGHTS_SHOP_B: AdInsightRow[] = [
  ...FACEBOOK_SHOP_B_INSIGHTS.data.flatMap((r) => spreadInsightOverDays(r, "facebook", "shop-b")),
  ...INSTAGRAM_SHOP_B_INSIGHTS.data.flatMap((r) => spreadInsightOverDays(r, "instagram", "shop-b")),
  ...TIKTOK_SHOP_B_INSIGHTS.data.flatMap((r) => spreadInsightOverDays(r, "tiktok", "shop-b")),
  ...GOOGLE_SHOP_B_INSIGHTS.data.flatMap((r) => spreadInsightOverDays(r, "google", "shop-b")),
  ...SHOPEE_SHOP_B_INSIGHTS.data.flatMap((r) => spreadInsightOverDays(r, "shopee", "shop-b")),
];

/** Combined rows for both shops — use when shop context is unknown. */
export const MOCK_AD_INSIGHTS: AdInsightRow[] = [
  ...MOCK_AD_INSIGHTS_SHOP_A,
  ...MOCK_AD_INSIGHTS_SHOP_B,
];

// ─────────────────────────────────────────────────────────────────────────────
// CalendarItem shape
// Mirrors the CalendarItem interface from useUnifiedCalendar.tsx
// ─────────────────────────────────────────────────────────────────────────────

export interface MockCalendarItem {
  id: string;
  type: "post" | "ad";
  title: string;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
  platform_name: string;
  platform_slug: string;
  platform_icon_url: string | null;
  media_urls: string[] | null;
  creative_type: string | null;
  persona_names: string[];
  persona_ids: string[];
  platform_id: string | null;
  content: string | null;
  post_type: string | null;
  hashtags: string[] | null;
  ad_group_id?: string | null;
}

export interface MockCalendarDay {
  date: string;
  items: MockCalendarItem[];
}

// Synthetic calendar entries derived from the ads fixtures, spread over the
// fixture window (2026-02-14 – 2026-03-15).
// Two posts and one ad per platform per week give a representative view.
export const MOCK_CALENDAR_ITEMS: MockCalendarItem[] = [
  // ── Facebook – Shop A ──────────────────────────────────────────────────
  {
    id: "mock-cal-fb-ad-001",
    type: "ad",
    title: "Summer Mega Sale – Carousel",
    status: "ACTIVE",
    scheduled_at: "2026-03-01T08:00:00.000Z",
    published_at: null,
    platform_name: "Facebook",
    platform_slug: "facebook",
    platform_icon_url: null,
    media_urls: null,
    creative_type: "carousel",
    persona_names: ["Tech-Savvy Millennial"],
    persona_ids: ["mock-persona-shop-a-1"],
    platform_id: null,
    content: null,
    post_type: null,
    hashtags: null,
  },
  {
    id: "mock-cal-fb-post-001",
    type: "post",
    title: "Flash Sale announcement – this weekend only!",
    status: "published",
    scheduled_at: null,
    published_at: "2026-03-07T10:30:00.000Z",
    platform_name: "Facebook",
    platform_slug: "facebook",
    platform_icon_url: null,
    media_urls: null,
    creative_type: null,
    persona_names: ["Budget-Conscious Parent"],
    persona_ids: ["mock-persona-shop-a-2"],
    platform_id: "mock-platform-facebook",
    content: "Flash Sale announcement – this weekend only! Grab deals up to 70% off. 🛒",
    post_type: "image",
    hashtags: ["#FlashSale", "#Summer2026", "#ShopNow"],
  },
  {
    id: "mock-cal-fb-post-002",
    type: "post",
    title: "New collection is live – check it out!",
    status: "scheduled",
    scheduled_at: "2026-03-14T09:00:00.000Z",
    published_at: null,
    platform_name: "Facebook",
    platform_slug: "facebook",
    platform_icon_url: null,
    media_urls: null,
    creative_type: null,
    persona_names: ["Tech-Savvy Millennial", "Small Business Owner"],
    persona_ids: ["mock-persona-shop-a-1", "mock-persona-shop-a-3"],
    platform_id: "mock-platform-facebook",
    content: "New arrivals just dropped. Shop the collection before it sells out.",
    post_type: "carousel",
    hashtags: ["#NewArrival", "#Summer", "#Trending"],
  },

  // ── Instagram – Shop A ─────────────────────────────────────────────────
  {
    id: "mock-cal-ig-ad-001",
    type: "ad",
    title: "Reels – Product Demo",
    status: "ACTIVE",
    scheduled_at: "2026-02-20T07:00:00.000Z",
    published_at: null,
    platform_name: "Instagram",
    platform_slug: "instagram",
    platform_icon_url: null,
    media_urls: null,
    creative_type: "video",
    persona_names: ["Tech-Savvy Millennial"],
    persona_ids: ["mock-persona-shop-a-1"],
    platform_id: null,
    content: null,
    post_type: null,
    hashtags: null,
  },
  {
    id: "mock-cal-ig-post-001",
    type: "post",
    title: "Behind the scenes of our summer photoshoot",
    status: "published",
    scheduled_at: null,
    published_at: "2026-02-28T11:00:00.000Z",
    platform_name: "Instagram",
    platform_slug: "instagram",
    platform_icon_url: null,
    media_urls: null,
    creative_type: null,
    persona_names: ["Tech-Savvy Millennial"],
    persona_ids: ["mock-persona-shop-a-1"],
    platform_id: "mock-platform-instagram",
    content: "Behind the scenes of our summer photoshoot ☀️",
    post_type: "reel",
    hashtags: ["#BTS", "#SummerVibes", "#Fashion"],
  },
  {
    id: "mock-cal-ig-post-002",
    type: "post",
    title: "Shopping Ads – Top Products spotlight",
    status: "scheduled",
    scheduled_at: "2026-03-10T08:00:00.000Z",
    published_at: null,
    platform_name: "Instagram",
    platform_slug: "instagram",
    platform_icon_url: null,
    media_urls: null,
    creative_type: null,
    persona_names: ["Budget-Conscious Parent"],
    persona_ids: ["mock-persona-shop-a-2"],
    platform_id: "mock-platform-instagram",
    content: "Our best sellers — all in one place. Tap to shop.",
    post_type: "image",
    hashtags: ["#BestSellers", "#ShopNow", "#Deals"],
  },

  // ── TikTok – Shop A ────────────────────────────────────────────────────
  {
    id: "mock-cal-tt-ad-001",
    type: "ad",
    title: "Viral Challenge – Summer Sale",
    status: "ACTIVE",
    scheduled_at: "2026-02-25T06:00:00.000Z",
    published_at: null,
    platform_name: "TikTok",
    platform_slug: "tiktok",
    platform_icon_url: null,
    media_urls: null,
    creative_type: "video",
    persona_names: ["Tech-Savvy Millennial"],
    persona_ids: ["mock-persona-shop-a-1"],
    platform_id: null,
    content: null,
    post_type: null,
    hashtags: null,
  },
  {
    id: "mock-cal-tt-post-001",
    type: "post",
    title: "Flash Deal alert – 24 hours only!",
    status: "published",
    scheduled_at: null,
    published_at: "2026-03-03T12:00:00.000Z",
    platform_name: "TikTok",
    platform_slug: "tiktok",
    platform_icon_url: null,
    media_urls: null,
    creative_type: null,
    persona_names: ["Budget-Conscious Parent"],
    persona_ids: ["mock-persona-shop-a-2"],
    platform_id: "mock-platform-tiktok",
    content: "FLASH DEAL 🔥 24 hours only — don't miss out!",
    post_type: "video",
    hashtags: ["#FlashDeal", "#TikTokMadeMeBuyIt", "#Sale"],
  },

  // ── Google – Shop A ────────────────────────────────────────────────────
  {
    id: "mock-cal-gg-ad-001",
    type: "ad",
    title: "Search – Summer Sale Keywords",
    status: "ACTIVE",
    scheduled_at: "2026-02-17T00:00:00.000Z",
    published_at: null,
    platform_name: "Google",
    platform_slug: "google",
    platform_icon_url: null,
    media_urls: null,
    creative_type: "search",
    persona_names: ["Small Business Owner"],
    persona_ids: ["mock-persona-shop-a-3"],
    platform_id: null,
    content: null,
    post_type: null,
    hashtags: null,
  },
  {
    id: "mock-cal-gg-ad-002",
    type: "ad",
    title: "Shopping – Product Catalog",
    status: "ACTIVE",
    scheduled_at: "2026-03-05T00:00:00.000Z",
    published_at: null,
    platform_name: "Google",
    platform_slug: "google",
    platform_icon_url: null,
    media_urls: null,
    creative_type: "shopping",
    persona_names: ["Budget-Conscious Parent"],
    persona_ids: ["mock-persona-shop-a-2"],
    platform_id: null,
    content: null,
    post_type: null,
    hashtags: null,
  },

  // ── Shopee – Shop A ────────────────────────────────────────────────────
  {
    id: "mock-cal-sp-ad-001",
    type: "ad",
    title: "Shopee Mega Sale – Summer Deals",
    status: "ACTIVE",
    scheduled_at: "2026-02-20T00:00:00.000Z",
    published_at: null,
    platform_name: "Shopee",
    platform_slug: "shopee",
    platform_icon_url: null,
    media_urls: null,
    creative_type: "banner",
    persona_names: ["Budget-Conscious Parent"],
    persona_ids: ["mock-persona-shop-a-2"],
    platform_id: null,
    content: null,
    post_type: null,
    hashtags: null,
  },

  // ── Facebook – Shop B ──────────────────────────────────────────────────
  {
    id: "mock-cal-fb-b-ad-001",
    type: "ad",
    title: "VIP Loyalty – Retargeting",
    status: "ACTIVE",
    scheduled_at: "2026-03-01T08:00:00.000Z",
    published_at: null,
    platform_name: "Facebook",
    platform_slug: "facebook",
    platform_icon_url: null,
    media_urls: null,
    creative_type: "carousel",
    persona_names: ["Luxury Beauty Buyer"],
    persona_ids: ["mock-persona-shop-b-2"],
    platform_id: null,
    content: null,
    post_type: null,
    hashtags: null,
  },
  {
    id: "mock-cal-fb-b-post-001",
    type: "post",
    title: "Introducing our new Vitamin C Brightening Serum",
    status: "published",
    scheduled_at: null,
    published_at: "2026-02-22T09:00:00.000Z",
    platform_name: "Facebook",
    platform_slug: "facebook",
    platform_icon_url: null,
    media_urls: null,
    creative_type: null,
    persona_names: ["Skincare Enthusiast"],
    persona_ids: ["mock-persona-shop-b-1"],
    platform_id: "mock-platform-facebook",
    content: "Introducing our new Vitamin C Brightening Serum ✨ Formulated for all skin types.",
    post_type: "image",
    hashtags: ["#Skincare", "#VitaminC", "#NaturalBeauty"],
  },

  // ── Instagram – Shop B ─────────────────────────────────────────────────
  {
    id: "mock-cal-ig-b-ad-001",
    type: "ad",
    title: "Premium Serum – Beauty Conversion",
    status: "ACTIVE",
    scheduled_at: "2026-02-18T07:00:00.000Z",
    published_at: null,
    platform_name: "Instagram",
    platform_slug: "instagram",
    platform_icon_url: null,
    media_urls: null,
    creative_type: "video",
    persona_names: ["Luxury Beauty Buyer"],
    persona_ids: ["mock-persona-shop-b-2"],
    platform_id: null,
    content: null,
    post_type: null,
    hashtags: null,
  },
  {
    id: "mock-cal-ig-b-post-001",
    type: "post",
    title: "Skincare routine with our Organic Rose Water Toner",
    status: "published",
    scheduled_at: null,
    published_at: "2026-03-05T10:00:00.000Z",
    platform_name: "Instagram",
    platform_slug: "instagram",
    platform_icon_url: null,
    media_urls: null,
    creative_type: null,
    persona_names: ["Skincare Enthusiast"],
    persona_ids: ["mock-persona-shop-b-1"],
    platform_id: "mock-platform-instagram",
    content: "Morning routine ft. our Organic Rose Water Toner 🌹 Gentle, hydrating, glowing skin.",
    post_type: "reel",
    hashtags: ["#SkincareRoutine", "#OrganicSkincare", "#GlowUp"],
  },

  // ── TikTok – Shop B ────────────────────────────────────────────────────
  {
    id: "mock-cal-tt-b-ad-001",
    type: "ad",
    title: "Beauty Trends – Spark Ads",
    status: "ACTIVE",
    scheduled_at: "2026-02-21T06:00:00.000Z",
    published_at: null,
    platform_name: "TikTok",
    platform_slug: "tiktok",
    platform_icon_url: null,
    media_urls: null,
    creative_type: "spark",
    persona_names: ["Skincare Enthusiast"],
    persona_ids: ["mock-persona-shop-b-1"],
    platform_id: null,
    content: null,
    post_type: null,
    hashtags: null,
  },

  // ── Google – Shop B ────────────────────────────────────────────────────
  {
    id: "mock-cal-gg-b-ad-001",
    type: "ad",
    title: "PMax – Luxury Beauty Collection",
    status: "ACTIVE",
    scheduled_at: "2026-02-16T00:00:00.000Z",
    published_at: null,
    platform_name: "Google",
    platform_slug: "google",
    platform_icon_url: null,
    media_urls: null,
    creative_type: "pmax",
    persona_names: ["Luxury Beauty Buyer"],
    persona_ids: ["mock-persona-shop-b-2"],
    platform_id: null,
    content: null,
    post_type: null,
    hashtags: null,
  },

  // ── Shopee – Shop B ────────────────────────────────────────────────────
  {
    id: "mock-cal-sp-b-ad-001",
    type: "ad",
    title: "Shopee Premium – Skincare Collection",
    status: "ACTIVE",
    scheduled_at: "2026-02-19T00:00:00.000Z",
    published_at: null,
    platform_name: "Shopee",
    platform_slug: "shopee",
    platform_icon_url: null,
    media_urls: null,
    creative_type: "banner",
    persona_names: ["Luxury Beauty Buyer"],
    persona_ids: ["mock-persona-shop-b-2"],
    platform_id: null,
    content: null,
    post_type: null,
    hashtags: null,
  },
].map((item): MockCalendarItem => ({
  ...item,
  type: item.type as "post" | "ad",
  ad_group_id: item.id.includes("-b-")
    ? `mock-ad-group-shop-b-${item.platform_slug}`
    : `mock-ad-group-shop-a-${item.platform_slug}`,
}));

/** Items grouped by date (same shape as UnifiedCalendarDay from useUnifiedCalendar). */
export const MOCK_CALENDAR_DAYS: MockCalendarDay[] = (() => {
  const map = new Map<string, MockCalendarItem[]>();
  for (const item of MOCK_CALENDAR_ITEMS) {
    const raw = item.scheduled_at ?? item.published_at;
    if (!raw) continue;
    const dateStr = raw.slice(0, 10);
    const bucket = map.get(dateStr) ?? [];
    bucket.push(item);
    map.set(dateStr, bucket);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({ date, items }));
})();

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA METADATA
// Mirrors the customer_personas seeded by seed-to-supabase.ts
// ─────────────────────────────────────────────────────────────────────────────

export interface MockPersona {
  id: string;
  persona_name: string;
  shop: "shop-a" | "shop-b";
  description: string;
  keywords: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// SHOP RESOLUTION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ID-based mock shop resolver.
 *
 * To test shop-b data locally, add your workspace UUID to .env.local:
 *   VITE_MOCK_SHOP_B_IDS=<uuid1>,<uuid2>
 *
 * All other workspace IDs (and null/undefined) resolve to shop-a.
 */
const MOCK_SHOP_B_IDS = new Set<string>(
  (import.meta.env.VITE_MOCK_SHOP_B_IDS ?? "")
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean),
);

export function resolveMockShop(workspaceId?: string | null): "shop-a" | "shop-b" {
  if (!workspaceId) return "shop-a";
  return MOCK_SHOP_B_IDS.has(workspaceId) ? "shop-b" : "shop-a";
}

export function getMockInsights(workspaceId?: string | null): AdInsightRow[] {
  const shop = resolveMockShop(workspaceId);
  if (shop === "shop-b") return MOCK_AD_INSIGHTS_SHOP_B;
  return MOCK_AD_INSIGHTS_SHOP_A;
}

export function getMockAds(workspaceId?: string | null): MockAdRecord[] {
  return resolveMockShop(workspaceId) === "shop-b" ? ALL_SHOP_B_ADS : ALL_SHOP_A_ADS;
}

export function getMockLeads(workspaceId?: string | null): MockLeadRecord[] {
  return resolveMockShop(workspaceId) === "shop-b"
    ? FACEBOOK_SHOP_B_LEADS.data
    : FACEBOOK_SHOP_A_LEADS.data;
}

export const MOCK_PERSONAS: MockPersona[] = [
  {
    id: "mock-persona-shop-a-1",
    persona_name: "Tech-Savvy Millennial",
    shop: "shop-a",
    description: "18–34, mobile-first, brand-conscious early adopter",
    keywords: ["Retargeting", "Lead Gen", "Reels", "TopView"],
  },
  {
    id: "mock-persona-shop-a-2",
    persona_name: "Budget-Conscious Parent",
    shop: "shop-a",
    description: "25–44, deal-seeker, high purchase frequency",
    keywords: ["Flash Deal", "Sale", "Shopping", "Mega Sale", "In-Feed"],
  },
  {
    id: "mock-persona-shop-a-3",
    persona_name: "Small Business Owner",
    shop: "shop-a",
    description: "28–50, B2B buyer, high AOV, researches before purchasing",
    keywords: ["Search", "Display", "Lead", "Brand Awareness"],
  },
  {
    id: "mock-persona-shop-b-1",
    persona_name: "Skincare Enthusiast",
    shop: "shop-b",
    description: "18–35, ingredient-aware, organic/clean beauty advocate",
    keywords: ["Organic", "Skincare", "Spark Ads", "Beauty Trends", "Stories"],
  },
  {
    id: "mock-persona-shop-b-2",
    persona_name: "Luxury Beauty Buyer",
    shop: "shop-b",
    description: "28–45, high disposable income, brand-loyal, gift-buyer",
    keywords: ["VIP", "Luxury", "Premium", "PMax", "Conversion"],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// AUDIENCE DISCOVERY TRANSFORMER HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export interface GenderRow {
  id: string;
  name_gender: string;
}

/** Picks the dominant age bucket and parses to {age_min, age_max}. NaN-safe. */
export function parseAgeRange(
  ageDist: MockPersonaData["age_distribution"],
): { age_min: number; age_max: number | null } {
  const entries = Object.entries(ageDist);
  if (entries.length === 0) return { age_min: 18, age_max: 65 };

  const [range] = entries.sort(([, a], [, b]) => b - a)[0];

  if (range.includes("+")) {
    const min = parseInt(range.replace("+", ""), 10);
    return { age_min: isNaN(min) ? 18 : min, age_max: null };
  }

  const [minStr, maxStr] = range.split("-");
  const parsedMin = parseInt(minStr, 10);
  const parsedMax = parseInt(maxStr, 10);

  return {
    age_min: isNaN(parsedMin) ? 18 : parsedMin,
    age_max: isNaN(parsedMax) ? 65 : parsedMax,
  };
}

/** Maps dominant gender string to a DB UUID. Warns in DEV if no match found. */
export function resolveGenderId(
  genderDist: MockPersonaData["gender"],
  genderRows: GenderRow[],
): string | null {
  const dominant = Object.entries(genderDist)
    .filter(([k]) => k !== "unknown")
    .sort(([, a], [, b]) => b - a)[0];
  if (!dominant) return null;

  const [genderStr] = dominant;
  const match = genderRows.find(
    (g) => g.name_gender.toLowerCase() === genderStr.toLowerCase(),
  );

  if (!match && import.meta.env.DEV) {
    console.warn(
      `[resolveGenderId] No DB match for gender "${genderStr}". ` +
      `Available: [${genderRows.map((g) => g.name_gender).join(", ")}]. ` +
      `Returning null.`,
    );
  }

  return match?.id ?? null;
}

/** Returns top-10 interest names sorted by descending affinity. */
export function flattenInterests(interests: MockPersonaData["interests"]): string[] {
  return [...interests]
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 10)
    .map((i) => i.name);
}

/** Returns device names that represent >15% of traffic, sorted descending. */
export function mapDevices(deviceType: MockPersonaData["device_type"]): string[] {
  return Object.entries(deviceType)
    .filter(([, pct]) => pct > 0.15)
    .sort(([, a], [, b]) => b - a)
    .map(([name]) => name);
}

export interface DiscoveryCustomFields {
  discovery_source: {
    platforms: string[];
    timestamp: string;
  };
  raw_audience: {
    age_distribution: MockPersonaData["age_distribution"];
    gender_distribution: MockPersonaData["gender"];
    interest_details: MockPersonaData["interests"];
    device_distribution: MockPersonaData["device_type"];
    top_locations: MockPersonaData["top_locations"];
  };
  performance: {
    total_impressions: number;
    avg_ctr: number;
    avg_roas: number;
  };
}

/**
 * Transforms a weighted-average audience snapshot into a CustomerPersona-shaped
 * object ready to pre-fill CreatePersonaDialog.
 * NOTE: id = "" signals CREATE mode to the dialog. created_at = real ISO timestamp
 *       is used as the `key` prop to force dialog remount on each discovery click.
 */
/**
 * Transforms a Facebook Lead Ads submission into a CustomerPersona-shaped object
 * ready to pre-fill CreatePersonaDialog.
 *
 * Lead data doesn't carry age/gender, so those fields are left null for the user
 * to complete. The lead's contact info and company are stored in `custom_fields`
 * so nothing is lost.
 */
export function transformLeadToPersona(
  lead: MockLeadRecord,
  workspaceId: string,
): CustomerPersona {
  const now = new Date().toISOString();
  const fullName = getLeadField(lead, "full_name");
  const email = getLeadField(lead, "email");
  const phone = getLeadField(lead, "phone_number");
  const company = getLeadField(lead, "company_name");

  const customFields = {
    lead_source: {
      platform: "facebook",
      form_id: lead.form_id,
      ad_id: lead.ad_id,
      captured_at: lead.created_time,
    },
    contact: {
      full_name: fullName,
      email,
      phone,
      company,
    },
  };

  return {
    id: "",
    team_id: workspaceId,
    persona_name: fullName,
    description: `Lead captured from Facebook ad. Company: ${company || "N/A"}.`,
    avatar_url: null,
    gender_id: null,
    age_min: null,
    age_max: null,
    location_id: null,
    profession: company ? "Business Owner / Decision Maker" : null,
    company_size: null,
    salary_range: null,
    industry: null,
    preferred_devices: [],
    active_hours: null,
    interests: [],
    pain_points: null,
    goals: null,
    custom_fields: customFields as unknown as import("@/integrations/supabase/types").Json,
    is_active: true,
    is_template: false,
    psychographics: null,
    ad_targeting_mapping: null,
    created_at: now,
    updated_at: now,
    created_by: null,
  };
}

export function transformDiscoveryToPersona(
  audienceData: MockPersonaData,
  activePlatforms: string[],
  teamId: string,
  genderRows: GenderRow[],
  performance: { totalImpressions: number; avgCtr: number; avgRoas: number },
): CustomerPersona {
  const { age_min, age_max } = parseAgeRange(audienceData.age_distribution);
  const interestNames = flattenInterests(audienceData.interests);
  const devices = mapDevices(audienceData.device_type);
  const now = new Date().toISOString();

  const hasPlatform = (p: string) =>
    activePlatforms.some((ap) => ap.toLowerCase().includes(p.toLowerCase()));

  const adTargeting = {
    facebook: {
      interests: hasPlatform("facebook") ? interestNames : [] as string[],
      behaviors: [] as string[],
      custom_audiences: [] as string[],
    },
    google: {
      keywords: [] as string[],
      in_market: hasPlatform("google") ? interestNames : [] as string[],
      affinity: [] as string[],
    },
    tiktok: {
      interest_categories: hasPlatform("tiktok") ? interestNames : [] as string[],
      behavior_categories: [] as string[],
    },
  };

  const customFields: DiscoveryCustomFields = {
    discovery_source: {
      platforms: activePlatforms,
      timestamp: now,
    },
    raw_audience: {
      age_distribution: audienceData.age_distribution,
      gender_distribution: audienceData.gender,
      interest_details: audienceData.interests,
      device_distribution: audienceData.device_type,
      top_locations: audienceData.top_locations,
    },
    performance: {
      total_impressions: performance.totalImpressions,
      avg_ctr: performance.avgCtr,
      avg_roas: performance.avgRoas,
    },
  };

  const topLocation = audienceData.top_locations[0]?.name ?? "N/A";

  return {
    id: "",
    team_id: teamId,
    persona_name: "",
    description:
      `Discovered from ${activePlatforms.join(", ")} audience data. ` +
      `Top location: ${topLocation}. ` +
      `Avg CTR: ${performance.avgCtr.toFixed(2)}%, ROAS: ${performance.avgRoas.toFixed(2)}x.`,
    avatar_url: null,
    gender_id: resolveGenderId(audienceData.gender, genderRows),
    age_min,
    age_max,
    location_id: null,
    profession: null,
    company_size: null,
    salary_range: null,
    industry: null,
    preferred_devices: devices,
    active_hours: null,
    interests: interestNames,
    pain_points: null,
    goals: null,
    custom_fields: customFields as unknown as Json,
    is_active: true,
    is_template: false,
    psychographics: null,
    ad_targeting_mapping: adTargeting as unknown as Json,
    created_at: now,
    updated_at: now,
    created_by: null,
  };
}
