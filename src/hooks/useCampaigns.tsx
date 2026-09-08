import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useLoyaltyTier } from "@/hooks/useLoyaltyTier";
import { auditCampaign } from "@/lib/auditLogger";
import { logError } from "@/services/errorLogger";

// ─── Client-side progress calculator (mirrors supabase/functions/_shared/campaignProgress.ts) ──
//
// Process: overallProgress = (kpiProgress × 0.5) + (timeProgress × 0.5)
//   • timeProgress: 0–100, based on start_date → end_date (วันสุดท้าย). 100% when now >= end_date.
//   • kpiProgress: 0–100, based on target KPI (clicks/conversions/spend/impressions) vs actual.
//   • Reaches 100% only when BOTH time and KPI individually reach 100%.

export interface ProgressResult {
  timeProgress: number;
  kpiProgress: number;
  overallProgress: number;
  kpiLabel: string;
  kpiActual: number;
  kpiTarget: number;
}

type CampaignProgressInput = Pick<
  CampaignWithInsights,
  | "start_date" | "end_date"
  | "clicks" | "spend" | "conversions" | "impressions"
> & {
  target_kpi_clicks?: number | null;
  target_kpi_conversions?: number | null;
  target_kpi_spend?: number | null;
  target_kpi_impressions?: number | null;
  target_kpi_metric?: string | null;
  target_kpi_value?: number | null;
};

export function calculateCampaignProgress(
  c: CampaignProgressInput,
  nowMs?: number,
): ProgressResult {
  const now = nowMs ?? Date.now();

  const start = c.start_date ? new Date(c.start_date).getTime() : null;
  const end = c.end_date ? new Date(c.end_date).getTime() : null;

  let timeProgress = 0;
  if (start !== null && end !== null && end > start) {
    if (now >= end) timeProgress = 100;
    else if (now > start) timeProgress = Math.min(100, Math.round(((now - start) / (end - start)) * 100));
  }

  const targets: { label: string; actual: number; target: number }[] = [];
  if ((c.target_kpi_clicks ?? 0) > 0) {
    targets.push({ label: "Clicks", actual: c.clicks ?? 0, target: c.target_kpi_clicks! });
  }
  if ((c.target_kpi_conversions ?? 0) > 0) {
    targets.push({ label: "Conversions", actual: c.conversions ?? 0, target: c.target_kpi_conversions! });
  }
  if ((c.target_kpi_spend ?? 0) > 0) {
    targets.push({ label: "Spend", actual: c.spend ?? 0, target: c.target_kpi_spend! });
  }
  if ((c.target_kpi_impressions ?? 0) > 0) {
    targets.push({ label: "Impressions", actual: c.impressions ?? 0, target: c.target_kpi_impressions! });
  }

  // Fallback to legacy single KPI
  if (targets.length === 0 && c.target_kpi_metric && (c.target_kpi_value ?? 0) > 0) {
    const KPI_MAP: Record<string, { label: string; value: number }> = {
      clicks: { label: "Clicks", value: c.clicks ?? 0 },
      spend: { label: "Spend", value: c.spend ?? 0 },
      conversions: { label: "Conversions", value: c.conversions ?? 0 },
      impressions: { label: "Impressions", value: c.impressions ?? 0 },
    };
    const def = KPI_MAP[c.target_kpi_metric];
    if (def) targets.push({ label: def.label, actual: def.value, target: c.target_kpi_value! });
  }

  let kpiProgress = 0;
  let kpiLabel = "No KPI set";
  let kpiActual = 0;
  let kpiTarget = 0;

  if (targets.length > 0) {
    const progresses = targets.map((t) =>
      t.target > 0 ? Math.min(100, Math.round((t.actual / t.target) * 100)) : 0,
    );
    kpiProgress = Math.round(progresses.reduce((a, b) => a + b, 0) / progresses.length);
    kpiLabel = targets.map((t) => t.label).join(", ");
    kpiActual = targets.reduce((s, t) => s + t.actual, 0);
    kpiTarget = targets.reduce((s, t) => s + t.target, 0);
  }

  const overallProgress = Math.round((kpiProgress * 0.5) + (timeProgress * 0.5));

  return { timeProgress, kpiProgress, overallProgress, kpiLabel, kpiActual, kpiTarget };
}

export type Campaign = Database["public"]["Tables"]["campaigns"]["Row"];
export type CampaignInsert = Database["public"]["Tables"]["campaigns"]["Insert"];
export type CampaignUpdate = Database["public"]["Tables"]["campaigns"]["Update"];

