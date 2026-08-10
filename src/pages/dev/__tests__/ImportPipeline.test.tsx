import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DevImportJob, DlqRecord } from "@/hooks/useDevImports";

const logAuditEvent = vi.fn().mockResolvedValue(undefined);
const toast = vi.fn();

vi.mock("@/lib/auditLogger", () => ({
  logAuditEvent: (...args: unknown[]) => logAuditEvent(...args),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

const dlqState: { records: DlqRecord[] } = { records: [] };
const jobState: { jobs: DevImportJob[] } = { jobs: [] };

vi.mock("@/hooks/useDevImports", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useDevImports")>(
    "@/hooks/useDevImports",
  );
  return {
    ...actual,
    useDevDlq: () => ({
      records: dlqState.records,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
    useDevImportJobs: () => ({ jobs: jobState.jobs, isLoading: false, error: null }),
  };
});

import ImportPipeline from "@/pages/dev/ImportPipeline";

const SECRET_MESSAGE = "Row 4: negative spend -1250.00 for order SO-88213";
const SECRET_DETAIL_VALUE = "SO-88213";

function record(overrides: Partial<DlqRecord> = {}): DlqRecord {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    import_job_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    team_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    batch_id: null,
    original_filename: "shopee-income-july.csv",
    file_hash: null,
    platform: "shopee_income",
    error_code: "ROW_VALIDATION_FAILED",
    error_message: SECRET_MESSAGE,
    stage: "validate",
    rows_attempted: 10,
    rows_rejected: 7,
    detail: { first_offending_order: SECRET_DETAIL_VALUE },
    dag_run_id: "manual__2026-08-10T09:00:00",
    occurred_at: "2026-08-10T09:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  dlqState.records = [record()];
  jobState.jobs = [];
  logAuditEvent.mockClear();
  toast.mockClear();
});

describe("ImportPipeline — the privacy gate", () => {
  it("shows the diagnosis without the merchant's values", () => {
    render(<ImportPipeline />);

    // Safe to show: which file, which code, which stage, how many rows.
    expect(screen.getByText("shopee-income-july.csv")).toBeInTheDocument();
    expect(screen.getByText(/Stopped at validate/)).toBeInTheDocument();
    expect(screen.getByText(/7 of 10 rows rejected/)).toBeInTheDocument();

    // Not safe: the quoted cells. These are a merchant's own order and revenue
    // data, and must not be in the DOM before anyone asked for them.
    expect(screen.queryByText(new RegExp(SECRET_DETAIL_VALUE))).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SECRET_MESSAGE);
  });

  it("reveals the detail only after the reveal is pressed", async () => {
    const user = userEvent.setup();
    render(<ImportPipeline />);

    // Asserted on both sides of the click on purpose: checking only the "after"
    // state would pass just as happily against a page with no gate at all.
    expect(document.body.textContent).not.toContain(SECRET_MESSAGE);

    await user.click(screen.getByRole("button", { name: /reveal detail/i }));

    await waitFor(() => {
      expect(document.body.textContent).toContain(SECRET_MESSAGE);
    });
    expect(document.body.textContent).toContain(SECRET_DETAIL_VALUE);
  });

  it("writes an audit entry naming the record that was revealed", async () => {
    const user = userEvent.setup();
    render(<ImportPipeline />);

    await user.click(screen.getByRole("button", { name: /reveal detail/i }));

    await waitFor(() => expect(logAuditEvent).toHaveBeenCalledTimes(1));
    const call = logAuditEvent.mock.calls[0][0];
    expect(call.category).toBe("security");
    expect(call.metadata).toMatchObject({
      dlq_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      import_job_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      error_code: "ROW_VALIDATION_FAILED",
    });
  });

  it("reveals one record without revealing its neighbour", async () => {
    dlqState.records = [
      record(),
      record({
        id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
        original_filename: "meta-ads.csv",
        error_message: "Row 9: clicks 4000 exceed impressions 120",
      }),
    ];
    const user = userEvent.setup();
    render(<ImportPipeline />);

    const buttons = screen.getAllByRole("button", { name: /reveal detail/i });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[0]);

    await waitFor(() => expect(document.body.textContent).toContain(SECRET_MESSAGE));
    // The second file's quoted values must still be hidden — a reveal is per
    // record, not a switch that opens the whole table.
    expect(document.body.textContent).not.toContain("clicks 4000 exceed impressions 120");
    expect(screen.getAllByRole("button", { name: /reveal detail/i })).toHaveLength(1);
  });
});

describe("ImportPipeline — what the numbers claim", () => {
  it("flags an UNKNOWN refusal as a defect in our own classifier", () => {
    dlqState.records = [record({ error_code: "UNKNOWN" })];
    render(<ImportPipeline />);

    expect(screen.getByText(/classified as UNKNOWN/)).toBeInTheDocument();
    expect(screen.getByText(/defect report about our classifier/)).toBeInTheDocument();
  });

  it("says nothing about a refusal rate when no job has finished", () => {
    jobState.jobs = [
      {
        id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        team_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        platform: "meta",
        original_filename: "ads.csv",
        status: "running",
        current_stage: "parse",
        rows_total: 0,
        rows_ok: 0,
        rows_quarantined: 0,
        created_at: "2026-08-10T09:00:00Z",
      },
    ];
    render(<ImportPipeline />);

    // A dash, never "0.0%" — claiming a zero refusal rate off an unfinished
    // job would be a statement the data does not support.
    expect(screen.getByText("Refusal rate").parentElement?.textContent).toContain("—");
  });

  it("accounts for every job on screen, so the tiles add up", () => {
    // The bug this pins: 10 imports shown as 6 succeeded and 2 failed leaves two
    // jobs nowhere, and a reader who cannot reconcile the tiles is right to
    // distrust all of them. Legacy `partial` rows are the ones that go missing.
    const make = (status: DevImportJob["status"], n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `${status}-${i}`,
        team_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        platform: "meta",
        original_filename: "ads.csv",
        status,
        current_stage: null,
        rows_total: 0,
        rows_ok: 0,
        rows_quarantined: 0,
        created_at: "2026-08-10T09:00:00Z",
      }));

    jobState.jobs = [...make("succeeded", 6), ...make("failed", 2), ...make("partial", 2)];
    render(<ImportPipeline />);

    const tile = (label: string) =>
      Number(screen.getByText(label).parentElement?.querySelector("p.text-2xl")?.textContent);

    expect(tile("Imports (recent)")).toBe(10);
    expect(tile("Succeeded") + tile("Failed") + tile("Legacy partial")).toBe(
      tile("Imports (recent)"),
    );
  });

  it("hides the legacy-partial tile when there are none", () => {
    jobState.jobs = [];
    render(<ImportPipeline />);
    expect(screen.queryByText("Legacy partial")).not.toBeInTheDocument();
  });

  it("tells the empty queue apart from an over-filtered one", () => {
    dlqState.records = [];
    render(<ImportPipeline />);

    expect(screen.getByText("No file has been refused yet")).toBeInTheDocument();
  });
});
