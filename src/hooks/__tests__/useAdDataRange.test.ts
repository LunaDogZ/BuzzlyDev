import { describe, it, expect } from "vitest";
import { formatAdDataRange, toCustomRangeValue } from "@/hooks/useAdDataRange";
import { parseDateRange } from "@/hooks/useDashboardMetrics";

describe("formatAdDataRange", () => {
  it("renders Buddhist Era years, which is what a Thai merchant's export shows", () => {
    // 2026 CE = 2569 BE. A merchant reconciling against their own Shopee file
    // is looking at BE dates; showing 2026 would read as a different year.
    expect(formatAdDataRange({ start: "2026-06-24", end: "2026-07-23" })).toContain("2569");
  });

  it("does not shift a date across a timezone boundary", () => {
    // `new Date("2026-06-24")` is UTC midnight; formatted in a timezone behind
    // UTC that renders as the 23rd. The range must name the exact stored day.
    const formatted = formatAdDataRange({ start: "2026-06-24", end: "2026-07-23" });
    expect(formatted).toMatch(/^24 /);
    expect(formatted).toContain("23 ");
  });

  it("states the year once when both ends share it", () => {
    const formatted = formatAdDataRange({ start: "2026-06-24", end: "2026-07-23" });
    expect(formatted.match(/2569/g)).toHaveLength(1);
  });

  it("states both years when the range crosses one", () => {
    const formatted = formatAdDataRange({ start: "2025-12-28", end: "2026-01-04" });
    expect(formatted).toContain("2568");
    expect(formatted).toContain("2569");
  });

  it("collapses a single-day range to one date", () => {
    const formatted = formatAdDataRange({ start: "2026-07-23", end: "2026-07-23" });
    expect(formatted).not.toContain("–");
    expect(formatted).toContain("2569");
  });
});

describe("toCustomRangeValue", () => {
  const range = { start: "2026-06-24", end: "2026-07-23" };

  it("produces a value the dashboard's own parser accepts", () => {
    // The jump button is only honest if selecting this value really does show
    // the range the empty state just promised. parseDateRange silently falls
    // back to a 30-day window on a malformed `custom:`, which would land the
    // merchant right back where they started.
    expect(parseDateRange(toCustomRangeValue(range))).toEqual(range);
  });

  it("round-trips a range that crosses a year", () => {
    const crossing = { start: "2025-12-28", end: "2026-01-04" };
    expect(parseDateRange(toCustomRangeValue(crossing))).toEqual(crossing);
  });
});
