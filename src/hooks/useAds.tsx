import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { useWorkspace } from "./useWorkspace";
import { invalidateSocialRealtimeQueries } from "@/lib/socialQueryInvalidation";
import { backendUrl } from "@/lib/mockApiKeys";
import { USE_MOCK_DATA } from "@/lib/mock-api-data";

export type Ad = Database["public"]["Tables"]["ads"]["Row"];
export type AdInsert = Database["public"]["Tables"]["ads"]["Insert"];
export type AdUpdate = Database["public"]["Tables"]["ads"]["Update"];
type SocialPostUpdate = Database["public"]["Tables"]["social_posts"]["Update"];
export const adsKeys = {
  all: ["ads"] as const,
  list: (workspaceId?: string) => ["ads", workspaceId] as const,
};

export interface AdPersonaLink {
  persona_id: string;
  customer_personas: {
    id: string;
    persona_name: string;
    avatar_url: string | null;
  } | null;
}

export interface AdGroupSummary {
  id: string;
  name: string;
}

type ExtendedAdInsert = AdInsert & {
  budget?: number | null;
};

type ExtendedAdUpdate = AdUpdate & {
  budget?: number | null;
};

function buildMirrorPostUpdates(updates: ExtendedAdUpdate): SocialPostUpdate {
  return {
    ad_group_id: updates.ad_group_id ?? null,
    content: updates.content ?? null,
    media_urls: updates.media_urls ?? null,
    name: updates.name ?? null,
    platform_id: updates.platform ?? null,
    post_type: updates.creative_type ?? null,
    scheduled_at: updates.scheduled_at ?? null,
    status: updates.status ?? null,
  };
}

interface CreateAdWithMirrorPostParams {
  p_team_id: string;
  p_name: string;
  p_status: string;
  p_creative_type: string;
  p_headline: string | null;
  p_ad_copy: string | null;
  p_call_to_action: string | null;
  p_content: string | null;
  p_media_urls: string[] | null;
  p_scheduled_at: string | null;
  p_ad_group_id: string | null;
  p_platform_id: string | null;
  p_creative_url: string | null;
  p_platform_ad_id: string | null;
  p_preview_url: string | null;
  p_budget: number | null;
}

interface CreateAdWithMirrorPostMockResponse {
  data: Ad;
}

function shouldFallbackToMockRpc(errorMessage: string): boolean {
  const normalized = errorMessage.toLowerCase();
  return (
    normalized.includes("create_ad_with_mirror_post") &&
    (normalized.includes("could not find the function") ||
      normalized.includes("function") ||
      normalized.includes("not found"))
  );
}

// Extends Ad with joined relations and fields not yet fully typed
export type AdWithPublishStatus = Ad & {
  ad_groups?: AdGroupSummary | null;
  ad_personas: AdPersonaLink[] | null;
  budget?: number | null;
};

