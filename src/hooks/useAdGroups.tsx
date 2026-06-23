import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { useWorkspace } from "./useWorkspace";
import { adsKeys } from "./useAds";
import { invalidateSocialRealtimeQueries } from "@/lib/socialQueryInvalidation";

type AdGroupBase = Database["public"]["Tables"]["ad_groups"]["Row"];
type AdGroupInsertBase = Database["public"]["Tables"]["ad_groups"]["Insert"];
type AdGroupUpdateBase = Database["public"]["Tables"]["ad_groups"]["Update"];

// The generated ad_groups Row already includes description/external_group_id/
// group_type/source_platform, so AdGroup is just the base Row type.
export type AdGroup = AdGroupBase;

export interface AdGroupInsert extends Omit<AdGroupInsertBase, "description"> {
  description?: string | null;
  external_group_id?: string | null;
  group_type?: string | null;
  source_platform?: string | null;
}

export interface AdGroupUpdate extends Omit<AdGroupUpdateBase, "description"> {
  description?: string | null;
  external_group_id?: string | null;
  group_type?: string | null;
  source_platform?: string | null;
}

export const adGroupKeys = {
  all: ["ad-groups"] as const,
  list: (workspaceId?: string) => ["ad-groups", workspaceId] as const,
};

export interface AdGroupWithCount extends AdGroup {
  ads_count: number;
  posts_count: number;
}

