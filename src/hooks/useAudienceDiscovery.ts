import { useQuery } from "@tanstack/react-query";
import {
  USE_MOCK_DATA,
  getMockAds,
  getMockLeads,
  type MockAdRecord,
  type MockLeadRecord,
} from "@/lib/mock-api-data";
import { weightedAvg, type PersonaData } from "@/hooks/useAdPersonas";

export interface PerformanceSummary {
  totalImpressions: number;
  avgCtr: number;
  avgRoas: number;
  totalLeads: number;
}

export interface LiveAdRecord {
  id: string;
  name: string;
  platform: string;
  persona_data: unknown;
  impressions: number;
  ctr: number;
  roas: number;
}

interface AudienceDiscoveryData {
  audienceData: PersonaData | null;
  performanceSummary: PerformanceSummary | null;
  filteredAds: MockAdRecord[] | LiveAdRecord[];
  leads: MockLeadRecord[] | unknown[];
}

interface AudienceDiscoveryResult extends AudienceDiscoveryData {
  isLoading: boolean;
  error: Error | null;
}

export function useAudienceDiscovery(
  activePlatforms: string[],
  workspaceId?: string | null,
): AudienceDiscoveryResult {
  const { data, isLoading, error } = useQuery<AudienceDiscoveryData>({
    queryKey: ["audience-discovery", workspaceId, activePlatforms, USE_MOCK_DATA ? "mock" : "live"],
    enabled: activePlatforms.length > 0,
    queryFn: async (): Promise<AudienceDiscoveryData> => {
      if (activePlatforms.length === 0) {
        return { audienceData: null, performanceSummary: null, filteredAds: [], leads: [] };
      }

      if (USE_MOCK_DATA) {
        const allAds = getMockAds(workspaceId);
        const filtered = allAds.filter((ad) =>
          activePlatforms.some((p) =>
            ad.platform.toLowerCase().includes(p.toLowerCase()),
          ),
        );

        // Include leads only when Facebook is among the selected platforms
        const includesFacebook = activePlatforms.some((p) =>
          p.toLowerCase().includes("facebook"),
        );
        const leads = includesFacebook ? getMockLeads(workspaceId) : [];

        if (filtered.length === 0) {
          return { audienceData: null, performanceSummary: null, filteredAds: [], leads };
        }

        const audienceData = weightedAvg(
          filtered.map((ad) => ({
            persona_data: ad.persona_data as PersonaData,
            weight: ad.impressions,
          })),
        );

        const totalImpressions = filtered.reduce((s, a) => s + a.impressions, 0);
        const avgCtr =
          filtered.length > 0
            ? filtered.reduce((s, a) => s + a.ctr, 0) / filtered.length
            : 0;
        const avgRoas =
          filtered.length > 0
            ? filtered.reduce((s, a) => s + a.roas, 0) / filtered.length
            : 0;

        return {
          audienceData,
          performanceSummary: { totalImpressions, avgCtr, avgRoas, totalLeads: leads.length },
          filteredAds: filtered,
          leads,
        };
      }

      // Live mode: read from ads + ad_insights + customer_personas
      const { supabase } = await import("@/integrations/supabase/client");

      const { data: adsData, error: adsError } = await supabase
        .from("ads")
        .select("id, name, platform, persona_data")
        .eq("team_id", workspaceId)
        .not("persona_data", "is", null);

      if (adsError) throw adsError;

      const filtered = (adsData ?? []).filter((ad) =>
        activePlatforms.some((p) => ad.platform?.toLowerCase().includes(p.toLowerCase()))
      );

      if (filtered.length === 0) {
        return { audienceData: null, performanceSummary: null, filteredAds: [], leads: [] };
      }

      const adIds = filtered.map((a) => a.id);
      const { data: insightsData, error: insightsError } = await supabase
        .from("ad_insights")
        .select("ads_id, impressions, ctr, roas, leads")
        .in("ads_id", adIds);

      if (insightsError) throw insightsError;

      const metricsMap = new Map<string, { impressions: number; ctr: number; roas: number }>();
      for (const row of insightsData ?? []) {
        const prev = metricsMap.get(row.ads_id) ?? { impressions: 0, ctr: 0, roas: 0 };
        metricsMap.set(row.ads_id, {
          impressions: prev.impressions + (row.impressions ?? 0),
          ctr: row.ctr ?? prev.ctr,
          roas: row.roas ?? prev.roas,
        });
      }

      const enrichedAds: LiveAdRecord[] = filtered.map((ad) => ({
        id: ad.id,
        name: ad.name,
        platform: ad.platform,
        persona_data: ad.persona_data,
        impressions: metricsMap.get(ad.id)?.impressions ?? 0,
        ctr: metricsMap.get(ad.id)?.ctr ?? 0,
        roas: metricsMap.get(ad.id)?.roas ?? 0,
      }));

      const audienceData = weightedAvg(
        enrichedAds.map((ad) => ({
          persona_data: ad.persona_data as PersonaData,
          weight: ad.impressions,
        }))
      );

      const totalImpressions = enrichedAds.reduce((s, a) => s + a.impressions, 0);
      const avgCtr = enrichedAds.reduce((s, a) => s + a.ctr, 0) / enrichedAds.length;
      const avgRoas = enrichedAds.reduce((s, a) => s + a.roas, 0) / enrichedAds.length;

      const includesFacebook = activePlatforms.some((p) => p.toLowerCase().includes("facebook"));
      let leads: unknown[] = [];
      if (includesFacebook) {
        const { data: personasData } = await supabase
          .from("customer_personas")
          .select("id, persona_name, custom_fields")
          .eq("team_id", workspaceId!)
          .eq("is_template", false)
          .not("custom_fields->lead_id", "is", null);

        leads = (personasData ?? []).map((p) => ({
          id: p.id,
          full_name: p.persona_name,
          ...(p.custom_fields as object),
        }));
      }

      return {
        audienceData,
        performanceSummary: { totalImpressions, avgCtr, avgRoas, totalLeads: leads.length },
        filteredAds: enrichedAds,
        leads,
      };
    },
  });

  return {
    audienceData: data?.audienceData ?? null,
    performanceSummary: data?.performanceSummary ?? null,
    filteredAds: data?.filteredAds ?? [],
    leads: data?.leads ?? [],
    isLoading,
    error: error as Error | null,
  };
}
