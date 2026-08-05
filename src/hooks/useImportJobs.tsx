import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { logError } from "@/services/errorLogger";
import { getErrorMessage } from "@/lib/utils";

export const IMPORTS_BUCKET = "imports";

/** Merchant export kinds the Airflow DAG knows how to parse. */
export const IMPORT_PLATFORMS = [
  {
    value: "meta",
    label: "Meta Ads",
    description: "Ads Manager export — campaign, impressions, clicks, spend.",
  },
  {
    value: "tiktok",
    label: "TikTok Ads",
    description: "TikTok Ads Manager campaign performance export.",
  },
  {
    value: "shopee_income",
    label: "Shopee Income",
    description: "Order-level revenue and platform fees. Feeds True Net Profit.",
  },
  {
    value: "shopee_ads",
    label: "Shopee Ads",
    description: "Shopee ad spend and conversions per campaign.",
  },
  {
    value: "cogs",
    label: "Product Costs (COGS)",
    description: "Your per-SKU cost sheet. Required for real margin.",
  },
  {
    value: "generic",
    label: "Other / Generic",
    description: "Any other tabular export. Columns are auto-detected.",
  },
] as const;

export type ImportPlatform = (typeof IMPORT_PLATFORMS)[number]["value"];

export type ImportJobStatus =
  | "pending"
  | "queued"
  | "running"
  | "partial"
  | "succeeded"
  | "failed"
  | "cancelled";

/** Statuses where the pipeline is still working — the list polls while any exist. */
export const ACTIVE_IMPORT_STATUSES: ImportJobStatus[] = ["pending", "queued", "running"];

/**
 * The Airflow tasks that report progress, in the order they run — the mirror of
 * `PROGRESS_STAGES` in `airflow/dags/buzzly_common/pipeline.py`, which
 * `airflow/tests/test_stage_contract.py` checks this file against. A stage
 * renamed on one side only would render as a blank step, so the ids must match
 * exactly; the labels are ours to write, and say what the merchant is waiting
 * for rather than what the task is called.
 */
export const IMPORT_STAGES = [
  { id: "resolve_job", label: "Picking up your file" },
  { id: "verify_artifact", label: "Checking the upload" },
  { id: "hash_dedupe", label: "Checking for a duplicate" },
  { id: "detect_format", label: "Working out the format" },
  { id: "parse", label: "Reading the rows" },
  { id: "clean_thai", label: "Cleaning Thai dates and amounts" },
  { id: "validate", label: "Checking every row" },
  { id: "quarantine_bad_rows", label: "Collecting rows we could not read" },
  { id: "upsert_target", label: "Saving to your dashboard" },
  { id: "finalize", label: "Finishing up" },
] as const;

export interface ImportStageProgress {
  step: number;
  total: number;
  label: string;
  percent: number;
}

/**
 * Where a job has got to, or null when the stage is unknown.
 *
 * Null is a real answer, not a failure: a job created before this column
 * existed has none, and the DAG's stage writer is deliberately best-effort, so
 * an unrecognised value means "we don't know" and the caller should say nothing
 * rather than guess a step number.
 */
export function importStageProgress(job: ImportJob): ImportStageProgress | null {
  const index = IMPORT_STAGES.findIndex((stage) => stage.id === job.current_stage);
  if (index < 0) return null;
  const total = IMPORT_STAGES.length;
  return {
    step: index + 1,
    total,
    label: IMPORT_STAGES[index].label,
    percent: Math.round(((index + 1) / total) * 100),
  };
}

