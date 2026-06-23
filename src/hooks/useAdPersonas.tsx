import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "./useWorkspace";
import { USE_MOCK_DATA, getMockAds } from "@/lib/mock-api-data";

export interface PersonaData {
  age_distribution: Record<string, number>;
  gender: Record<string, number>;
  top_locations: { name: string; pct: number }[];
  interests: { name: string; pct: number }[];
  device_type: Record<string, number>;
}

export type AdAudienceMode = "all" | "ad" | "campaign";

interface AdPersonaFilter {
  mode: AdAudienceMode;
  adId?: string;
  campaignId?: string;
}

export function weightedAvg(ads: { persona_data: PersonaData; weight: number }[]): PersonaData | null {
  const totalWeight = ads.reduce((s, a) => s + a.weight, 0);
  if (totalWeight === 0 || ads.length === 0) return null;

  const locMap: Record<string, number> = {};
  const intMap: Record<string, number> = {};
  const ageKeys = new Set<string>();
  const genderKeys = new Set<string>();
  const deviceKeys = new Set<string>();

  for (const { persona_data: p, weight } of ads) {
    const w = weight / totalWeight;
    Object.keys(p.age_distribution ?? {}).forEach(k => ageKeys.add(k));
    Object.keys(p.gender ?? {}).forEach(k => genderKeys.add(k));
    Object.keys(p.device_type ?? {}).forEach(k => deviceKeys.add(k));
    (p.top_locations ?? []).forEach(l => { locMap[l.name] = (locMap[l.name] ?? 0) + l.pct * w; });
    (p.interests ?? []).forEach(i => { intMap[i.name] = (intMap[i.name] ?? 0) + i.pct * w; });
  }

  const aggRecord = (
    keys: Set<string>,
    field: "age_distribution" | "gender" | "device_type",
  ): Record<string, number> =>
    Object.fromEntries(
      [...keys].map(k => [
        k,
        ads.reduce((s, { persona_data: p, weight }) =>
          s + ((p[field] as Record<string, number>)?.[k] ?? 0) * weight, 0) / totalWeight,
      ])
    );

  return {
    age_distribution: aggRecord(ageKeys, "age_distribution"),
    gender: aggRecord(genderKeys, "gender"),
    device_type: aggRecord(deviceKeys, "device_type"),
    top_locations: Object.entries(locMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, pct]) => ({ name, pct })),
    interests: Object.entries(intMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, pct]) => ({ name, pct })),
  };
}

type AdWithPersona = { id: string; persona_data: PersonaData; name: string; platform: string | null };

function buildMockAdsWithPersona(workspaceId: string | null): AdWithPersona[] {
  const mockAds = getMockAds(workspaceId);
  return mockAds.map((ad, i) => ({
    id: `mock-ad-${i}`,
    name: ad.ad_name ?? "Untitled Ad",
    platform: ad.platform ?? null,
    persona_data: ad.persona_data as PersonaData,
  }));
}

