import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/services/errorLogger";
import { IMPORT_STAGES, type ImportJobStatus } from "@/hooks/useImportJobs";

/**
 * The engineering view of file ingestion — every refusal the pipeline recorded,
 * across every workspace.
 *
 * This is deliberately not the merchant's view. `/imports` answers "what
 * happened to my file"; this answers "where does the pipeline refuse files, and
 * why", which is a question about the pipeline rather than about one upload.
 * The two disagree on purpose in one place: a `DUPLICATE_BATCH` is a *success*
 * to the merchant (their data is already in) and still lands here, because a
 * file that went in and produced no rows is worth counting.
 *
 * Readable only by `dev`/`owner` employees — see
 * `supabase/migrations/20260810110000_ingestion_dlq_employee_read.sql`. The RLS
 * policy is only half of the access decision; the other half is that
 * `error_message` and `detail` stay hidden in the UI until someone explicitly
 * asks for them, because both can quote a merchant's own revenue figures.
 */

/**
 * The seven codes, mirroring the CHECK constraint in
 * `20260805150000_ingestion_dlq_and_atomic_promote.sql` and `dlq.py`.
 *
 * `reachable` records what the KPI corpus established: only four of the seven
 * can be produced by the *contents* of a file. It is shown in the UI because a
 * dev staring at a zero next to `ENCODING_ERROR` should learn that the zero is
 * structural, not luck — and a *non*-zero next to `UNKNOWN` is a defect report
 * about our own classifier rather than about anyone's data.
 */
export const DLQ_ERROR_CODES = [
  {
    code: "SCHEMA_MISMATCH",
    label: "Schema mismatch",
    meaning: "Headers did not map to a dataset we can store.",
    reachable: true,
  },
  {
    code: "TYPE_COERCION_FAILED",
    label: "Type coercion failed",
    meaning: "A cell could not be turned into its type — a date, a number.",
    reachable: true,
  },
  {
    code: "ENCODING_ERROR",
    label: "Encoding error",
    meaning:
      "Unreachable: the encoding ladder ends in latin-1, which decodes any byte sequence.",
    reachable: false,
  },
  {
    code: "EMPTY_PAYLOAD",
    label: "Empty payload",
    meaning: "Nothing to ingest: zero bytes, or zero data rows.",
    reachable: true,
  },
  {
    code: "DUPLICATE_BATCH",
    label: "Duplicate batch",
    meaning: "These exact bytes were already imported. A success, recorded here anyway.",
    reachable: true,
  },
  {
    code: "ROW_VALIDATION_FAILED",
    label: "Row validation failed",
    meaning: "Rows read cleanly, then broke the validation rules.",
    reachable: true,
  },
  {
    code: "UNKNOWN",
    label: "Unknown",
    meaning:
      "Only written when the commit itself threw. A non-zero count here is a defect in our classifier.",
    reachable: false,
  },
] as const;

export type DlqErrorCode = (typeof DLQ_ERROR_CODES)[number]["code"];

export interface DlqRecord {
  id: string;
  import_job_id: string | null;
  team_id: string | null;
  batch_id: string | null;
  original_filename: string | null;
  file_hash: string | null;
  platform: string | null;
  error_code: DlqErrorCode;
  /** May quote merchant values — gated behind the reveal in the UI. */
  error_message: string | null;
  stage: string | null;
  rows_attempted: number;
  rows_rejected: number;
  /** May quote merchant values — gated behind the reveal in the UI. */
  detail: unknown;
  dag_run_id: string | null;
  occurred_at: string;
}

export interface DevImportJob {
  id: string;
  team_id: string;
  platform: string;
  original_filename: string;
  status: ImportJobStatus;
  current_stage: string | null;
  rows_total: number;
  rows_ok: number;
  rows_quarantined: number;
  created_at: string;
}