export function useAdGroups() {
  const queryClient = useQueryClient();
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id;

  const invalidateAdGroupQueries = async () => {
    await Promise.all([
      invalidateSocialRealtimeQueries(queryClient),
      queryClient.invalidateQueries({ queryKey: adGroupKeys.all }),
      queryClient.invalidateQueries({ queryKey: adsKeys.all }),
      queryClient.invalidateQueries({ queryKey: ["linkable_posts_unlinked"] }),
      queryClient.invalidateQueries({ queryKey: ["linkable_ads_unlinked"] }),
      queryClient.invalidateQueries({ queryKey: ["linkable_posts_linked"] }),
      queryClient.invalidateQueries({ queryKey: ["linkable_ads_linked"] }),
      queryClient.invalidateQueries({ queryKey: ["ad_insights"] }),
    ]);
  };

  const syncAdGroupOnSyncedPosts = async (adIds: string[], adGroupId: string | null) => {
    if (!workspaceId || adIds.length === 0) {
      return;
    }

    const { error } = await supabase
      .from("social_posts")
      .update({ ad_group_id: adGroupId })
      .eq("team_id", workspaceId)
      .eq("post_channel", "ad")
      .in("id", adIds);

    if (error) {
      throw error;
    }
  };

  const syncAdsForPaidPosts = async (postIds: string[], adGroupId: string | null) => {
    if (!workspaceId || postIds.length === 0) {
      return;
    }

    const { data: paidPosts, error: paidPostsError } = await supabase
      .from("social_posts")
      .select("id")
      .eq("team_id", workspaceId)
      .eq("post_channel", "ad")
      .in("id", postIds);

    if (paidPostsError) {
      throw paidPostsError;
    }

    const paidPostIds = (paidPosts ?? []).map((post) => post.id);
    if (paidPostIds.length === 0) {
      return;
    }

    const { error } = await supabase
      .from("ads")
      .update({ ad_group_id: adGroupId })
      .eq("team_id", workspaceId)
      .in("id", paidPostIds);

    if (error) {
      throw error;
    }
  };

  const { data: adGroups = [], isLoading, error } = useQuery({
    queryKey: adGroupKeys.list(workspaceId),
    enabled: !!workspaceId,
    queryFn: async () => {
      if (!workspaceId) return [];

      const { data: groups, error: groupsError } = await supabase
        .from("ad_groups")
        .select("id, name, status, team_id, created_at, updated_at, description, group_type, external_group_id, source_platform")
        .eq("team_id", workspaceId)
        .order("created_at", { ascending: false });

      if (groupsError) throw groupsError;

      const [{ data: ads, error: adsError }, { data: posts, error: postsError }] =
        await Promise.all([
          supabase
            .from("ads")
            .select("ad_group_id")
            .eq("team_id", workspaceId),
          supabase
            .from("social_posts")
            .select("ad_group_id")
            .eq("team_id", workspaceId)
            .eq("post_channel", "social")
            .not("ad_group_id", "is", null),
        ]);

      if (adsError) throw adsError;
      if (postsError) throw postsError;

      const buildCountMap = (rows: { ad_group_id: string | null }[]) =>
        rows.reduce((acc, row) => {
          if (row.ad_group_id) {
            acc[row.ad_group_id] = (acc[row.ad_group_id] || 0) + 1;
          }
          return acc;
        }, {} as Record<string, number>);

      const adsCountMap = buildCountMap(ads ?? []);
      const postsCountMap = buildCountMap(posts ?? []);

      return groups.map((group) => ({
        ...group,
        ads_count: adsCountMap[group.id] ?? 0,
        posts_count: postsCountMap[group.id] ?? 0,
      })) as AdGroupWithCount[];
    },
  });

  const createAdGroup = useMutation({
    mutationFn: async (newGroup: AdGroupInsert) => {
      if (!workspaceId) throw new Error("No active workspace");
      const { data, error } = await supabase
        .from("ad_groups")
        .insert({ ...newGroup, team_id: workspaceId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await invalidateAdGroupQueries();
      toast.success("สร้างกลุ่มโฆษณาสำเร็จ");
    },
    onError: (error: Error) => {
      toast.error(`ไม่สามารถสร้างกลุ่มโฆษณา: ${error.message}`);
    },
  });

  const updateAdGroup = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: AdGroupUpdate }) => {
      const { data, error } = await supabase
        .from("ad_groups")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await invalidateAdGroupQueries();
      toast.success("อัปเดตกลุ่มโฆษณาสำเร็จ");
    },
    onError: (error: Error) => {
      toast.error(`ไม่สามารถอัปเดตกลุ่มโฆษณา: ${error.message}`);
    },
  });

  const deleteAdGroup = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("ad_groups")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await invalidateAdGroupQueries();
      toast.success("ลบกลุ่มโฆษณาสำเร็จ");
    },
    onError: (error: Error) => {
      toast.error(`ไม่สามารถลบกลุ่มโฆษณา: ${error.message}`);
    },
  });

  const linkItemsToGroup = useMutation({
    mutationFn: async ({
      groupId,
      adIds,
      postIds,
    }: {
      groupId: string;
      adIds?: string[];
      postIds?: string[];
    }) => {
      const ops: PromiseLike<unknown>[] = [];
      if (adIds && adIds.length > 0) {
        ops.push(
          supabase
            .from("ads")
            .update({ ad_group_id: groupId })
            .in("id", adIds)
            .then(({ error }) => { if (error) throw error; })
        );
        ops.push(syncAdGroupOnSyncedPosts(adIds, groupId));
      }
      if (postIds && postIds.length > 0) {
        ops.push(
          supabase
            .from("social_posts")
            .update({ ad_group_id: groupId })
            .eq("team_id", workspaceId)
            .in("id", postIds)
            .then(({ error }) => { if (error) throw error; })
        );
        ops.push(syncAdsForPaidPosts(postIds, groupId));
      }
      await Promise.all(ops);
    },
    onSuccess: async () => {
      await invalidateAdGroupQueries();
      toast.success("เชื่อมโยงรายการสำเร็จ");
    },
    onError: (error: Error) => {
      toast.error(`ไม่สามารถเชื่อมโยงรายการ: ${error.message}`);
    },
  });

  const unlinkItemFromGroup = useMutation({
    mutationFn: async ({
      table,
      itemId,
    }: {
      table: "ads" | "social_posts";
      itemId: string;
    }) => {
      const { error } = await supabase
        .from(table)
        .update({ ad_group_id: null })
        .eq("id", itemId);
      if (error) throw error;

      if (table === "ads") {
        await syncAdGroupOnSyncedPosts([itemId], null);
      } else {
        await syncAdsForPaidPosts([itemId], null);
      }
    },
    onSuccess: async () => {
      await invalidateAdGroupQueries();
      toast.success("ยกเลิกการเชื่อมโยงสำเร็จ");
    },
    onError: (error: Error) => {
      toast.error(`ไม่สามารถยกเลิกการเชื่อมโยง: ${error.message}`);
    },
  });

  const syncGroupAds = useMutation({
    mutationFn: async ({
      groupId,
      adIds,
    }: {
      groupId: string;
      adIds: string[];
    }) => {
      if (!workspaceId) throw new Error("No active workspace");

      const normalizedAdIds = Array.from(new Set(adIds));
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
        .filter((id) => !normalizedAdIds.includes(id));

      if (adIdsToClear.length > 0) {
        const { error: clearError } = await supabase
          .from("ads")
          .update({ ad_group_id: null })
          .eq("team_id", workspaceId)
          .in("id", adIdsToClear);

        if (clearError) {
          throw clearError;
        }

        await syncAdGroupOnSyncedPosts(adIdsToClear, null);
      }

      if (normalizedAdIds.length === 0) {
        return;
      }

      const { error } = await supabase
        .from("ads")
        .update({ ad_group_id: groupId })
        .eq("team_id", workspaceId)
        .in("id", normalizedAdIds);

      if (error) {
        throw error;
      }

      await syncAdGroupOnSyncedPosts(normalizedAdIds, groupId);
    },
    onSuccess: async () => {
      await invalidateAdGroupQueries();
    },
    onError: (error: Error) => {
      toast.error(`ไม่สามารถอัปเดตโฆษณาในกลุ่ม: ${error.message}`);
    },
  });

  const syncGroupPosts = useMutation({
    mutationFn: async ({
      groupId,
      postIds,
    }: {
      groupId: string;
      postIds: string[];
    }) => {
      if (!workspaceId) throw new Error("No active workspace");

      const normalizedPostIds = Array.from(new Set(postIds));
      const { data: currentlyLinkedPosts, error: currentPostsError } = await supabase
        .from("social_posts")
        .select("id")
        .eq("team_id", workspaceId)
        .eq("ad_group_id", groupId)
        .in("post_channel", ["social", "ad"]);

      if (currentPostsError) {
        throw currentPostsError;
      }

      const postIdsToClear = (currentlyLinkedPosts ?? [])
        .map((post) => post.id)
        .filter((id) => !normalizedPostIds.includes(id));

      if (postIdsToClear.length > 0) {
        const { error: clearError } = await supabase
          .from("social_posts")
          .update({ ad_group_id: null })
          .eq("team_id", workspaceId)
          .in("id", postIdsToClear);

        if (clearError) {
          throw clearError;
        }

        await syncAdsForPaidPosts(postIdsToClear, null);
      }

      if (normalizedPostIds.length === 0) {
        return;
      }

      const { error } = await supabase
        .from("social_posts")
        .update({ ad_group_id: groupId })
        .eq("team_id", workspaceId)
        .in("id", normalizedPostIds);

      if (error) {
        throw error;
      }

      await syncAdsForPaidPosts(normalizedPostIds, groupId);
    },
    onSuccess: async () => {
      await invalidateAdGroupQueries();
    },
    onError: (error: Error) => {
      toast.error(`ไม่สามารถอัปเดตโพสต์ในกลุ่ม: ${error.message}`);
    },
  });

  return {
    adGroups,
    isLoading,
    error,
    createAdGroup,
    updateAdGroup,
    deleteAdGroup,
    linkItemsToGroup,
    syncGroupAds,
    syncGroupPosts,
    unlinkItemFromGroup,
  };
}
