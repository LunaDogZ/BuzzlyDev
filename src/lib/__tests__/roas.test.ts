import { describe, it, expect } from "vitest";
import { formatRoas, roasWithheldReason } from "@/lib/roas";

/**
 * The two halves of what a merchant actually sees: the qualifier on the number,
 * and the sentence that replaces it when there is no number.
 *
 * "—" alone reads as a broken app; naming the cause turns it into a fact about
 * their data with a next step attached. And a ROAS printed without its `≥`
 * turns a lower bound into a claim — the bound exists because Meta omits
 * `action_values` from days it attributed no purchase value to.
 */

const withheld = (
  withRevenue: number,
  total: number,
  sourcesWithoutRevenue: ("mock" | "meta_live" | "import" | "api")[],
  totalSpend: number
) => ({
  revenueCoverage: { withRevenue, total },
  sourcesWithoutRevenue,
  totalSpend,
});

describe("roasWithheldReason", () => {
  it("blames the empty window when there are no rows", () => {
    expect(roasWithheldReason(withheld(0, 0, [], 0))).toBe("ยังไม่มีข้อมูลในช่วงเวลานี้");
  });

  it("names the source that does not report revenue", () => {
    // "the uploaded files do not report revenue" points at the Meta view;
    // "cannot be calculated" points nowhere.
    expect(roasWithheldReason(withheld(31, 304, ["import"], 12000))).toBe(
      "ข้อมูลจากไฟล์ที่อัปโหลดไม่ได้รายงานรายได้ จึงยังคำนวณ ROAS ไม่ได้"
    );
  });

  it("names both when two sources are silent", () => {
    expect(roasWithheldReason(withheld(31, 400, ["mock", "import"], 12000))).toBe(
      // Spaces on both sides of "และ" — Thai separates clauses that way, and
      // the joined string is read aloud by a merchant, not parsed.
      "ข้อมูลจำลองจากเซิร์ฟเวอร์ทดสอบ และ ข้อมูลจากไฟล์ที่อัปโหลดไม่ได้รายงานรายได้ จึงยังคำนวณ ROAS ไม่ได้"
    );
  });

  it("blames the denominator when every source reported but nothing was spent", () => {
    expect(roasWithheldReason(withheld(31, 31, [], 0))).toBe("ยังไม่มีค่าโฆษณาในช่วงนี้");
  });
});

describe("formatRoas", () => {
  it("marks a partial figure as a lower bound", () => {
    // The live shape: 6 of 32 rows reported revenue, so ฿3,605 is a floor and
    // 2.6x is the least the account returned, not what it returned.
    expect(formatRoas({ revenueCoverage: { withRevenue: 6, total: 32 }, minRoas: 2.6074 })).toBe(
      "≥ 2.6x"
    );
  });

  it("drops the sign when every row reported, because nothing is missing", () => {
    expect(formatRoas({ revenueCoverage: { withRevenue: 32, total: 32 }, minRoas: 2.6074 })).toBe(
      "2.6x"
    );
  });

  it("returns null so the caller renders its own blank", () => {
    expect(formatRoas({ revenueCoverage: { withRevenue: 0, total: 32 }, minRoas: null })).toBeNull();
  });
});
