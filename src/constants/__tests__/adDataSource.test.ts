import { describe, it, expect } from "vitest";
import {
  AD_DATA_SOURCES,
  AD_DATA_SOURCE_OPTIONS,
  AD_DATA_SOURCE_NOUN,
  UNAGGREGATED_SOURCES,
  sourcesFor,
  type AdDataSourceFilter,
} from "@/constants/adDataSource";

describe("sourcesFor", () => {
  it("aggregates every stored value except the ones deliberately withheld", () => {
    // This assertion used to read `toEqual(AD_DATA_SOURCES)` — "all" summed the
    // whole column. It no longer does: fixtures are withheld from the combined
    // view, because a total that is part measurement and part fiction cannot be
    // read as either.
    //
    // The protection the old assertion gave up must not be given up with it. A
    // source that quietly stops summing is still the failure this feature
    // exists to prevent, so the rule is now "summed unless explicitly
    // withheld", derived rather than hand-listed, and asserted as such.
    const expected = AD_DATA_SOURCES.filter((v) => !UNAGGREGATED_SOURCES.includes(v));

    expect(sourcesFor("all")).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });

  it("withholds the fixture source from the combined view, and only that", () => {
    // Named explicitly rather than derived from the same constant the
    // implementation uses: deriving both sides from `UNAGGREGATED_SOURCES`
    // would make this test agree with any value that constant ever holds,
    // including an empty one. Fixtures out, real sources in.
    expect(UNAGGREGATED_SOURCES).toEqual(["mock"]);
    expect(sourcesFor("all")).not.toContain("mock");
    expect(sourcesFor("all")).toContain("import");
    expect(sourcesFor("all")).toContain("meta_live");
  });

  it("keeps the unattributed value inside the total", () => {
    // "api" is absent from the picker but must stay in the sum. It should match
    // no row after 20260812060000; if a writer ever forgets to declare its
    // source, those rows have to surface in the total rather than vanish from
    // every view at once.
    expect(sourcesFor("all")).toContain("api");
  });

  it("still isolates the fixture source when asked for by name", () => {
    // Withholding "mock" from the total must not make it unreachable — the
    // whole point of the split is being able to look at each path in turn.
    expect(sourcesFor("mock")).toEqual(["mock"]);
  });

  it("selects exactly one value for a filtered case", () => {
    for (const source of AD_DATA_SOURCES) {
      expect(sourcesFor(source)).toEqual([source]);
    }
  });

  it("leaves exactly one stored value unreachable from the picker", () => {
    // Was "import ∪ api === all" while the column held two values. It holds
    // four since 20260812060000, and the split is no longer symmetric: the
    // dropdown deliberately omits "api", because an unattributed row is a bug
    // signal rather than a source a merchant should choose between.
    //
    // So the invariant worth holding is that "api" is the ONLY thing a merchant
    // cannot filter to. Adding a fifth source to the column without adding it
    // to the dropdown would make those rows visible in the unfiltered total and
    // impossible to isolate — this fails the day that happens.
    const offered = AD_DATA_SOURCE_OPTIONS.map((o) => o.value).filter((v) => v !== "all");
    const reachable = new Set(offered.flatMap((v) => sourcesFor(v)));
    const unreachable = AD_DATA_SOURCES.filter((v) => !reachable.has(v));

    expect(unreachable).toEqual(["api"]);
  });

  it("never returns an empty list", () => {
    // An empty `.in()` matches nothing, which would render as "no data" rather
    // than as an error — an empty dashboard that blames the merchant's data.
    const filters: AdDataSourceFilter[] = ["all", ...AD_DATA_SOURCES];
    for (const filter of filters) {
      expect(sourcesFor(filter).length).toBeGreaterThan(0);
    }
  });
});

describe("the filter's vocabulary", () => {
  it("offers one option per filter value", () => {
    // Order is asserted, not just membership: the real Meta source sits
    // directly under the combined view so it is the first thing a merchant can
    // pick, and the simulated one is last. "api" is absent on purpose — see the
    // unreachability test above.
    expect(AD_DATA_SOURCE_OPTIONS.map((o) => o.value)).toEqual([
      "all",
      "meta_live",
      "import",
      "mock",
    ]);
  });

  it("names every option the picker can be set to", () => {
    // A missing noun renders as "undefinedครอบคลุม …" in the empty state.
    for (const option of AD_DATA_SOURCE_OPTIONS) {
      expect(AD_DATA_SOURCE_NOUN[option.value]).toBeTruthy();
    }
  });

  it("does not offer a stored value the column cannot hold", () => {
    const offered = AD_DATA_SOURCE_OPTIONS.map((o) => o.value).filter((v) => v !== "all");
    expect(offered.every((v) => (AD_DATA_SOURCES as readonly string[]).includes(v))).toBe(true);
  });
});
