

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { useWorkspace } from "./useWorkspace";

// Map to social_posts structure but expose as AdPost (Email)
export interface AdPost {
    id: string;
    name: string | null; // campaign name
    subject: string | null;
    status: "draft" | "scheduled" | "sent" | "paused";
    category: string | null;
    scheduled_at: string | null;
    sent_at: string | null;
    recipient_count: number;
    open_count: number;
    click_count: number;
    created_at: string;
    updated_at: string;
}

export interface AdPostInsert {
    name: string;
    subject?: string;
    status?: "draft" | "scheduled" | "sent" | "paused";
    category?: string;
    scheduled_at?: string;
    team_id: string;
}

export interface AdPostUpdate {
    name?: string;
    subject?: string;
    status?: "draft" | "scheduled" | "sent" | "paused";
    category?: string;
    scheduled_at?: string;
}

export function useAdPosts() {
    const queryClient = useQueryClient();
    const { workspace } = useWorkspace();
    const teamId = workspace?.id;

    const { data: adPosts = [], isLoading, error } = useQuery({
        queryKey: ["ad-posts", teamId],
        queryFn: async () => {
            if (!teamId) return [];

            // @ts-ignore
            const { data, error } = await supabase
                .from("social_posts") // Query social_posts
                .select("*")
                .eq("team_id", teamId as string)
                .eq("post_channel", "email") // Filter for Email
                .order("created_at", { ascending: false });

            if (error) throw error;

            // Map social_posts row to AdPost interface if needed (mostly 1:1 now)
            return data.map(post => ({
                ...post,
                name: (post as { name?: string }).name || post.content || "Untitled", // Fallback if name empty
                status: post.status as AdPost["status"],
            })) as unknown as AdPost[];
        },
        enabled: !!teamId,
    });

    const createAdPost = useMutation({
        mutationFn: async (newPost: Omit<AdPostInsert, "team_id">) => {
            if (!teamId) throw new Error("No team ID");

            const { data, error } = await supabase
                .from("social_posts")
                .insert({
                    ...newPost,
                    team_id: teamId,
                    post_channel: "email", // Set channel
                    content: newPost.name, // Use name as content for consistency/fallback
                } as unknown as TablesInsert<"social_posts">)
                .select()
                .single();

            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["ad-posts"] });
            toast.success("สร้างรายการสำเร็จ");
        },
        onError: (error) => {
            toast.error(`เกิดข้อผิดพลาด: ${error.message}`);
        },
    });

    const updateAdPost = useMutation({
        mutationFn: async ({ id, updates }: { id: string; updates: AdPostUpdate }) => {
            const { data, error } = await supabase
                .from("social_posts")
                .update({
                    ...updates,
                    content: updates.name // Sync name to content
                } as unknown as TablesUpdate<"social_posts">)
                .eq("id", id)
                .select()
                .single();

            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["ad-posts"] });
            toast.success("อัปเดตรายการสำเร็จ");
        },
        onError: (error) => {
            toast.error(`เกิดข้อผิดพลาด: ${error.message}`);
        },
    });

    const deleteAdPost = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.from("social_posts").delete().eq("id", id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["ad-posts"] });
            toast.success("ลบรายการสำเร็จ");
        },
        onError: (error) => {
            toast.error(`เกิดข้อผิดพลาด: ${error.message}`);
        },
    });

    const duplicateAdPost = useMutation({
        mutationFn: async (post: AdPost) => {
            const { id, created_at, updated_at, ...rest } = post;
            const { data, error } = await supabase
                .from("social_posts")
                .insert({
                    ...rest,
                    name: `${post.name} (Copy)`,
                    content: `${post.name} (Copy)`,
                    status: "draft",
                    sent_at: null,
                    recipient_count: 0,
                    open_count: 0,
                    click_count: 0,
                    post_channel: "email"
                } as unknown as TablesInsert<"social_posts">)
                .select()
                .single();

            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["ad-posts"] });
            toast.success("ทำซ้ำรายการสำเร็จ");
        },
        onError: (error) => {
            toast.error(`เกิดข้อผิดพลาด: ${error.message}`);
        },
    });

    // Computed stats
    const stats = {
        totalSent: adPosts.reduce((acc, p) => acc + (p.recipient_count || 0), 0),
        avgOpenRate: adPosts.length
            ? (adPosts.reduce((acc, p) => acc + (p.recipient_count ? (p.open_count / p.recipient_count) : 0), 0) / adPosts.length) * 100
            : 0,
        avgClickRate: adPosts.length
            ? (adPosts.reduce((acc, p) => acc + (p.recipient_count ? (p.click_count / p.recipient_count) : 0), 0) / adPosts.length) * 100
            : 0,
        scheduledCount: adPosts.filter(p => p.status === "scheduled").length,
    };

    return {
        adPosts,
        isLoading,
        error,
        createAdPost,
        updateAdPost,
        deleteAdPost,
        duplicateAdPost,
        stats,
    };
}

