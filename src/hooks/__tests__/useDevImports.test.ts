import { describe, it, expect } from "vitest";
import {
  DLQ_ERROR_CODES,
  countByErrorCode,
  countByStage,
  summariseJobs,
  type DevImportJob,
  type DlqRecord,
} from "@/hooks/useDevImports";

function record(overrides: Partial<DlqRecord> = {}): DlqRecord {
  return {
    id: crypto.randomUUID(),
    import_job_id: null,
    team_id: null,
    batch_id: null,
    original_filename: "export.csv",
    file_hash: null,
    platform: "meta",
    error_code: "SCHEMA_MISMATCH",
    error_message: null,
    stage: "detect_format",
    rows_attempted: 0,
    rows_rejected: 0,
    detail: null,
    dag_run_id: null,
    occurred_at: "2026-08-10T09:00:00Z",
    ...overrides,
  };
}

function job(overrides: Partial<DevImportJob> = {}): DevImportJob {
  return {
    id: crypto.randomUUID(),
    team_id: "22222222-2222-2222-2222-222222222222",
    platform: "meta",
    original_filename: "ads.csv",
    status: "succeeded",
    current_stage: "finalize",
    rows_total: 30,
    rows_ok: 30,
    rows_quarantined: 0,
    created_at: "2026-08-10T09:00:00Z",
    ...overrides,
  };
}

describe("countByErrorCode", () => {
  it("reports every code, including the ones no file can reach", () => {
    const counts = countByErrorCode([record({ error_code: "EMPTY_PAYLOAD" })]);

    expect(counts).toHaveLength(DLQ_ERROR_CODES.length);
    // A zero has to be rendered, not omitted: the dev needs to see that
    // ENCODING_ERROR is empty for a structural reason.
    expect(counts.find((entry) => entry.code === "ENCODING_ERROR")?.count).toBe(0);
    expect(counts.find((entry) => entry.code === "EMPTY_PAYLOAD")?.count).toBe(1);
  });

  it("keeps the canonical code order rather than sorting by frequency", () => {
    const counts = countByErrorCode([
      record({ error_code: "UNKNOWN" }),
      record({ error_code: "UNKNOWN" }),
      record({ error_code: "SCHEMA_MISMATCH" }),
    ]);

    expect(counts.map((entry) => entry.code)).toEqual(DLQ_ERROR_CODES.map((entry) => entry.code));
  });
});

describe("countByStage", () => {
  it("counts refusals against the stage that produced them", () => {
    const stages = countByStage([
      record({ stage: "parse" }),
      record({ stage: "parse" }),
      record({ stage: "validate" }),
    ]);

    expect(stages.find((entry) => entry.stage === "parse")?.count).toBe(2);
    expect(stages.find((entry) => entry.stage === "validate")?.count).toBe(1);
    expect(stages.find((entry) => entry.stage === "finalize")?.count).toBe(0);
  });

  it("surfaces a stage the UI does not know instead of dropping it", () => {
    // An unrecognised stage means the DAG and this file have drifted. Silently
    // discarding the row would hide the drift and undercount the refusals.
    const stages = countByStage([record({ stage: "some_new_stage" })]);
    const drifted = stages.find((entry) => entry.stage === "some_new_stage");

    expect(drifted).toBeDefined();
    expect(drifted?.count).toBe(1);
    expect(drifted?.label).toContain("unrecognised");
  });

  it("ignores a null stage without inventing a bucket for it", () => {
    const stages = countByStage([record({ stage: null })]);
    expect(stages.every((entry) => entry.count === 0)).toBe(true);
  });
});

describe("summariseJobs", () => {
  it("counts a legacy partial separately from success and failure", () => {
    // `terminal_status()` cannot produce `partial` any more, but rows written
    // before all-or-nothing still say it. Folding it into either side would
    // misreport what the pipeline did at the time.
    const summary = summariseJobs([
      job({ status: "succeeded" }),
      job({ status: "failed" }),
      job({ status: "partial" }),
    ]);

    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.legacyPartial).toBe(1);
    expect(summary.succeeded + summary.failed + summary.legacyPartial + summary.running).toBe(
      summary.total,
    );
  });

  it("excludes unfinished jobs from the refusal rate", () => {
    // Three finished (2 ok, 1 failed) plus two still moving. The rate must be
    // 1/3, not 1/5 — otherwise it drifts with how busy the pipeline is.
    const summary = summariseJobs([
      job({ status: "succeeded" }),
      job({ status: "succeeded" }),
      job({ status: "failed" }),
      job({ status: "running" }),
      job({ status: "queued" }),
    ]);

    expect(summary.running).toBe(2);
    expect(summary.refusalRate).toBeCloseTo(1 / 3);
  });

  it("reports no rate at all when nothing has finished", () => {
    // Not 0% — 0% is a claim that nothing fails, which is a different statement.
    const summary = summariseJobs([job({ status: "running" })]);
    expect(summary.refusalRate).toBeNull();
  });

  it("counts a cancelled job as a refusal", () => {
    const summary = summariseJobs([job({ status: "cancelled" }), job({ status: "succeeded" })]);
    expect(summary.failed).toBe(1);
    expect(summary.refusalRate).toBeCloseTo(0.5);
  });
});
