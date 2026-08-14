import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRevenueMetrics } from "../useRevenueMetrics";
import { supabase } from "@/integrations/supabase/client";
import type { ReactNode } from "react";

/**
 * This file exists because the whole suite passed while the dashboard printed
 * invented money.
 *
 * The removed fallback produced `net_revenue` as `gross * 0.85` and
 * `new_customers` as `conversions * 0.6` whenever `revenue_metrics` held no
 * row — which is every workspace — and rendered both as `฿` on the dashboard
 * and as "Net Profit" in exported ROI reports. Nothing failed, because nothing
 * looked. These tests are the thing that looks.
 */

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ workspace: { id: "ws1", name: "Test Workspace" }, loading: false }),
}));

/** The `revenue_metrics` read: .select().eq().order().limit().maybeSingle() */
function mockRevenueRow(row: Record<string, unknown> | null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
  vi.mocked(supabase.from).mockReturnValue(chain as never);
  return chain;
}

describe("useRevenueMetrics", () => {
  let queryClient: QueryClient;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it("reports nothing rather than an estimate when no revenue has been measured", async () => {
    // The regression. An empty `revenue_metrics` must yield null so the caller
    // renders an empty state — not a number derived from ad spend, which
    // reports what was paid out and can say nothing about what came in.
    mockRevenueRow(null);

    const { result } = renderHook(() => useRevenueMetrics(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.revenueMetrics).toBeNull();
  });

  it("cannot be handed ad metrics to derive revenue from", async () => {
    // Structural, and deliberately about the signature rather than a value:
    // the deleted code was reachable only because the hook accepted spend,
    // ROAS and conversions. A hook that takes no arguments cannot grow that
    // branch back by accident — someone has to widen the signature first, and
    // this assertion fails when they do.
    expect(useRevenueMetrics.length).toBe(0);

    mockRevenueRow(null);
    const { result } = renderHook(
      // @ts-expect-error — passing ad metrics must not typecheck any more
      () => useRevenueMetrics({ totalSpend: 10000, avgRoas: 4, totalConversions: 250 }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.revenueMetrics).toBeNull();
  });

  it("passes a measured row through without rescaling any of it", async () => {
    // The other half: with a real row, every field is the stored value. The old
    // code multiplied two of them by constants, so "unchanged" is the property
    // worth pinning, not merely "non-null".
    mockRevenueRow({
      gross_revenue: 120000,
      net_revenue: 90000,
      profit: 30000,
      profit_margin: 25,
      revenue_growth_percent: 12.5,
      total_orders: 340,
      new_customers: 96,
      metric_date: "2026-08-13",
    });

    const { result } = renderHook(() => useRevenueMetrics(), { wrapper });

    await waitFor(() => expect(result.current.revenueMetrics).not.toBeNull());
    expect(result.current.revenueMetrics).toEqual({
      gross_revenue: 120000,
      net_revenue: 90000,
      profit_margin: 25,
      revenue_growth_percent: 12.5,
      total_orders: 340,
      new_customers: 96,
      metric_date: "2026-08-13",
      source: "revenue_metrics",
    });
  });

  it("keeps a missing growth figure missing instead of calling it zero", async () => {
    // No prior period is not 0% growth. A stored NULL has to stay
    // distinguishable so the card can render "—".
    mockRevenueRow({
      gross_revenue: 1000,
      net_revenue: 800,
      profit: 200,
      profit_margin: 20,
      revenue_growth_percent: null,
      total_orders: 4,
      new_customers: 1,
      metric_date: "2026-08-13",
    });

    const { result } = renderHook(() => useRevenueMetrics(), { wrapper });

    await waitFor(() => expect(result.current.revenueMetrics).not.toBeNull());
    expect(result.current.revenueMetrics!.revenue_growth_percent).toBeNull();
  });
});
