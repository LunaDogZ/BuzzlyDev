import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";

export interface SyncHistoryEntry {
  id: string;
  platform_id: string;
  platform_name: string;
  platform_slug: string;
  team_id: string;
  sync_type: "manual" | "scheduled" | "webhook";
  status: "success" | "failed" | "in_progress";
  rows_synced: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

type SyncHistoryRow = Omit<SyncHistoryEntry, "platform_name" | "platform_slug"> & {
  platforms: { name: string; slug: string } | null;
};


export function useSyncHistory() {
  const { workspace } = useWorkspace();

  const { data, isLoading, error } = useQuery({
    queryKey: ["sync_history", workspace.id],
    queryFn: async () => {
      const { data: rows, error: queryError } = await supabase
        .from("sync_history")
        .select("*, platforms(name, slug)")
        .eq("team_id", workspace.id)
        .order("started_at", { ascending: false })
        .limit(50);

      if (queryError) throw queryError;

      return ((rows ?? []) as unknown as SyncHistoryRow[]).map(
        (row): SyncHistoryEntry => ({
          id: row.id,
          platform_id: row.platform_id,
          team_id: row.team_id,
          sync_type: row.sync_type,
          status: row.status,
          rows_synced: row.rows_synced,
          error_message: row.error_message,
          started_at: row.started_at,
          completed_at: row.completed_at,
          platform_name: row.platforms?.name ?? "Unknown",
          platform_slug: row.platforms?.slug ?? "",
        })
      );
    },
    enabled: !!workspace.id,
  });

  return {
    entries: data ?? [],
    isLoading,
    error,
  };
}
