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
    current_stage: null,
    stage_updated_at: null,
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

describe("ImportJobsList — stage progress", () => {
  it("names the stage and the step a running job is on", () => {
    renderList([job({ status: "running", current_stage: "clean_thai" })]);
    expect(screen.getByText("Cleaning Thai dates and amounts")).toBeInTheDocument();
    // 6th of the 10 tasks that report progress.
    expect(screen.getByText(/step 6 of 10/i)).toBeInTheDocument();
  });

  it("explains the wait when no run has picked the job up yet", () => {
    // `pending` has no stage by definition — the bar is empty and the copy
    // says why, rather than inventing progress the pipeline has not made.
    renderList([job({ status: "pending", current_stage: null })]);
    expect(screen.getByText(/waiting for the pipeline/i)).toBeInTheDocument();
    expect(screen.queryByText(/step \d+ of/i)).toBeNull();
  });

  it("falls back to a plain spinner for a stage it does not recognise", () => {
    // A stage renamed in the DAG without this file: better to say nothing than
    // to render a wrong step number.
    renderList([job({ status: "running", current_stage: "some_new_stage" })]);
    expect(screen.queryByText(/step \d+ of/i)).toBeNull();
    expect(screen.getByText("Processing…")).toBeInTheDocument();
  });

  it("shows no progress bar once a job is finished", () => {
    renderList([job({ status: "succeeded", current_stage: "finalize" })]);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("says where a failed job stopped", () => {
    renderList([job({ status: "failed", current_stage: "verify_artifact", rows_total: 0 })]);
    expect(screen.getByText(/stopped at: checking the upload/i)).toBeInTheDocument();
  });
});

describe("ImportJobsList — skipped rows", () => {
  const toggle = () => screen.queryByRole("button", { name: /skipped rows/i });

  it("offers the rejected rows when there are any", () => {
    renderList([job({ status: "partial", rows_total: 10, rows_ok: 3, rows_quarantined: 7 })]);
    expect(toggle()).toHaveTextContent("See the 7 skipped rows");
  });

  it("offers them on a failed job too — every row rejected is still a reason", () => {
    renderList([job({ status: "failed", rows_total: 7, rows_ok: 0, rows_quarantined: 7 })]);
    expect(toggle()).not.toBeNull();
  });

  it("offers nothing when every row landed", () => {
    renderList([job()]);
    expect(toggle()).toBeNull();
  });

  it("keeps the panel closed until asked — it is what triggers the query", () => {
    renderList([job({ status: "partial", rows_total: 10, rows_ok: 3, rows_quarantined: 7 })]);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table")).toBeNull();
  });
});
