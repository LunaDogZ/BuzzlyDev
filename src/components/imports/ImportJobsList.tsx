import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Clock,
  Ban,
  FileSpreadsheet,
  ArrowRight,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  IMPORT_PLATFORMS,
  formatBytes,
  type ImportJob,
  type ImportJobStatus,
} from "@/hooks/useImportJobs";

/**
 * `messageClassName` styles `error_message`, which despite the column name
 * carries the outcome of *every* terminal status — "Imported 97 of 100 rows",
 * "Nothing to ingest — identical to import X". Colouring it by status keeps a
 * successful import from announcing itself in red.
 */
const statusConfig: Record<
  ImportJobStatus,
  {
    label: string;
    icon: React.ElementType;
    className: string;
    messageClassName: string;
    spin?: boolean;
  }
> = {
  pending: {
    label: "Waiting",
    icon: Clock,
    className: "text-muted-foreground bg-muted",
    messageClassName: "text-muted-foreground",
  },
  queued: {
    label: "Queued",
    icon: Clock,
    className: "text-muted-foreground bg-muted",
    messageClassName: "text-muted-foreground",
  },
  running: {
    label: "Processing",
    icon: Loader2,
    className: "text-blue-500 bg-blue-500/10",
    messageClassName: "text-muted-foreground",
    spin: true,
  },
  partial: {
    label: "Partly imported",
    icon: AlertTriangle,
    className: "text-amber-500 bg-amber-500/10",
    messageClassName: "text-amber-600 dark:text-amber-500",
  },
  succeeded: {
    label: "Imported",
    icon: CheckCircle2,
    className: "text-emerald-500 bg-emerald-500/10",
    messageClassName: "text-muted-foreground",
  },
  failed: {
    label: "Failed",
    icon: XCircle,
    className: "text-destructive bg-destructive/10",
    messageClassName: "text-destructive",
  },
  cancelled: {
    label: "Cancelled",
    icon: Ban,
    className: "text-muted-foreground bg-muted",
    messageClassName: "text-muted-foreground",
  },
};

function platformLabel(value: string): string {
  return IMPORT_PLATFORMS.find((p) => p.value === value)?.label ?? value;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ImportJobsListProps {
  jobs: ImportJob[];
  isLoading: boolean;
}

export function ImportJobsList({ jobs, isLoading }: ImportJobsListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-10 text-center">
        <FileSpreadsheet className="h-7 w-7 text-muted-foreground" />
        <p className="font-bold">No imports yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Upload a Shopee, Meta or TikTok report and it will show up here while it is processed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {jobs.map((job) => {
        const status = statusConfig[job.status];
        const StatusIcon = status.icon;
        return (
          <div key={job.id} className="space-y-2 rounded-xl border p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <FileSpreadsheet className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{job.original_filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {platformLabel(job.platform)} · {formatWhen(job.created_at)}
                    {job.file_size_bytes ? ` · ${formatBytes(job.file_size_bytes)}` : ""}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-4">
                {job.rows_total > 0 && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-bold text-foreground">{job.rows_ok}</span> of{" "}
                    {job.rows_total} rows
                    {job.rows_quarantined > 0 && (
                      <span className="text-amber-500"> · {job.rows_quarantined} skipped</span>
                    )}
                  </p>
                )}
                <Badge
                  variant="secondary"
                  className={cn("gap-1.5 rounded-lg border-0 font-bold", status.className)}
                >
                  <StatusIcon className={cn("h-3.5 w-3.5", status.spin && "animate-spin")} />
                  {status.label}
                </Badge>
              </div>
            </div>

            {job.error_message && (
              <p className={cn("text-xs", status.messageClassName)}>{job.error_message}</p>
            )}

            {/* Only when rows actually landed: a job can be `succeeded` having
                ingested nothing (a duplicate, or a report we don't target yet),
                and sending the merchant to an unchanged dashboard would be a
                worse lie than saying nothing. The dashboard's own empty state
                explains the date range — this list has no idea what the file
                covered. */}
            {job.rows_ok > 0 && (job.status === "succeeded" || job.status === "partial") && (
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
              >
                View on dashboard
                <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