// Extended campaign with insights
import { Tag } from "./useTags";

export interface CampaignWithInsights extends Campaign {
  impressions: number;
  reach: number;
  clicks: number;
  conversions: number;
  spend: number;
  tags: Tag[];
  ad_account_name?: string | null;
  ad_ids?: string[];
}

export function useCampaigns() {
  const queryClient = useQueryClient();
  const { workspace } = useWorkspace();
  const workspaceId = workspace.id;
  const { refetch: refetchLoyalty } = useLoyaltyTier();

  const { data: campaigns = [], isLoading, error } = useQuery({
    queryKey: ["campaigns", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      // Get campaigns with tags and ad account name
      const { data: campaignsData, error: campaignsError } = await supabase
        .from("campaigns")
        .select(`
          *,
          ad_accounts(account_name),
          campaign_tags (
            tag_id,
            tags (
              id,
              name,
              color_code,
              entity_type
            )
          )
        `)
        .or(`team_id.eq.${workspaceId},team_id.is.null`)
        .order("created_at", { ascending: false });

      if (campaignsError) throw campaignsError;

      // Get campaign → ad assignments
      const { data: campaignAdsData } = await supabase
        .from("campaign_ads")
        .select("campaign_id, ad_id");

      const campaignAdsMap = ((campaignAdsData ?? []) as { campaign_id: string; ad_id: string }[])
        .reduce<Record<string, string[]>>((acc, row) => {
          if (!acc[row.campaign_id]) acc[row.campaign_id] = [];
          acc[row.campaign_id].push(row.ad_id);
          return acc;
        }, {});

      // Aggregate insights via two paths:
      //   Primary:   campaign_ads → ad_insights.ads_id (user-assigned ads; standard path)
      //   Fallback:  ad_insights.campaign_id (legacy direct link; not set by current ingestion)
      // Ingested ads always have campaign_id = null — their insights only surface once the user
      // assigns them to a campaign in the Campaign Builder (which populates campaign_ads).
      // Rows with a direct campaign_id still work to avoid breaking any legacy data.
      const { data: insights, error: insightsError } = await supabase
        .from("ad_insights")
        .select("campaign_id, ads_id, impressions, reach, clicks, conversions, spend");

      if (insightsError) throw insightsError;

      type Metrics = { impressions: number; reach: number; clicks: number; conversions: number; spend: number };
      const zero: Metrics = { impressions: 0, reach: 0, clicks: 0, conversions: 0, spend: 0 };

      const campaignDirectMap: Record<string, Metrics> = {};
      const adInsightsMap: Record<string, Metrics> = {};

      for (const row of insights ?? []) {
        const addTo = (map: Record<string, Metrics>, key: string) => {
          if (!map[key]) map[key] = { ...zero };
          map[key].impressions += row.impressions || 0;
          map[key].reach += row.reach || 0;
          map[key].clicks += row.clicks || 0;
          map[key].conversions += row.conversions || 0;
          map[key].spend += Number(row.spend || 0);
        };
        if (row.campaign_id) {
          addTo(campaignDirectMap, row.campaign_id);
        } else if (row.ads_id) {
          // Only use ads_id path when there is no direct campaign_id to avoid double-counting
          addTo(adInsightsMap, row.ads_id);
        }
      }

      return (campaignsData ?? []).map((campaign) => {
        const adIds = campaignAdsMap[campaign.id] ?? [];

        // Prefer direct campaign-level insights; otherwise sum via ad assignments
        const agg: Metrics = campaignDirectMap[campaign.id]
          ? { ...campaignDirectMap[campaign.id] }
          : adIds.reduce(
            (sum, adId) => {
              const m = adInsightsMap[adId];
              if (!m) return sum;
              return {
                impressions: sum.impressions + m.impressions,
                reach: sum.reach + m.reach,
                clicks: sum.clicks + m.clicks,
                conversions: sum.conversions + m.conversions,
                spend: sum.spend + m.spend,
              };
            },
            { ...zero },
          );
        return {
          ...campaign,
          ...agg,
          tags: campaign.campaign_tags?.map((ct) => ct.tags).filter(Boolean) || [],
          ad_account_name: campaign.ad_accounts?.account_name ?? null,
          ad_ids: adIds,
        };
      }) as unknown as CampaignWithInsights[];
    },
  });

  const createCampaign = useMutation({
    mutationFn: async (input: CampaignInsert & { adIds?: string[] }) => {
      const { adIds = [], ...newCampaign } = input;

      const { data, error } = await supabase
        .from("campaigns")
        .insert({ ...newCampaign, team_id: workspaceId })
        .select();

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Failed to create campaign");
      }
      
      const campaignData = data[0];

      if (adIds.length > 0) {
        const { error: junctionError } = await supabase
          .from("campaign_ads")
          .insert(adIds.map((adId: string) => ({ campaign_id: campaignData.id, ad_id: adId })));
        if (junctionError) throw junctionError;
      }

      return campaignData;
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ["campaigns", workspaceId] });
      toast.success("สร้างแคมเปญสำเร็จ");

      // Log campaign creation
      const { data: { user } } = await getCurrentUser();
      if (user && data) {
        await auditCampaign.campaignCreated(user.id, data.id, data.name || 'Unnamed Campaign');
      }

      // Mission 4: award points for creating the first campaign (one-time)
      const { data: missionRaw, error: missionError } = await supabase.rpc(
        'award_loyalty_points',
        { p_action_type: 'create_campaign' }
      );
      const missionResult = missionRaw as { success?: boolean; points_awarded?: number } | null;
      if (missionResult?.success) {
        toast.success(`🎉 Mission Complete! +${missionResult.points_awarded} Points for launching your first Campaign!`);
        window.dispatchEvent(new CustomEvent('loyalty-refetch'));
      } else if (missionError) {
        void logError('useCampaigns.createCampaign.mission', new Error(missionError.message), {
          hook: 'useCampaigns',
          code: missionError.code,
        });
        toast.error(
          'แคมเปญถูกบันทึกแล้ว แต่ระบบแต้มอัปเดตไม่สำเร็จ — ตรวจสอบ Supabase env และ migration บนโปรเจกต์คลาวด์'
        );
      }
    },
    onError: (error: Error) => {
      toast.error(`ไม่สามารถสร้างแคมเปญ: ${error.message}`);
    },
  });

  const updateCampaign = useMutation({
    mutationFn: async ({
      id,
      updates,
      adIds,
    }: {
      id: string;
      updates: CampaignUpdate;
      adIds?: string[];
    }) => {
      const updateData = Object.keys(updates).length > 0 
        ? updates 
        : { updated_at: new Date().toISOString() } as CampaignUpdate;

      const { data, error } = await supabase
        .from("campaigns")
        .update(updateData)
        .eq("id", id)
        .select();

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Cannot find campaign or permission denied");
      }

      const campaignData = data[0];

      // Replace ad assignments when adIds is explicitly provided
      if (adIds !== undefined) {
        const { error: deleteError } = await supabase
          .from("campaign_ads")
          .delete()
          .eq("campaign_id", id);
        if (deleteError) throw deleteError;

        if (adIds.length > 0) {
          const { error: insertError } = await supabase
            .from("campaign_ads")
            .insert(adIds.map((adId) => ({ campaign_id: id, ad_id: adId })));
          if (insertError) throw insertError;
        }
      }

      return campaignData;
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ["campaigns", workspaceId] });
      toast.success("อัปเดตแคมเปญสำเร็จ");

      // Log campaign update
      const { data: { user } } = await getCurrentUser();
      if (user && data) {
        await auditCampaign.campaignCreated(user.id, data.id, `Updated: ${data.name || 'Campaign'}`);
      }
    },
    onError: (error: Error) => {
      toast.error(`ไม่สามารถอัปเดตแคมเปญ: ${error.message}`);
    },
  });

  const deleteCampaign = useMutation({
    mutationFn: async (id: string) => {
      // Fetch campaign name before deletion for logging
      const { data: campaign } = await supabase.from("campaigns").select("id,name").eq("id", id).single();
      const { error } = await supabase
        .from("campaigns")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return campaign;
    },
    onSuccess: async (campaign) => {
      queryClient.invalidateQueries({ queryKey: ["campaigns", workspaceId] });
      toast.success("ลบแคมเปญสำเร็จ");

      // Log campaign deletion
      const { data: { user } } = await getCurrentUser();
      if (user && campaign) {
        await auditCampaign.campaignDeleted(user.id, campaign.id, campaign.name || 'Unnamed Campaign');
      }
    },
    onError: (error: Error) => {
      toast.error(`ไม่สามารถลบแคมเปญ: ${error.message}`);
    },
  });

  return {
    campaigns,
    isLoading,
    error,
    createCampaign,
    updateCampaign,
    deleteCampaign,
  };
}
