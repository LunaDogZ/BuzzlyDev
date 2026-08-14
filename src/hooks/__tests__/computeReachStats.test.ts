import { describe, it, expect } from "vitest";
import { computeReachStats } from "@/hooks/useDashboardMetrics";

/**
 * `reach` was stored on every row and read by nothing until 2026-08-14. It is
 * displayed now, and these tests exist because it is the one metric on the
 * dashboard that cannot be totalled the way the others can:
 *
 *  - reach is a distinct count of people, so it does not add across days —
 *    one person seen Monday and Tuesday is two days' reach and one person;
 *  - the column is nullable and unevenly filled — measured the same day,
 *    `import` carried it on 150 of 273 rows, `meta_live` and `mock` on all.
 *
 * Those two distort a derived frequency in *opposite* directions, so they do
 * not average out into something approximately right. That is what makes the
 * gate below a correctness rule rather than a display preference.
 */

const row = (reach: number | null) => ({ reach });

describe("computeReachStats — the total", () => {
  it("adds only the rows that reported, and says how many did", () => {
    const stats = computeReachStats([row(100), row(null), row(250)], 0);

    expect(stats.summedDailyReach).toBe(350);
    expect(stats.reachCoverage).toEqual({ withReach: 2, total: 3 });
  });

  it("counts a reported zero as reported", () => {
    // 0 means nobody was reached that day; NULL means the platform never said.
    // Collapsing the two would let a fully-reported window look partial and
    // silently withhold a frequency that is perfectly sound.
    const stats = computeReachStats([row(0), row(500)], 1000);

    expect(stats.reachCoverage).toEqual({ withReach: 2, total: 2 });
    expect(stats.minFrequency).toBeCloseTo(2, 5);
  });

  it("reports no coverage for an empty window rather than dividing by nothing", () => {
    const stats = computeReachStats([], 5000);

    expect(stats.summedDailyReach).toBe(0);
    expect(stats.reachCoverage).toEqual({ withReach: 0, total: 0 });
    expect(stats.minFrequency).toBeNull();
  });
});

describe("computeReachStats — when frequency may be stated", () => {
  it("states it when every row reported", () => {
    const stats = computeReachStats([row(1000), row(1000)], 5000);

    expect(stats.minFrequency).toBeCloseTo(2.5, 5);
  });

  it("refuses to state it when any row did not report", () => {
    // THE regression. The missing row's reach is absent from the denominator
    // but its impressions are present in the numerator, so the quotient is
    // pushed up by an unknown amount — it can land above the true frequency,
    // which no `≥` qualifier would cover. This is the real shape of the
    // `import` source today: 150 of 273 rows.
    const complete = computeReachStats([row(1000), row(1000)], 5000);
    const partial = computeReachStats([row(1000), row(null)], 5000);

    expect(complete.minFrequency).not.toBeNull();
    expect(partial.minFrequency).toBeNull();

    // And specifically not the inflated figure a naive version would show.
    expect(partial.minFrequency).not.toBeCloseTo(5, 5);
  });

  it("refuses to state it when nobody was reached at all", () => {
    // Fully reported, all zeros: the division is x/0. Infinity must not reach
    // the screen, and neither must the 0 that a `Number.isFinite` fallback to
    // zero would produce — "≥ 0.0 times per person" reads as a measurement.
    const stats = computeReachStats([row(0), row(0)], 5000);

    expect(stats.reachCoverage).toEqual({ withReach: 2, total: 2 });
    expect(stats.minFrequency).toBeNull();
  });

  it("gives a lower bound, never an over-estimate, on complete data", () => {
    // The property the `≥` on screen is claiming. True reach over the window is
    // at most the sum of the daily figures, so dividing by that sum can only
    // produce a frequency at or below the truth.
    //
    // Worked case: the same 1,000 people on each of three days, 9,000
    // impressions. True reach is 1,000 and true frequency is 9.0; the sum is
    // 3,000 and the reported bound is 3.0. Under, as promised.
    const stats = computeReachStats([row(1000), row(1000), row(1000)], 9000);

    expect(stats.minFrequency).toBeCloseTo(3, 5);
    expect(stats.minFrequency!).toBeLessThanOrEqual(9);
  });
});
