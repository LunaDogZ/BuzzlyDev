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
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export const MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024; // must match the bucket's file_size_limit
export const ACCEPTED_IMPORT_EXTENSIONS = [".csv", ".xlsx", ".xls"] as const;

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
    // While Airflow is working the row changes underneath us, so poll.
    refetchInterval: (query) => {
      const jobs = query.state.data as ImportJob[] | undefined;
      const isWorking = jobs?.some((job) => ACTIVE_IMPORT_STATUSES.includes(job.status));
      return isWorking ? 5000 : false;
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