export function useAdPersonas({ mode, adId, campaignId }: AdPersonaFilter) {
  const { workspace } = useWorkspace();
  const workspaceId = workspace.id;

  // Fetch all workspace ads that have persona_data (minimal columns for performance)
  const { data: adsRaw = [], isLoading: adsLoading } = useQuery({
    queryKey: ["ad-personas-ads", workspaceId, USE_MOCK_DATA ? "mock" : "live"],
    enabled: !!workspaceId || USE_MOCK_DATA,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AdWithPersona[]> => {
      if (USE_MOCK_DATA) {
        return buildMockAdsWithPersona(workspaceId ?? null);
      }
      const { data, error } = await supabase
        .from("ads")
        .select("id, persona_data, name, platform")
        .eq("team_id", workspaceId)
        .not("persona_data", "is", null);
      if (error) throw error;
      return data as unknown as AdWithPersona[];
    },
  });

  // Fetch impressions per ad (for weighting and total display).
  const { data: insightsRaw = [], isLoading: insightsLoading } = useQuery({
    queryKey: ["ad-personas-insights", workspaceId, USE_MOCK_DATA ? "mock" : "live"],
    enabled: !USE_MOCK_DATA && !!workspaceId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_insights")
        .select("ads_id, impressions");
      if (error) throw error;
      return data as { ads_id: string | null; impressions: number | null }[];
    },
  });

  // Fetch campaign → ad assignments (only when campaign filter is active)
  const { data: campaignAdsRaw = [], isLoading: campaignAdsLoading } = useQuery({
    queryKey: ["ad-personas-campaign-ads", workspaceId],
    enabled: mode === "campaign" && !USE_MOCK_DATA,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_ads")
        .select("campaign_id, ad_id");
      if (error) throw error;
      return data as { campaign_id: string; ad_id: string }[];
    },
  });

  // Mock impressions: use fixture impressions for weighting when in mock mode
  const mockImpressionsMap = useMemo(() => {
    if (!USE_MOCK_DATA) return {};
    const mockAds = getMockAds(workspaceId ?? null);
    const map: Record<string, number> = {};
    mockAds.forEach((ad, i) => {
      map[`mock-ad-${i}`] = ad.impressions ?? 1;
    });
    return map;
  }, [workspaceId]);

  // Aggregate impressions per ad for weighting
  const impressionsMap = useMemo(() => {
    if (USE_MOCK_DATA) return mockImpressionsMap;
    const map: Record<string, number> = {};
    for (const row of insightsRaw) {
      if (row.ads_id) map[row.ads_id] = (map[row.ads_id] ?? 0) + (row.impressions ?? 0);
    }
    return map;
  }, [insightsRaw, mockImpressionsMap]);

  // Only fall back to mock data when the mock flag is explicitly enabled
  const effectiveAds = useMemo((): AdWithPersona[] => {
    if (adsRaw.length > 0) return adsRaw;
    if (USE_MOCK_DATA) return buildMockAdsWithPersona(workspaceId ?? null);
    return []; // no real ads exist for this workspace
  }, [adsRaw, workspaceId]);

  const personaData = useMemo((): PersonaData | null => {
    if (!effectiveAds.length) return null;

    if (mode === "ad") {
      const ad = effectiveAds.find(a => a.id === adId);
      return ad?.persona_data ?? null;
    }

    let targetAds = effectiveAds;
    if (mode === "campaign" && campaignId && !USE_MOCK_DATA && campaignAdsRaw.length > 0) {
      const adIds = new Set(
        campaignAdsRaw.filter(r => r.campaign_id === campaignId).map(r => r.ad_id)
      );
      targetAds = effectiveAds.filter(a => adIds.has(a.id));
    }

    return weightedAvg(
      targetAds.map(a => ({
        persona_data: a.persona_data,
        weight: impressionsMap[a.id] ?? 1, // fallback weight=1 so zero-impression ads still count
      }))
    );
  }, [mode, adId, campaignId, effectiveAds, campaignAdsRaw, impressionsMap]);

  const totalImpressions = useMemo(() => {
    if (!personaData) return 0;
    if (mode === "ad" && adId) {
      return impressionsMap[adId] ?? 0;
    }
    if (mode === "campaign" && campaignId && !USE_MOCK_DATA) {
      const adIds = new Set(
        campaignAdsRaw.filter(r => r.campaign_id === campaignId).map(r => r.ad_id)
      );
      return effectiveAds
        .filter(a => adIds.has(a.id))
        .reduce((s, a) => s + (impressionsMap[a.id] ?? 0), 0);
    }
    return effectiveAds.reduce((s, a) => s + (impressionsMap[a.id] ?? 0), 0);
  }, [mode, adId, campaignId, effectiveAds, campaignAdsRaw, impressionsMap, personaData]);

  const isLoading =
    !USE_MOCK_DATA &&
    (adsLoading ||
      (mode !== "ad" && insightsLoading) ||
      (mode === "campaign" && campaignAdsLoading));

  const isFallbackData = effectiveAds.length > 0 && adsRaw.length === 0 && !USE_MOCK_DATA;

  return {
    personaData,
    isLoading,
    adsWithPersona: effectiveAds,
    totalImpressions,
    isFallbackData,
  };
}
