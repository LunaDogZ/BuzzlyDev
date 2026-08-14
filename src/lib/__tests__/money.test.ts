import { describe, it, expect } from "vitest";
import { formatTHB } from "@/lib/money";

describe("formatTHB", () => {
  it("never prints a third decimal place", () => {
    // The defect. `toLocaleString` defaults to *up to* three fraction digits,
    // so ฿374,241.27 ÷ 5,951 conversions rendered on the dashboard as
    // "฿62.887" — a precision no baht amount has.
    expect(formatTHB(374241.27 / 5951)).toBe("฿62.89");
    expect(formatTHB(1350.08 / 1530)).toBe("฿0.88");
  });

  it("pads a whole amount to satang", () => {
    // Both bounds, not just the ceiling. ฿1,350 sitting beside a ฿1,350.08 out
    // of the same column reads as two different quantities.
    expect(formatTHB(1350)).toBe("฿1,350.00");
    expect(formatTHB(0)).toBe("฿0.00");
  });

  it("groups thousands", () => {
    expect(formatTHB(374241.27)).toBe("฿374,241.27");
  });

  it("keeps the sign on a negative amount", () => {
    // Net profit can be negative, and that is the number the merchant most
    // needs to see rather than have swallowed.
    expect(formatTHB(-250.5)).toBe("฿-250.50");
  });

  it("admits it has no figure instead of printing ฿NaN", () => {
    // NaN in a money cell means an upstream division produced nothing.
    expect(formatTHB(Number.NaN)).toBe("—");
    expect(formatTHB(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("formats the same regardless of the machine's locale", () => {
    // The two formatters this replaced disagreed — one passed "th-TH", the
    // other passed nothing and inherited the runtime default — so the same
    // amount could render differently on two pages of the same app.
    expect(formatTHB(1234.5)).toBe("฿1,234.50");
  });
});