export interface ImportJob {
  id: string;
  team_id: string;
  uploaded_by: string | null;
  platform: ImportPlatform;
  storage_path: string;
  original_filename: string;
  file_hash: string | null;
  file_size_bytes: number | null;
  status: ImportJobStatus;
  rows_total: number;
  rows_ok: number;
  rows_quarantined: number;
  error_report_path: string | null;
  error_message: string | null;
  dag_run_id: string | null;
  /** Pipeline stage, or the last one reached on a terminal job. See IMPORT_STAGES. */
  current_stage: string | null;
  stage_updated_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

/** One input row the pipeline refused, as written by the quarantine stage. */
export interface ImportRowError {
  id: string;
  import_job_id: string;
  /** 1-based line number in the merchant's own file. */
  row_number: number;
  raw_row: Record<string, unknown> | null;
  column_name: string | null;
  error_code: string;
  error_message: string | null;
}

/**
 * How many rejected rows the panel shows inline. The point on screen is to
 * recognise the *pattern* ("all my dates are the problem"), which a handful of
 * rows gives you; the downloadable CSV is what carries every row, and it is
 * always complete even when the table below is not.
 */
export const ROW_ERRORS_PREVIEW_LIMIT = 50;

export const MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024; // must match the bucket's file_size_limit
// Legacy `.xls` is deliberately absent: the pipeline reads xlsx and csv, and
// letting someone spend an upload on a file we will only refuse afterwards is
// worse than saying so in the picker. Shopee and Meta both export .xlsx today.
export const ACCEPTED_IMPORT_EXTENSIONS = [".csv", ".xlsx"] as const;

/**
 * Validates a file before it costs the user an upload. Returns null when fine.
 */
export function validateImportFile(file: File): string | null {
  const name = file.name.toLowerCase();
  const hasAcceptedExt = ACCEPTED_IMPORT_EXTENSIONS.some((ext) => name.endsWith(ext));
  if (!hasAcceptedExt) {
    return `Unsupported file type. Upload a ${ACCEPTED_IMPORT_EXTENSIONS.join(", ")} file.`;
  }
  if (file.size === 0) {
    return "That file is empty.";
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return `File is too large (${formatBytes(file.size)}). The limit is ${formatBytes(MAX_IMPORT_FILE_BYTES)}.`;
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** sha256 of the file, so the DAG can skip a byte-identical re-upload. */
async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Storage object keys travel through URLs, so keep them ASCII-safe.
 * The untouched name is preserved in `import_jobs.original_filename`.
 */
export function toStorageSafeName(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  const ext = lastDot > 0 ? filename.slice(lastDot).toLowerCase() : "";
  const stem = (lastDot > 0 ? filename.slice(0, lastDot) : filename)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${stem || "upload"}${ext}`;
}

export function useImportJobs() {
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const teamId = workspace.id;

  const jobsQuery = useQuery({
    queryKey: ["import_jobs", teamId],
    queryFn: async (): Promise<ImportJob[]> => {
      const { data, error } = await supabase
        .from("import_jobs")
        .select("*")
        .eq("team_id", teamId!)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      return (data ?? []) as ImportJob[];
    },
    enabled: !!teamId,
    // While Airflow is working the row changes underneath us, so poll — faster
    // once a run is actually executing, because that is when `current_stage`
    // moves and a progress bar that lags the work is worse than none. A job
    // still `pending` or `queued` has nothing to show yet.
    refetchInterval: (query) => {
      const jobs = query.state.data as ImportJob[] | undefined;
      if (jobs?.some((job) => job.status === "running")) return 3000;
      const isWaiting = jobs?.some((job) => ACTIVE_IMPORT_STATUSES.includes(job.status));
      return isWaiting ? 5000 : false;
    },
  });

  const createImportJob = useMutation({
    mutationFn: async ({ file, platform }: { file: File; platform: ImportPlatform }) => {
      if (!teamId) throw new Error("No workspace selected.");

      const validationError = validateImportFile(file);
      if (validationError) throw new Error(validationError);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("You are signed out. Sign in again to upload.");

      // The job id is minted here so the object lands in its final folder on the
      // first try: the file must exist before the row that points at it, or the
      // DAG could pick up a job whose object is still missing.
      const jobId = crypto.randomUUID();
      const storagePath = `${teamId}/${jobId}/${toStorageSafeName(file.name)}`;
      const fileHash = await hashFile(file);

      const { error: uploadError } = await supabase.storage
        .from(IMPORTS_BUCKET)
        .upload(storagePath, file, { contentType: file.type || "text/csv", upsert: false });
      if (uploadError) throw uploadError;

      const { data, error: insertError } = await supabase
        .from("import_jobs")
        .insert({
          id: jobId,
          team_id: teamId,
          uploaded_by: user.id,
          platform,
          storage_path: storagePath,
          original_filename: file.name,
          file_hash: fileHash,
          file_size_bytes: file.size,
        })
        .select()
        .single();

      if (insertError) {
        // Don't leave an orphaned object behind that no job will ever claim.
        await supabase.storage.from(IMPORTS_BUCKET).remove([storagePath]);
        throw insertError;
      }

      return data as ImportJob;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import_jobs", teamId] });
    },
    onError: (error) => {
      logError("Failed to create import job", error, { teamId });
    },
  });

  return {
    jobs: jobsQuery.data ?? [],
    isLoading: jobsQuery.isLoading,
    error: jobsQuery.error,
    teamId,
    createImportJob,
    uploadError: createImportJob.error ? getErrorMessage(createImportJob.error) : null,
  };
}

/**
 * The rejected rows of one import, newest reason first by line number.
 *
 * Fetched only when the merchant opens the panel: a `partial` job can hold
 * thousands of these, and nobody scrolling their import history is asking for
 * them. RLS scopes the read through the parent job's workspace, so no team
 * filter is needed (or possible) here.
 */
export function useImportRowErrors(jobId: string | null, enabled: boolean) {
  const query = useQuery({
    queryKey: ["import_row_errors", jobId],
    queryFn: async (): Promise<ImportRowError[]> => {
      const { data, error } = await supabase
        .from("import_row_errors")
        .select("id, import_job_id, row_number, raw_row, column_name, error_code, error_message")
        .eq("import_job_id", jobId!)
        .order("row_number", { ascending: true })
        .limit(ROW_ERRORS_PREVIEW_LIMIT);

      if (error) {
        logError("Failed to load import row errors", error, { jobId });
        throw error;
      }
      return (data ?? []) as ImportRowError[];
    },
    enabled: enabled && !!jobId,
    staleTime: 5 * 60 * 1000, // a finished job's rejected rows never change
  });

  return {
    rowErrors: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error ? getErrorMessage(query.error) : null,
  };
}

/**
 * Hand the merchant the error report for an import.
 *
 * The `imports` bucket is private — merchant financial data — so the file is
 * reached through a short-lived signed URL rather than a public path. The
 * `download` option is what makes the browser save it instead of rendering the
 * CSV as text, and it names the file the same thing the pipeline did.
 */
export function useErrorReportDownload() {
  return useMutation({
    mutationFn: async (job: ImportJob) => {
      if (!job.error_report_path) {
        throw new Error("This import has no error report.");
      }
      const filename = job.error_report_path.split("/").pop() || "import-errors.csv";
      const { data, error } = await supabase.storage
        .from(IMPORTS_BUCKET)
        .createSignedUrl(job.error_report_path, 60, { download: filename });

      if (error) throw error;
      if (!data?.signedUrl) throw new Error("Could not create a download link.");

      // An anchor rather than window.open: this runs after an await, and a
      // popup opened outside the click's own tick is what popup blockers stop.
      const link = document.createElement("a");
      link.href = data.signedUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      return data.signedUrl;
    },
    onError: (error, job) => {
      logError("Failed to download import error report", error, { jobId: job.id });
    },
  });
}
