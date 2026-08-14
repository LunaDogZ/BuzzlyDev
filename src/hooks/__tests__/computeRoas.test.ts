import { describe, it, expect } from "vitest";
import { computeRoas } from "@/hooks/useDashboardMetrics";

/**
 * ROAS is the number a merchant decides where to spend money on, and until
 * 2026-08-14 the dashboard computed it by averaging a stored per-row ratio —
 * over a column that is NULL on every real Meta row, so it displayed 0.0x for
 * an account whose actual return is about 2.6x.
 *
 * Three defects, and these tests pin all three:
 *
 *  1. the shape of the arithmetic — a portfolio return is Σrevenue ÷ Σspend,
 *     and the mean of per-row ratios is a different number, not a rounding of
 *     the same one;
 *  2. the direction of the error — Meta omits `action_values` from days it
 *     attributed no purchase value to, so revenue is a floor while spend is
 *     complete, which makes the quotient a lower bound rather than a claim;
 *  3. when it may be stated at all — a selection mixing Meta rows with imported
 *     rows that never carry revenue produces a bound near zero: true, useless,
 *     and read as "your ads lose money".
 *
 * Every expectation below is hand-declared arithmetic, not output captured from
 * the function (CLAUDE.md §11).
 */

const meta = (revenue: number | null) => ({ revenue, data_source: "meta_live" });
const imported = (revenue: number | null) => ({ revenue, data_source: "import" });

describe("computeRoas — the arithmetic", () => {
  it("divides the sums, which is NOT the mean of the per-row ratios", () => {
    // Two rows: ฿10 spent returning ฿10, and ฿1,000 spent returning ฿2,000.
    // Σrevenue ÷ Σspend = 2010 / 1010 = 1.9900990...
    // The old mean-of-ratios would be (1.0 + 2.0) / 2 = 1.5 — it lets the ฿10
    // row veto half the answer.
    const stats = computeRoas([meta(10), meta(2000)], 1010);

    expect(stats.minRoas).toBeCloseTo(1.9901, 4);
    expect(stats.minRoas).not.toBeCloseTo(1.5, 1);
  });

  it("reproduces the live account's measured return", () => {
    // Measured 2026-08-14 against act_1025260845170202 over 2025-01-01 →
    // 2026-08-14: ฿3,605.00 of attributed revenue on 6 of 32 rows, ฿1,382.64 of
    // spend across all 32. 3605 / 1382.64 = 2.60736...
    const rows = [
      ...[630, 495, 1305, 180, 495, 500].map(meta),
      ...Array.from({ length: 26 }, () => meta(null)),
    ];
    const stats = computeRoas(rows, 1382.64);

    expect(stats.totalRevenue).toBe(3605);
    expect(stats.revenueCoverage).toEqual({ withRevenue: 6, total: 32 });
    expect(stats.minRoas).toBeCloseTo(2.6074, 3);
  });

  it("totals only the rows that reported, and says how many did", () => {
    const stats = computeRoas([meta(100), meta(null), meta(250)], 500);

    expect(stats.totalRevenue).toBe(350);
    expect(stats.revenueCoverage).toEqual({ withRevenue: 2, total: 3 });
  });
});

describe("computeRoas — when a figure may be stated", () => {
  it("states a bound when the only source reported somewhere", () => {
    // 6 of 32 rows is the live shape, and it must still produce a number: the
    // missing rows can only add revenue, never remove it.
    const stats = computeRoas([meta(600), meta(null)], 500);

    expect(stats.minRoas).toBe(1.2);
    expect(stats.sourcesWithoutRevenue).toEqual([]);
  });

  it("withholds it when a source in the selection never reported revenue", () => {
    // The combined view: Meta rows carrying ฿600 alongside imported rows that
    // will never carry any. 600 ÷ 5000 = 0.12x is arithmetically true and would
    // be read as a catastrophic campaign.
    const stats = computeRoas([meta(600), imported(null)], 5000);

    expect(stats.minRoas).toBeNull();
    expect(stats.sourcesWithoutRevenue).toEqual(["import"]);
    // The total is still reported — the caller may show revenue without a ratio.
    expect(stats.totalRevenue).toBe(600);
  });

  it("names every non-reporting source, in a stable order", () => {
    const stats = computeRoas(
      [
        meta(600),
        imported(null),
        { revenue: null, data_source: "mock" },
      ],
      5000
    );

    // Ordered by AD_DATA_SOURCES ("mock" before "import"), not by row order, so
    // the sentence built from this does not reshuffle between renders.
    expect(stats.sourcesWithoutRevenue).toEqual(["mock", "import"]);
  });

  it("withholds it when no row reported revenue at all", () => {
    const stats = computeRoas([imported(null), imported(null)], 5000);

    expect(stats.minRoas).toBeNull();
    expect(stats.totalRevenue).toBe(0);
    expect(stats.sourcesWithoutRevenue).toEqual(["import"]);
  });

  it("states a measured zero, which is a different claim from an absent one", () => {
    // A source that DOES report revenue reporting none is a measurement: this
    // campaign spent ฿5,000 and earned nothing, and 0.0x is the honest answer.
    // Only NULL is silence.
    const stats = computeRoas([meta(0), meta(0)], 5000);

    expect(stats.minRoas).toBe(0);
    expect(stats.revenueCoverage).toEqual({ withRevenue: 2, total: 2 });
  });

  it("withholds it when nothing was spent, rather than dividing by zero", () => {
    const stats = computeRoas([meta(400)], 0);

    expect(stats.minRoas).toBeNull();
  });

  it("withholds it on an empty selection", () => {
    const stats = computeRoas([], 5000);

    expect(stats.minRoas).toBeNull();
    expect(stats.revenueCoverage).toEqual({ withRevenue: 0, total: 0 });
    expect(stats.sourcesWithoutRevenue).toEqual([]);
  });
});

describe("computeRoas — sabotage", () => {
  it("fails if the mean-of-ratios ever comes back", () => {
    // Written as a check on the replacement rather than on the deleted code:
    // these two inputs have identical Σrevenue and Σspend and different per-row
    // ratios, so any implementation that averages ratios gives them different
    // answers. Equality here is only possible for one that divides the sums.
    const lumped = computeRoas([meta(2010)], 1010);
    const split = computeRoas([meta(10), meta(2000)], 1010);

    expect(split.minRoas).toBe(lumped.minRoas);
  });

  it("fails if a non-reporting source is ever counted as a measured zero", () => {
    // The tempting simplification is `revenue ?? 0`. It compiles, it produces a
    // number, and it silently reprices 273 imported rows as earning nothing.
    const treatedAsZero = computeRoas([meta(600), imported(0)], 5000);
    const actual = computeRoas([meta(600), imported(null)], 5000);

    expect(treatedAsZero.minRoas).toBe(0.12);
    expect(actual.minRoas).toBeNull();
  });
});
