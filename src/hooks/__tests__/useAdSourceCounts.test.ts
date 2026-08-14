import { describe, it, expect } from "vitest";
import { countFor, largestSource } from "@/hooks/useAdSourceCounts";
import type { AdSourceCounts } from "@/hooks/useAdSourceCounts";

const counts = (partial: Partial<AdSourceCounts>): AdSourceCounts => ({
  mock: 0,
  meta_live: 0,
  import: 0,
  api: 0,
  ...partial,
});

describe("countFor", () => {
  it("sums only what the combined view actually aggregates", () => {
    // The fixture rows are withheld from "all", so they must not appear in the
    // number printed beside it either. A count that included them would
    // advertise rows the charts underneath deliberately do not draw.
    const c = counts({ import: 273, meta_live: 31, mock: 82, api: 0 });

    expect(countFor(c, "all")).toBe(304);
    expect(countFor(c, "all")).not.toBe(386);
  });

  it("reports a single source on its own", () => {
    const c = counts({ import: 273, meta_live: 31, mock: 82 });

    expect(countFor(c, "import")).toBe(273);
    expect(countFor(c, "meta_live")).toBe(31);
    expect(countFor(c, "mock")).toBe(82);
  });

  it("distinguishes an unknown count from a count of zero", () => {
    // Null means the count query failed; zero means the source is empty. The
    // caller renders those differently, so collapsing them here would make an
    // outage read as "this source has no data".
    expect(countFor(null, "import")).toBeNull();
    expect(countFor(counts({}), "import")).toBe(0);
  });
});

describe("largestSource", () => {
  it("never opens the page on the combined view", () => {
    // "all" is a sum of the others, so if it were allowed to compete it would
    // win every time and "default to the largest source" would silently mean
    // "always default to all" — the behaviour this replaces.
    const c = counts({ import: 273, meta_live: 31, mock: 82 });

    expect(largestSource(c)).toBe("import");
  });

  it("picks the largest single source, whichever it is", () => {
    expect(largestSource(counts({ import: 5, meta_live: 900, mock: 82 }))).toBe("meta_live");
    expect(largestSource(counts({ import: 5, meta_live: 3, mock: 82 }))).toBe("mock");
  });

  it("falls back to the combined view when nothing has rows", () => {
    // Returning a source here would put an empty workspace on one arbitrary
    // path and imply that path had failed.
    expect(largestSource(counts({}))).toBeNull();
    expect(largestSource(null)).toBeNull();
  });

  it("never returns a value the picker cannot get back to", () => {
    // "api" is not offered in the dropdown. Opening on it would strand the
    // merchant on a view with no way to leave it.
    expect(largestSource(counts({ api: 9999 }))).toBeNull();
  });
});
