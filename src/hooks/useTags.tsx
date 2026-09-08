import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { fetchCurrentWorkspaceId } from '@/hooks/useWorkspace';
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import { toast } from "sonner";

export interface Tag {
    id: string;
    team_id: string;
    name: string;
    color_code: string;
    entity_type: "campaign" | "post" | "persona" | "report";
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface CreateTagInput {
    name: string;
    color_code?: string;
    entity_type: "campaign" | "post" | "persona" | "report";
}

/** Delegates to the one shared workspace read; see `fetchCurrentWorkspaceId`.
 *  This copy used to run its own two queries per mount. */
async function getTeamId(queryClient: QueryClient): Promise<string | null> {
    return fetchCurrentWorkspaceId(queryClient);
}

export function useTags(entityType?: "campaign" | "post" | "persona" | "report") {
    const queryClient = useQueryClient();

    const { data: tags = [], isLoading } = useQuery({
        queryKey: ["tags", entityType],
        queryFn: async () => {
            const teamId = await getTeamId(queryClient);
            if (!teamId) return [];

            let query = supabase
                .from("tags")
                .select("*")
                .eq("team_id", teamId)
                .order("name", { ascending: true });

            if (entityType) {
                query = query.eq("entity_type", entityType);
            }

            const { data, error } = await query;
            if (error) throw error;
            return (data ?? []) as Tag[];
        },
    });

    const createTag = useMutation({
        mutationFn: async (input: CreateTagInput) => {
            const teamId = await getTeamId(queryClient);
            if (!teamId) throw new Error("No team found");
            const { data: { user } } = await getCurrentUser();

            const { data, error } = await supabase
                .from("tags")
                .insert({
                    team_id: teamId,
                    created_by: user?.id,
                    name: input.name,
                    color_code: input.color_code ?? "#6366f1",
                    entity_type: input.entity_type,
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tags"] });
            toast.success("Tag created");
        },
        onError: (err) => {
            toast.error(err.message ?? "Failed to create tag");
        },
    });

    const deleteTag = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.from("tags").delete().eq("id", id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tags"] });
            toast.success("Tag deleted");
        },
        onError: (err) => {
            toast.error(err.message ?? "Failed to delete tag");
        },
    });

    // Campaign tag assignment
    const assignTagToCampaign = useMutation({
        mutationFn: async ({ campaignId, tagId }: { campaignId: string; tagId: string }) => {
            const { error } = await supabase
                .from("campaign_tags")
                .insert({ campaign_id: campaignId, tag_id: tagId });
            if (error) throw error;
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ["campaign-tags", variables.campaignId] });
        },
        onError: (err) => {
            toast.error(err.message ?? "Failed to assign tag");
        },
    });

    const removeTagFromCampaign = useMutation({
        mutationFn: async ({ campaignId, tagId }: { campaignId: string; tagId: string }) => {
            const { error } = await supabase
                .from("campaign_tags")
                .delete()
                .eq("campaign_id", campaignId)
                .eq("tag_id", tagId);
            if (error) throw error;
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ["campaign-tags", variables.campaignId] });
        },
        onError: (err) => {
            toast.error(err.message ?? "Failed to remove tag");
        },
    });

    return {
        tags,
        isLoading,
        createTag,
        deleteTag,
        assignTagToCampaign,
        removeTagFromCampaign,
    };
}

// Hook for fetching tags assigned to a specific campaign
export function useCampaignTags(campaignId: string | null) {
    return useQuery({
        queryKey: ["campaign-tags", campaignId],
        enabled: !!campaignId,
        queryFn: async () => {
            if (!campaignId) return [];
            const { data, error } = await supabase
                .from("campaign_tags")
                .select("tag_id, tags(id, name, color_code, entity_type)")
                .eq("campaign_id", campaignId);
            if (error) throw error;
            return (data ?? []).map((ct) => ct.tags as Tag).filter(Boolean);
        },
    });
}