/** How many refusals landed under each code, in the canonical code order. */
export function countByErrorCode(records: DlqRecord[]): { code: DlqErrorCode; count: number }[] {
  return DLQ_ERROR_CODES.map(({ code }) => ({
    code,
    count: records.filter((record) => record.error_code === code).length,
  }));
}

/**
 * Where in the pipeline files are being refused, ordered by the stage order the
 * DAG actually runs — not by frequency, because the shape of the distribution
 * across the run order is the thing worth seeing.
 *
 * A record whose `stage` matches no known stage is kept under its own raw name
 * rather than dropped: an unrecognised stage means the Python and the UI have
 * drifted, and silently discarding it would hide exactly that.
 */
export function countByStage(records: DlqRecord[]): { stage: string; label: string; count: number }[] {
  const known = IMPORT_STAGES.map(({ id, label }) => ({
    stage: id as string,
    label,
    count: records.filter((record) => record.stage === id).length,
  }));

  const knownIds = new Set<string>(IMPORT_STAGES.map((stage) => stage.id as string));
  const unknown = new Map<string, number>();
  for (const record of records) {
    const stage = record.stage;
    if (stage && !knownIds.has(stage)) {
      unknown.set(stage, (unknown.get(stage) ?? 0) + 1);
    }
  }

  return [
    ...known,
    ...[...unknown.entries()].map(([stage, count]) => ({
      stage,
      label: `${stage} (unrecognised stage)`,
      count,
    })),
  ];
}

/** Every refusal the pipeline has recorded, newest first. */
export function useDevDlq(limit = 200) {
  const query = useQuery({
    queryKey: ["dev_ingestion_dlq", limit],
    queryFn: async (): Promise<DlqRecord[]> => {
      const { data, error } = await supabase
        .from("ingestion_dlq")
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(limit);

      if (error) {
        logError("Failed to load the ingestion dead-letter queue", error, { limit });
        throw error;
      }
      return (data ?? []) as unknown as DlqRecord[];
    },
    staleTime: 30 * 1000,
  });

  return {
    records: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Recent import jobs across every workspace.
 *
 * The denominator to the DLQ's numerator: refusals alone cannot say whether ten
 * failures out of twelve uploads or out of ten thousand.
 */
export function useDevImportJobs(limit = 200) {
  const query = useQuery({
    queryKey: ["dev_import_jobs", limit],
    queryFn: async (): Promise<DevImportJob[]> => {
      const { data, error } = await supabase
        .from("import_jobs")
        .select(
          "id, team_id, platform, original_filename, status, current_stage, rows_total, rows_ok, rows_quarantined, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        logError("Failed to load import jobs for the dev view", error, { limit });
        throw error;
      }
      return (data ?? []) as DevImportJob[];
    },
    staleTime: 30 * 1000,
  });

  return {
    jobs: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

export interface ImportJobSummary {
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  /**
   * Jobs that predate all-or-nothing. `terminal_status()` cannot produce
   * `partial` any more, but rows written before that change still say it, and
   * they are counted here rather than folded into either side — calling a
   * historical partial a success or a failure would misreport what the pipeline
   * did at the time.
   */
  legacyPartial: number;
  /**
   * Refusal rate over *finished* jobs only. A job still running has not failed
   * yet, and counting it as a success would make the rate drift with how busy
   * the pipeline happens to be at the moment someone opens the page.
   */
  refusalRate: number | null;
}

export function summariseJobs(jobs: DevImportJob[]): ImportJobSummary {
  const succeeded = jobs.filter((job) => job.status === "succeeded").length;
  const failed = jobs.filter((job) => job.status === "failed" || job.status === "cancelled").length;
  const running = jobs.filter(
    (job) => job.status === "pending" || job.status === "queued" || job.status === "running",
  ).length;
  const legacyPartial = jobs.filter((job) => job.status === "partial").length;
  const finished = succeeded + failed + legacyPartial;

  return {
    total: jobs.length,
    succeeded,
    failed,
    running,
    legacyPartial,
    refusalRate: finished === 0 ? null : failed / finished,
  };
}
