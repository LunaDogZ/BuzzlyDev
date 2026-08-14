import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { fetchScopedAdAccountIds } from "@/hooks/useDashboardMetrics";
import { logError } from "@/services/errorLogger";
import {
  AD_DATA_SOURCES,
  AD_DATA_SOURCE_OPTIONS,
  sourcesFor,
  type AdDataSource,
  type AdDataSourceFilter,
} from "@/constants/adDataSource";

/** How many insight rows a workspace holds per `data_source`. */
export type AdSourceCounts = Record<AdDataSource, number>;

/**
 * Row counts per source, for the workspace and platform currently selected.
 *
 * Two jobs, and they are the same query because they must not disagree: it
 * picks the source the page opens on, and it is the number printed next to the
 * picker. A default chosen from one count while the caption prints another
 * would put the page on a source whose stated size is wrong.
 *
 * **Not scoped to the selected date range, deliberately.** This counts the
 * whole of what a source holds, which is what makes a thin chart legible: the
 * point of the readout is to distinguish "this source is nearly empty" from
 * "your window misses it". Callers must label it as coverage, never as the
 * number of rows currently drawn.
 *
 * Tenant scoping is `fetchScopedAdAccountIds`, the same function
 * `useDashboardMetrics` and `useAdDataRange` use. Sharing it is not tidiness:
 * a count scoped differently from the metrics would advertise rows the chart
 * cannot show, and `ad_insights` is reachable only through an ad account that
 * belongs to the workspace, so the source filter can only ever narrow a set
 * that is already tenant-bound.
 */
export function useAdSourceCounts(platformId: string = "all") {
  const { workspace, loading: isWorkspaceLoading } = useWorkspace();
  const workspaceId = workspace?.id;

  const query = useQuery({
    queryKey: ["ad-source-counts", workspaceId, platformId],
    enabled: !!workspaceId,
    // Counts only move when an import or a sync lands.
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AdSourceCounts> => {
      try {
        const accountIds = await fetchScopedAdAccountIds(workspaceId!, platformId);

        const empty = Object.fromEntries(
          AD_DATA_SOURCES.map((source) => [source, 0])
        ) as AdSourceCounts;

        if (accountIds.length === 0) return empty;

        // `head: true` — the server counts and returns no rows. Counting in the
        // client would mean shipping every insight to the browser to measure a
        // number, on a page that already reads them once for the charts.
        const counted = await Promise.all(
          AD_DATA_SOURCES.map(async (source) => {
            const { count, error } = await supabase
              .from("ad_insights")
              .select("id", { count: "exact", head: true })
              .in("ad_account_id", accountIds)
              .eq("data_source", source);

            if (error) throw error;
            return [source, count ?? 0] as const;
          })
        );

        return { ...empty, ...Object.fromEntries(counted) } as AdSourceCounts;
      } catch (error) {
        // No toast: this annotates a picker. Callers fall back to showing no
        // count rather than blocking the dashboard on it.
        logError("Failed to count ad rows by source", error, { workspaceId, platformId });
        throw error;
      }
    },
  });

  return {
    data: query.data ?? null,
    isError: query.isError,
    isLoading: isWorkspaceLoading || query.isLoading,
  };
}

/** Rows the given filter covers — the sum of its sources, so `"all"` matches
 *  what the dashboard actually aggregates rather than the whole column. */
export function countFor(
  counts: AdSourceCounts | null,
  filter: AdDataSourceFilter
): number | null {
  if (!counts) return null;
  return sourcesFor(filter).reduce((total, source) => total + (counts[source] ?? 0), 0);
}

/**
 * The single source the dashboard should open on: whichever holds the most rows.
 *
 * `"all"` is excluded from the candidates rather than merely losing. It is an
 * aggregate of the others, so its count is a sum and would win every comparison
 * it entered — leaving "default to the largest source" quietly meaning "always
 * default to the combined view", which is the one behaviour this is meant to
 * replace.
 *
 * Only values the picker offers are candidates, so the page can never open on a
 * source with no way back to it. Ties resolve to the earlier option, which puts
 * real data ahead of fixtures because that is the order
 * `AD_DATA_SOURCE_OPTIONS` is written in.
 *
 * Returns null when nothing has any rows — the caller then keeps the combined
 * view, because opening on an arbitrary empty source would tell a merchant with
 * an empty workspace that one particular path had failed.
 */
export function largestSource(counts: AdSourceCounts | null): AdDataSourceFilter | null {
  if (!counts) return null;

  let best: AdDataSourceFilter | null = null;
  let bestCount = 0;

  for (const option of AD_DATA_SOURCE_OPTIONS) {
    if (option.value === "all") continue;

    const rows = countFor(counts, option.value) ?? 0;
    if (rows > bestCount) {
      best = option.value;
      bestCount = rows;
    }
  }

  return best;
}
