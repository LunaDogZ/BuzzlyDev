import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { fetchScopedAdAccountIds } from "@/hooks/useDashboardMetrics";
import { logError } from "@/services/errorLogger";
import { sourcesFor, type AdDataSourceFilter } from "@/constants/adDataSource";

/** The first and last day a workspace actually has ad insights for. */
export interface AdDataRange {
  /** YYYY-MM-DD */
  start: string;
  /** YYYY-MM-DD */
  end: string;
}

/** `YYYY-MM-DD` as a *local* date — `new Date(ymd)` would read it as UTC. */
function parseYMD(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

/**
 * Thai locale renders Buddhist Era years, which is what a merchant reading a
 * Thai export expects to see: 2026-06-24 -> "24 มิ.ย. 2569".
 */
function formatDay(ymd: string, withYear: boolean): string {
  return parseYMD(ymd).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

/** "24 มิ.ย. – 23 ก.ค. 2569" — the year is only repeated when it differs. */
export function formatAdDataRange(range: AdDataRange): string {
  if (range.start === range.end) return formatDay(range.end, true);
  const sameYear = range.start.slice(0, 4) === range.end.slice(0, 4);
  return `${formatDay(range.start, !sameYear)} – ${formatDay(range.end, true)}`;
}

/**
 * The `dateRange` value that selects exactly this range.
 * `parseDateRange` in useDashboardMetrics already understands `custom:`.
 */
export function toCustomRangeValue(range: AdDataRange): string {
  return `custom:${range.start}:${range.end}`;
}

/**
 * Min/max insight date for the workspace, so a page can tell "you have no data"
 * apart from "your data is outside the range you picked".
 *
 * Merchant file exports are historical — a Meta export uploaded today usually
 * covers last month — so a default 30-day window renders them as zeroes, which
 * is indistinguishable from a failed import. Returns null when the workspace
 * genuinely has nothing.
 */
export function useAdDataRange(
  platformId: string = "all",
  dataSource: AdDataSourceFilter = "all"
) {
  const { workspace, loading: isWorkspaceLoading } = useWorkspace();
  const workspaceId = workspace?.id;

  const query = useQuery({
    queryKey: ["ad-data-range", workspaceId, platformId, dataSource],
    enabled: !!workspaceId,
    // Coverage only moves when an import or sync lands, so this may be much
    // staler than the metrics it annotates.
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AdDataRange | null> => {
      try {
        const accountIds = await fetchScopedAdAccountIds(workspaceId!, platformId);
        if (accountIds.length === 0) return null;

        // Two indexed one-row reads rather than scanning every insight.
        //
        // The source filter must be applied here too, and identically to
        // useDashboardMetrics: this range is what the empty state offers to jump
        // to, so a range read across both sources while the metrics read only
        // one would send the merchant to a window that renders empty — the exact
        // false claim this hook exists to prevent.
        const bound = async (ascending: boolean): Promise<string | null> => {
          const { data, error } = await supabase
            .from("ad_insights")
            .select("date")
            .in("ad_account_id", accountIds)
            .in("data_source", sourcesFor(dataSource))
            .order("date", { ascending })
            .limit(1);

          if (error) throw error;
          return data?.[0]?.date ?? null;
        };

        const [start, end] = await Promise.all([bound(true), bound(false)]);
        if (!start || !end) return null;

        return { start, end };
      } catch (error) {
        // No toast: this only annotates an empty state, and callers fall back to
        // their generic copy when no range comes back.
        logError("Failed to read ad data range", error, { workspaceId, platformId, dataSource });
        throw error;
      }
    },
  });

  return {
    data: query.data ?? null,
    isError: query.isError,
    /**
     * True whenever the coverage is not yet known — which includes the window
     * before the workspace id resolves. A query that is still `enabled: false`
     * reports `isLoading: false` even though it has never run, and a caller
     * gating on the raw flag would show its "you have no data" copy in that gap:
     * exactly the false claim this hook exists to prevent.
     */
    isLoading: isWorkspaceLoading || query.isLoading,
  };
}
