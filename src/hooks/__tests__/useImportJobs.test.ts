import { describe, it, expect } from "vitest";
import {
  IMPORT_STAGES,
  MAX_IMPORT_FILE_BYTES,
  formatBytes,
  importStageProgress,
  toStorageSafeName,
  validateImportFile,
  type ImportJob,
} from "@/hooks/useImportJobs";

function fakeFile(name: string, size: number): File {
  const file = new File(["x"], name, { type: "text/csv" });
  // File.size is read-only, and we don't want to allocate 50 MB in a test.
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("validateImportFile", () => {
  it("accepts the extensions merchants actually export", () => {
    expect(validateImportFile(fakeFile("income.csv", 1024))).toBeNull();
    expect(validateImportFile(fakeFile("Ads Export.XLSX", 1024))).toBeNull();
  });

  it("rejects other file types", () => {
    expect(validateImportFile(fakeFile("report.pdf", 1024))).toMatch(/Unsupported file type/);
    // Legacy .xls needs a reader the pipeline does not have, so it is refused
    // here rather than after the merchant has spent an upload on it.
    expect(validateImportFile(fakeFile("legacy.xls", 1024))).toMatch(/Unsupported file type/);
    expect(validateImportFile(fakeFile("screenshot.png", 1024))).toMatch(/Unsupported file type/);
  });

  it("rejects an empty file", () => {
    expect(validateImportFile(fakeFile("empty.csv", 0))).toMatch(/empty/i);
  });

  it("rejects a file over the bucket limit", () => {
    expect(validateImportFile(fakeFile("huge.csv", MAX_IMPORT_FILE_BYTES + 1))).toMatch(
      /too large/i
    );
    expect(validateImportFile(fakeFile("at-limit.csv", MAX_IMPORT_FILE_BYTES))).toBeNull();
  });
});

describe("toStorageSafeName", () => {
  it("keeps an already-safe name intact", () => {
    expect(toStorageSafeName("ads-export-clean.csv")).toBe("ads-export-clean.csv");
  });

  it("replaces spaces and punctuation that would break an object key", () => {
    expect(toStorageSafeName("Shopee Income (July 2026).xlsx")).toBe(
      "Shopee-Income-July-2026.xlsx"
    );
  });

  it("falls back to a usable stem for an all-Thai filename", () => {
    // Thai merchants export files named entirely in Thai; the original name is
    // still preserved in import_jobs.original_filename.
    expect(toStorageSafeName("รายงานรายได้.csv")).toBe("upload.csv");
  });

  it("lowercases the extension and keeps only the last one", () => {
    expect(toStorageSafeName("report.backup.CSV")).toBe("report.backup.csv");
  });

  it("truncates an absurdly long name", () => {
    const long = `${"a".repeat(300)}.csv`;
    const safe = toStorageSafeName(long);
    expect(safe.endsWith(".csv")).toBe(true);
    expect(safe.length).toBeLessThanOrEqual(84);
  });
});

describe("formatBytes", () => {
  it("scales the unit to the size", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(23273)).toBe("22.7 KB");
    expect(formatBytes(MAX_IMPORT_FILE_BYTES)).toBe("50.0 MB");
  });
});

describe("importStageProgress", () => {
  const at = (stage: string | null) => importStageProgress({ current_stage: stage } as ImportJob);

  it("places a stage in the run", () => {
    expect(at("resolve_job")).toMatchObject({ step: 1, label: "Picking up your file" });
    expect(at("finalize")).toMatchObject({ step: IMPORT_STAGES.length, percent: 100 });
  });

  it("reports the DAG's own order, not an alphabetical one", () => {
    // The bar is only meaningful if step N really does come after step N-1 in
    // the pipeline; `airflow/tests/test_stage_contract.py` checks these ids
    // against buzzly_common.pipeline.PROGRESS_STAGES.
    expect(at("parse")!.step).toBeLessThan(at("validate")!.step);
    expect(at("validate")!.step).toBeLessThan(at("upsert_target")!.step);
  });

  it("returns null for a stage it does not know", () => {
    // A job from before the column existed, or a stage renamed in the DAG.
    // Null means "we don't know" — the UI stays quiet rather than guessing.
    expect(at(null)).toBeNull();
    expect(at("some_stage_we_never_shipped")).toBeNull();
  });
});
