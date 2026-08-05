import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getErrorMessage } from "@/lib/utils";
import {
  ROW_ERRORS_PREVIEW_LIMIT,
  useErrorReportDownload,
  useImportRowErrors,
  type ImportJob,
  type ImportRowError,
} from "@/hooks/useImportJobs";

/**
 * What a merchant needs to see the value we choked on, not just the field name.
 * `raw_row` is keyed by canonical field, which is also what `column_name`
 * holds — so the offending cell is one lookup away, exactly as the downloadable
 * report echoes it back.
 */
function offendingValue(rowError: ImportRowError): string | null {
  if (!rowError.column_name || !rowError.raw_row) return null;
  const value = rowError.raw_row[rowError.column_name];
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

interface ImportJobErrorsProps {
  job: ImportJob;
}

/**
 * The rejected rows of one import, plus the report that holds all of them.
 *
 * Rendered only while the panel is open — mounting it is what triggers the
 * query, so a history list of finished imports costs nothing until someone
 * actually asks why rows were skipped.
 */
export function ImportJobErrors({ job }: ImportJobErrorsProps) {
  const { rowErrors, isLoading, error } = useImportRowErrors(job.id, true);
  const download = useErrorReportDownload();

  function handleDownload() {
    download.mutate(job, {
      onError: (downloadError) => {
        toast.error("Could not download the report", {
          description: getErrorMessage(downloadError),
        });
      },
    });
  }

  // The table is a preview; `rows_quarantined` is the truth about how many
  // there are. Saying "50" when a merchant has 400 bad rows would send them
  // away thinking they had fixed it.
  const hasMore = job.rows_quarantined > rowErrors.length;

  return (
    <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-bold uppercase tracking-widest text-amber-600 dark:text-amber-500">
          {job.rows_quarantined} rows we could not read
        </p>
        {job.error_report_path && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-lg text-xs font-bold"
            onClick={handleDownload}
            disabled={download.isPending}
          >
            {download.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Download full report (CSV)
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full rounded-lg" />
          ))}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {!isLoading && !error && rowErrors.length === 0 && (
        <p className="text-xs text-muted-foreground">
          The per-row detail for this import is no longer stored.
          {job.error_report_path
            ? " The downloadable report still has every rejected row."
            : ""}
        </p>
      )}

      {/* This panel sits in a half-width column, so no column may be given a
          fixed width: auto layout then hands the space to `Problem`, which is
          the only cell anyone actually reads. Forcing the table wider than its
          container and scrolling was worse — the reason was cut off mid-word
          with no sign there was more of it. */}
      {rowErrors.length > 0 && (
        <div className="max-h-96 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 w-10 text-xs">Row</TableHead>
                <TableHead className="h-8 text-xs">Column</TableHead>
                <TableHead className="h-8 text-xs">Value</TableHead>
                <TableHead className="h-8 text-xs">Problem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rowErrors.map((rowError) => {
                const value = offendingValue(rowError);
                return (
                  <TableRow key={rowError.id} className="hover:bg-transparent">
                    {/* The merchant's own line number — the row they can scroll to. */}
                    <TableCell className="py-1.5 text-xs font-bold tabular-nums">
                      {rowError.row_number}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-1.5 text-xs text-muted-foreground">
                      {rowError.column_name ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-[8rem] truncate py-1.5 font-mono text-xs">
                      {value ?? <span className="text-muted-foreground">(empty)</span>}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs">
                      {rowError.error_message ?? rowError.error_code}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {hasMore && rowErrors.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Showing the first {Math.min(rowErrors.length, ROW_ERRORS_PREVIEW_LIMIT)} of{" "}
          {job.rows_quarantined}
          {job.error_report_path ? " — the CSV has them all." : "."}
        </p>
      )}
    </div>
  );
}
