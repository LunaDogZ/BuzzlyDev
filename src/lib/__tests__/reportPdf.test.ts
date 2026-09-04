import { describe, it, expect } from "vitest";
import { reportObjectPath } from "@/lib/reportPdf";

/**
 * `reports.file_url` changed meaning when `20260903000500_reports_bucket_not_public.sql`
 * closed the bucket: it holds a storage object path now, and a link is minted per
 * click. This is the one branch in that path — recovering the object name from a
 * row still holding the old `/object/public/reports/` URL.
 *
 * The migration nulled every such row, so the recovery should never fire in
 * practice. It is here so that a row arriving from a client running older code is
 * repaired rather than signed as a path that does not exist.
 */
describe("reportObjectPath", () => {
  it("passes a plain object path through untouched", () => {
    expect(reportObjectPath("report_1774358856432.pdf")).toBe("report_1774358856432.pdf");
  });

  it("recovers the object name from a legacy public URL", () => {
    expect(
      reportObjectPath(
        "https://aokzvknggtccgwbavszj.supabase.co/storage/v1/object/public/reports/executive_report_1774358856432.pdf"
      )
    ).toBe("executive_report_1774358856432.pdf");
  });

  it("recovers it from the authenticated route too", () => {
    expect(
      reportObjectPath(
        "https://aokzvknggtccgwbavszj.supabase.co/storage/v1/object/reports/report_1.xlsx"
      )
    ).toBe("report_1.xlsx");
  });

  it("drops a query string, which would otherwise become part of the object name", () => {
    expect(reportObjectPath("report_1.pdf?download=Sales%20Report.pdf")).toBe("report_1.pdf");
  });

  it("keeps the last segment when the bucket name also appears earlier in the URL", () => {
    expect(
      reportObjectPath("https://host/reports/v1/object/public/reports/nested_name.pdf")
    ).toBe("nested_name.pdf");
  });
});
