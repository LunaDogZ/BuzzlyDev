import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ImportJobsList } from "@/components/imports/ImportJobsList";
import type { ImportJob, ImportJobStatus } from "@/hooks/useImportJobs";

function job(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    team_id: "22222222-2222-2222-2222-222222222222",
    uploaded_by: null,
    platform: "meta",
    storage_path: "team/job/ads.csv",
    original_filename: "ads-export.csv",
    file_hash: null,
    file_size_bytes: 2048,
    status: "succeeded",
    rows_total: 30,
    rows_ok: 30,
    rows_quarantined: 0,
    error_report_path: null,
    error_message: null,
    dag_run_id: null,
    started_at: null,
    finished_at: null,
    created_at: "2026-08-05T10:00:00Z",
    ...overrides,
  };
}

function renderList(jobs: ImportJob[]) {
  return render(
    <MemoryRouter>
      <ImportJobsList jobs={jobs} isLoading={false} />
    </MemoryRouter>
  );
}

const dashboardLink = () => screen.queryByRole("link", { name: /view on dashboard/i });

describe("ImportJobsList — dashboard link", () => {
  it("offers the dashboard once rows have landed", () => {
    renderList([job()]);
    expect(dashboardLink()).toHaveAttribute("href", "/dashboard");
  });

  it("offers it for a partial import too — some rows did land", () => {
    renderList([job({ status: "partial", rows_total: 10, rows_ok: 3, rows_quarantined: 7 })]);
    expect(dashboardLink()).not.toBeNull();
  });

  it("does not offer it when a succeeded job ingested nothing", () => {
    // A duplicate re-upload, or a report kind with no target table yet, both
    // finish `succeeded` with 0 rows. Sending the merchant to a dashboard that
    // cannot have changed would be a worse lie than saying nothing at all.
    renderList([
      job({
        rows_total: 0,
        rows_ok: 0,
        error_message: "Nothing to ingest — identical to an earlier import.",
      }),
    ]);
    expect(dashboardLink()).toBeNull();
  });

  it.each<ImportJobStatus>(["pending", "queued", "running", "failed", "cancelled"])(
    "does not offer it while a job is %s",
    (status) => {
      renderList([job({ status, rows_ok: 30 })]);
      expect(dashboardLink()).toBeNull();
    }
  );
});