export function useAds() {
  const queryClient = useQueryClient();
  const { workspace } = useWorkspace();

  const { data: ads = [], isLoading, error } = useQuery({
    queryKey: adsKeys.list(workspace?.id),
    enabled: !!workspace?.id,
    queryFn: async () => {
      if (!workspace?.id) return [];

      const { data, error } = await supabase
        .from("ads")
        .select(
          "*, ad_groups(id, name), ad_personas(persona_id, customer_personas(id, persona_name, avatar_url))"
        )
        .eq("team_id", workspace.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as AdWithPublishStatus[];
    },
  });

  const createAd = useMutation({
    mutationFn: async (newAd: ExtendedAdInsert) => {
      if (!workspace?.id) throw new Error("No active workspace");
      const payload = { ...newAd, team_id: workspace.id } as unknown as AdInsert;
      const { data, error } = await supabase
        .from("ads")
        .insert(payload)
        .select();

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Failed to create ad");
      }
      return data[0];
    },
    onSuccess: () => {
      void invalidateSocialRealtimeQueries(queryClient);
      toast.success("สร้างโฆษณาสำเร็จ");
    },
    onError: (error: Error) => {
      toast.error(`ไม่สามารถสร้างโฆษณา: ${error.message}`);
    },
  });

  const updateAd = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: ExtendedAdUpdate }) => {
      const payload = updates as unknown as AdUpdate;
      const { data, error } = await supabase
        .from("ads")
        .update(payload)
        .eq("id", id)
        .select();

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Cannot find ad or permission denied");
      }
      
      const adData = data[0];

      const mirrorUpdates = buildMirrorPostUpdates(updates);
      const { error: mirrorError } = await supabase
        .from("social_posts")
        .update(mirrorUpdates)
        .eq("id", id)
        .eq("post_channel", "ad");

      if (mirrorError) {
        throw mirrorError;
      }

      return adData;
    },
    onSuccess: () => {
      void invalidateSocialRealtimeQueries(queryClient);
      toast.success("อัปเดตโฆษณาสำเร็จ");
    },
    onError: (error: Error) => {
      toast.error(`ไม่สามารถอัปเดตโฆษณา: ${error.message}`);
    },
  });

  const createAdWithMirrorPost = useMutation({
    mutationFn: async (
      input: ExtendedAdInsert & { platform_id?: string | null }
    ) => {
      if (!workspace?.id) throw new Error("No active workspace");
      const { platform_id, budget, ...adFields } = input as ExtendedAdInsert & { platform_id?: string | null };

      const rpcParams: CreateAdWithMirrorPostParams = {
        p_team_id: workspace.id,
        p_name: adFields.name,
        p_status: adFields.status ?? "draft",
        p_creative_type: adFields.creative_type ?? "image",
        p_headline: adFields.headline ?? null,
        p_ad_copy: adFields.ad_copy ?? null,
        p_call_to_action: adFields.call_to_action ?? null,
        p_content: adFields.content ?? null,
        p_media_urls: adFields.media_urls ?? null,
        p_scheduled_at: adFields.scheduled_at ?? null,
        p_ad_group_id: adFields.ad_group_id ?? null,
        p_platform_id: platform_id ?? null,
        p_creative_url: adFields.creative_url ?? "/placeholder.svg",
        p_platform_ad_id: adFields.platform_ad_id ?? null,
        p_preview_url: adFields.preview_url ?? null,
        p_budget: budget ?? null,
      };

      const createViaMockEndpoint = async () => {
        const response = await fetch(backendUrl('/api/rpc/create_ad_with_mirror_post'), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rpcParams),
        });
        const body = (await response.json()) as
          | CreateAdWithMirrorPostMockResponse
          | { error?: string };
        if (!response.ok || !("data" in body) || !body.data?.id) {
          throw new Error(body && "error" in body ? body.error ?? "Mock RPC failed" : "Mock RPC failed");
        }
        return body.data;
      };

      if (USE_MOCK_DATA) {
        return createViaMockEndpoint();
      }

      const { data, error } = await supabase.rpc("create_ad_with_mirror_post", rpcParams);
      if (error) {
        if (shouldFallbackToMockRpc(error.message)) {
          return createViaMockEndpoint();
        }
        throw new Error(error.message);
      }

      const createdAd = data as Ad | null;
      if (!createdAd?.id) {
        throw new Error("create_ad_with_mirror_post returned no ad id");
      }
      return createdAd;
    },
    onSuccess: () => {
      void invalidateSocialRealtimeQueries(queryClient);
      toast.success("สร้างโฆษณาสำเร็จ");
    },
    onError: (error: Error) => {
      toast.error(`ไม่สามารถสร้างโฆษณา: ${error.message}`);
    },
  });

  const deleteAd = useMutation({
    mutationFn: async (id: string) => {
      // Delete the calendar mirror row first (no FK from social_posts → ads,
      // so order doesn't matter for integrity, but this is explicit cleanup).
      // Rows created before this fix won't have a mirror — the DELETE simply
      // affects 0 rows, which is not an error.
      await supabase
        .from("social_posts")
        .delete()
        .eq("id", id)
        .eq("post_channel", "ad");

      const { error } = await supabase
        .from("ads")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void invalidateSocialRealtimeQueries(queryClient);
      toast.success("ลบโฆษณาสำเร็จ");
    },
    onError: (error: Error) => {
      toast.error(`ไม่สามารถลบโฆษณา: ${error.message}`);
    },
  });

  const publishAd = useMutation({
    mutationFn: async ({ adId, platform }: { adId: string; platform: string }) => {
      const { data, error } = await supabase.functions.invoke("create-platform-ad", {
        body: { ad_id: adId, platform },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data as { success: boolean; platform_ad_id: string; status: string };
    },
    onSuccess: (_data, { platform }) => {
      void invalidateSocialRealtimeQueries(queryClient);
      toast.success(`เผยแพร่โฆษณาบน ${platform} สำเร็จ`);
    },
    onError: (error: Error) => {
      void invalidateSocialRealtimeQueries(queryClient);
      toast.error(`ไม่สามารถเผยแพร่โฆษณา: ${error.message}`);
    },
  });

  /**
   * Replace all persona links for an ad in one operation.
   * Deletes existing rows then inserts the new set.
   */
  const linkPersonas = useMutation({
    mutationFn: async ({ adId, personaIds }: { adId: string; personaIds: string[] }) => {
      const { error: deleteError } = await supabase
        .from("ad_personas")
        .delete()
        .eq("ad_id", adId);
      if (deleteError) throw deleteError;

      if (personaIds.length === 0) return;

      const { error: insertError } = await supabase
        .from("ad_personas")
        .insert(personaIds.map((persona_id) => ({ ad_id: adId, persona_id })));
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      void invalidateSocialRealtimeQueries(queryClient);
    },
    onError: (error: Error) => {
      toast.error(`ไม่สามารถลิงก์ Persona: ${error.message}`);
    },
  });

  return {
    ads,
    isLoading,
    error,
    createAd,
    createAdWithMirrorPost,
    updateAd,
    deleteAd,
    publishAd,
    linkPersonas,
  };
}
