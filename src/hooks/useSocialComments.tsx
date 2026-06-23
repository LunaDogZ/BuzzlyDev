import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { toast } from "sonner";

export interface SocialComment {
  id: string;
  post_id: string;
  team_id: string;
  platform_id: string | null;
  platform_comment_id: string | null;
  author_name: string;
  author_avatar_url: string | null;
  author_platform_id: string | null;
  content: string;
  sentiment: "positive" | "negative" | "neutral" | null;
  is_read: boolean;
  is_replied: boolean;
  replied_at: string | null;
  reply_content: string | null;
  created_at: string;
  updated_at: string;
}

export type SocialCommentInsert = Omit<SocialComment, "id" | "created_at" | "updated_at">;
export type SocialCommentUpdate = Partial<
  Omit<SocialComment, "id" | "team_id" | "post_id" | "created_at" | "updated_at">
>;

export function useSocialComments(postId?: string) {
  const queryClient = useQueryClient();
  const { workspace } = useWorkspace();

  const { data: comments = [], isLoading, error } = useQuery({
    queryKey: ["social_comments", workspace.id, postId],
    queryFn: async () => {
      let query = (supabase)
        .from("social_comments")
        .select("*")
        .eq("team_id", workspace.id)
        .order("created_at", { ascending: true });

      if (postId) {
        query = query.eq("post_id", postId);
      }

      const { data, error: queryError } = await query;
      if (queryError) throw queryError;
      return (data ?? []) as SocialComment[];
    },
    enabled: !!workspace.id,
  });

  const createComment = useMutation({
    mutationFn: async (newComment: Omit<SocialCommentInsert, "team_id">) => {
      if (!workspace.id) throw new Error("No workspace found");

      const { data, error: mutationError } = await (
        supabase
      )
        .from("social_comments")
        .insert({ ...newComment, team_id: workspace.id })
        .select()
        .single();

      if (mutationError) throw mutationError;
      return data as SocialComment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["social_comments", workspace.id] });
      queryClient.invalidateQueries({ queryKey: ["social_inbox", workspace.id] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to add comment: ${err.message}`);
    },
  });

  const updateComment = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: SocialCommentUpdate }) => {
      const { data, error: mutationError } = await (
        supabase
      )
        .from("social_comments")
        .update(updates)
        .eq("id", id)
        .eq("team_id", workspace.id)
        .select()
        .single();

      if (mutationError) throw mutationError;
      return data as SocialComment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["social_comments", workspace.id] });
      queryClient.invalidateQueries({ queryKey: ["social_inbox", workspace.id] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to update comment: ${err.message}`);
    },
  });

  const deleteComment = useMutation({
    mutationFn: async (id: string) => {
      const { error: mutationError } = await (
        supabase
      )
        .from("social_comments")
        .delete()
        .eq("id", id)
        .eq("team_id", workspace.id);

      if (mutationError) throw mutationError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["social_comments", workspace.id] });
      queryClient.invalidateQueries({ queryKey: ["social_inbox", workspace.id] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete comment: ${err.message}`);
    },
  });

  const markAsRead = useMutation({
    mutationFn: async (id: string) => {
      const { error: mutationError } = await (
        supabase
      )
        .from("social_comments")
        .update({ is_read: true })
        .eq("id", id)
        .eq("team_id", workspace.id);

      if (mutationError) throw mutationError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["social_comments", workspace.id] });
      queryClient.invalidateQueries({ queryKey: ["social_inbox", workspace.id] });
    },
  });

  return { comments, isLoading, error, createComment, updateComment, deleteComment, markAsRead };
}
