import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  USE_MOCK_DATA,
  MOCK_AD_INSIGHTS_SHOP_A,
  FACEBOOK_SHOP_A_ADS,
} from "@/lib/mock-api-data";

export interface PersonaInsightsSummary {
  impressions: number;
  clicks: number;
  ctr: number;
  spend: number;
  conversions: number;
  roas: number;
}

export interface PersonaInsightsDailyPoint {
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
}

export interface PersonaLinkedAd {
  id: string;
  name: string;
  creative_type: string | null;
  status: string | null;
  platform: string | null;
  impressions: number;
  clicks: number;
  ctr: number;
  spend: number;
  conversions: number;
}

interface AdPersonaLinkRow {
  ad_id: string;
  ads: {
    id: string;
    name: string;
    creative_type: string | null;
    status: string | null;
    platform: string | null;
  } | null;
}

interface AdInsightRow {
  ads_id: string | null;
  date: string;
  impressions: number | null;
  clicks: number | null;
  spend: string | null;
  conversions: number | null;
  roas: string | null;
}

// ── Mock data helpers ────────────────────────────────────────────────────────

/** Deterministically pick top-N Facebook ads to "link" to a persona in mock mode. */
function getMockLinkedAds(personaId: string): AdPersonaLinkRow[] {
  // Use charCode sum of personaId as a seed to pick a stable subset of ads
  const seed = personaId.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  const ads = FACEBOOK_SHOP_A_ADS.data;
  const startIdx = seed % ads.length;
  // Always return 3 ads, wrapping around if needed
  return [0, 1, 2].map((i) => {
    const ad = ads[(startIdx + i) % ads.length];
    return {
      ad_id: ad.external_ad_id,
      ads: {
        id: ad.external_ad_id,
        name: ad.ad_name,
        creative_type: "carousel",
        status: ad.status.toLowerCase(),
        platform: ad.platform,
      },
    };
  });
}

/** Generate daily insight rows from the global mock pool for given ad IDs. */
function getMockInsightRows(adIds: string[]): AdInsightRow[] {
  // Pull the first campaign's daily rows as a proxy for persona-linked insights
  const adIdSet = new Set(adIds);
  const rows = MOCK_AD_INSIGHTS_SHOP_A.filter(
    (r) => r.ad_account_id?.includes("facebook"),
  ).slice(0, 42); // ~6 weeks of rows from first FB campaign

  // Re-label ads_id to cycle through the linked ad IDs so per-ad breakdowns work
  const adArray = Array.from(adIdSet);
  return rows.map((r, i) => ({
    ...r,
    ads_id: adArray[i % adArray.length],
    // scale values slightly per ad to differentiate them
    impressions: Math.round((r.impressions ?? 0) * (0.6 + (i % 3) * 0.2)),
    clicks: Math.round((r.clicks ?? 0) * (0.6 + (i % 3) * 0.2)),
    spend: parseFloat(((r.spend ?? 0) * (0.6 + (i % 3) * 0.2)).toFixed(2)),
  })) as unknown as AdInsightRow[];
}

// ── Main hook ────────────────────────────────────────────────────────────────

export function usePersonaInsights(personaId: string | undefined) {
  // Step 1: Fetch ads linked to this persona via junction table (or mock)
  const { data: adPersonaLinks = [], isLoading: linksLoading } = useQuery({
    queryKey: ["persona-ad-links", personaId, USE_MOCK_DATA ? "mock" : "live"],
    enabled: !!personaId,
    queryFn: async () => {
      if (USE_MOCK_DATA) {
        return getMockLinkedAds(personaId!);
      }
      const { data, error } = await supabase
        .from("ad_personas")
        .select("ad_id, ads(id, name, creative_type, status, platform)")
        .eq("persona_id", personaId!);
      if (error) throw error;
      return (data ?? []) as AdPersonaLinkRow[];
    },
  });

  const adIds = useMemo(
    () => adPersonaLinks.map((l) => l.ad_id),
    [adPersonaLinks]
  );

  // Step 2: Fetch ad_insights for linked ads (or mock)
  const { data: insightsRaw = [], isLoading: insightsLoading } = useQuery({
    queryKey: ["persona-insights-data", personaId, adIds.join(","), USE_MOCK_DATA ? "mock" : "live"],
    enabled: !!personaId && adIds.length > 0,
    queryFn: async () => {
      if (USE_MOCK_DATA) {
        return getMockInsightRows(adIds) as unknown as AdInsightRow[];
      }
      const { data, error } = await supabase
        .from("ad_insights")
        .select("ads_id, date, impressions, clicks, spend, conversions, roas")
        .in("ads_id", adIds)
        .order("date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as AdInsightRow[];
    },
  });

  // Aggregate summary KPIs
  const summary = useMemo((): PersonaInsightsSummary => {
    const totalImpressions = insightsRaw.reduce(
      (s, r) => s + (r.impressions ?? 0),
      0
    );
    const totalClicks = insightsRaw.reduce((s, r) => s + (r.clicks ?? 0), 0);
    const totalSpend = insightsRaw.reduce(
      (s, r) => s + Number(r.spend ?? 0),
      0
    );
    const totalConversions = insightsRaw.reduce(
      (s, r) => s + (r.conversions ?? 0),
      0
    );
    const roasSum = insightsRaw.reduce((s, r) => s + Number(r.roas ?? 0), 0);
    return {
      impressions: totalImpressions,
      clicks: totalClicks,
      ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
      spend: totalSpend,
      conversions: totalConversions,
      roas: insightsRaw.length > 0 ? roasSum / insightsRaw.length : 0,
    };
  }, [insightsRaw]);

  // Group insights by date for daily chart
  const dailyData = useMemo((): PersonaInsightsDailyPoint[] => {
    const byDate = new Map<string, PersonaInsightsDailyPoint>();
    for (const row of insightsRaw) {
      const key = row.date;
      if (!byDate.has(key)) {
        byDate.set(key, {
          date: key,
          impressions: 0,
          clicks: 0,
          spend: 0,
          conversions: 0,
        });
      }
      const entry = byDate.get(key)!;
      entry.impressions += row.impressions ?? 0;
      entry.clicks += row.clicks ?? 0;
      entry.spend += Number(row.spend ?? 0);
      entry.conversions += row.conversions ?? 0;
    }
    return Array.from(byDate.values());
  }, [insightsRaw]);

  // Per-ad metrics for linked ads table
  const linkedAds = useMemo((): PersonaLinkedAd[] => {
    return adPersonaLinks.map((link) => {
      const ad = link.ads;
      const adInsights = insightsRaw.filter((r) => r.ads_id === link.ad_id);
      const impressions = adInsights.reduce(
        (s, r) => s + (r.impressions ?? 0),
        0
      );
      const clicks = adInsights.reduce((s, r) => s + (r.clicks ?? 0), 0);
      const spend = adInsights.reduce(
        (s, r) => s + Number(r.spend ?? 0),
        0
      );
      const conversions = adInsights.reduce(
        (s, r) => s + (r.conversions ?? 0),
        0
      );
      return {
        id: link.ad_id,
        name: ad?.name ?? "Untitled Ad",
        creative_type: ad?.creative_type ?? null,
        status: ad?.status ?? null,
        platform: ad?.platform ?? null,
        impressions,
        clicks,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        spend,
        conversions,
      };
    });
  }, [adPersonaLinks, insightsRaw]);

  return {
    summary,
    dailyData,
    linkedAds,
    isLoading: linksLoading || (adIds.length > 0 && insightsLoading),
    hasLinkedAds: adIds.length > 0,
  };
}
