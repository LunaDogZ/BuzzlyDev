import { describe, it, expect } from "vitest";
import {
  AD_DATA_SOURCES,
  AD_DATA_SOURCE_OPTIONS,
  AD_DATA_SOURCE_NOUN,
  sourcesFor,
  type AdDataSourceFilter,
} from "@/constants/adDataSource";

describe("sourcesFor", () => {
  it("selects every stored value for the unfiltered case", () => {
    // "all" must not translate to a filter that omits a value. If a third
    // source is ever added to the column, forgetting it here would silently
    // drop those rows out of the default view — totals that quietly stop
    // summing are the failure this whole feature exists to prevent.
    expect(sourcesFor("all")).toEqual(AD_DATA_SOURCES);
  });

  it("selects exactly one value for a filtered case", () => {
    expect(sourcesFor("import")).toEqual(["import"]);
    expect(sourcesFor("api")).toEqual(["api"]);
  });

  it("covers the whole column between the two filtered cases", () => {
    // import ∪ api === all: no row can fall outside both sides of the split,
    // so the two filtered views always add back up to the unfiltered one.
    const union = [...sourcesFor("import"), ...sourcesFor("api")].sort();
    expect(union).toEqual([...AD_DATA_SOURCES].sort());
  });

  it("never returns an empty list", () => {
    // An empty `.in()` matches nothing, which would render as "no data" rather
    // than as an error — an empty dashboard that blames the merchant's data.
    const filters: AdDataSourceFilter[] = ["all", "import", "api"];
    for (const filter of filters) {
      expect(sourcesFor(filter).length).toBeGreaterThan(0);
    }
  });
});

describe("the filter's vocabulary", () => {
  it("offers one option per filter value", () => {
    expect(AD_DATA_SOURCE_OPTIONS.map((o) => o.value)).toEqual(["all", "import", "api"]);
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
