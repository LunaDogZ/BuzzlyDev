import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Eye, EyeOff, FileWarning, RefreshCw, ShieldAlert } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { logAuditEvent } from "@/lib/auditLogger";
import {
  DLQ_ERROR_CODES,
  countByErrorCode,
  countByStage,
  summariseJobs,
  useDevDlq,
  useDevImportJobs,
  type DlqRecord,
} from "@/hooks/useDevImports";

const ALL_CODES = "all";

/**
 * Where file ingestion refuses merchant uploads, and why.
 *
 * The privacy gate is the part worth reading. `error_message` and `detail` can
 * quote the offending cells, and those cells are a merchant's orders and
 * revenue — so this page shows the diagnosis (code, stage, counts, filename,
 * timestamp) freely, and keeps the quoted values behind a per-record reveal
 * that writes an audit entry naming whoever looked. See the migration comment
 * in `20260810110000_ingestion_dlq_employee_read.sql`; the RLS policy and this
 * gate are two halves of one decision.
 */
export default function ImportPipeline() {
  const { toast } = useToast();
  const { records, isLoading, error, refetch } = useDevDlq();
  const { jobs, isLoading: jobsLoading } = useDevImportJobs();

  const [codeFilter, setCodeFilter] = useState<string>(ALL_CODES);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const filtered = useMemo(
    () => (codeFilter === ALL_CODES ? records : records.filter((r) => r.error_code === codeFilter)),
    [records, codeFilter],
  );

  const byCode = useMemo(() => countByErrorCode(records), [records]);
  const byStage = useMemo(() => countByStage(records), [records]);
  const summary = useMemo(() => summariseJobs(jobs), [jobs]);

  const unknownCount = byCode.find((entry) => entry.code === "UNKNOWN")?.count ?? 0;

  /**
   * Reveal is one-way and per-record, and the audit entry is written before the
   * values appear. Logging afterwards would leave a window in which the data is
   * on screen with no record that anyone asked for it.
   */
  const reveal = async (record: DlqRecord) => {
    await logAuditEvent({
      actionName: "Reveal ingestion failure detail",
      category: "security",
      description: `Viewed the quoted failure detail for ${record.original_filename ?? "an unnamed file"} (${record.error_code})`,
      metadata: {
        dlq_id: record.id,
        import_job_id: record.import_job_id,
        team_id: record.team_id,
        error_code: record.error_code,
      },
    });

    setRevealed((current) => new Set(current).add(record.id));
    toast({
      title: "Detail revealed",
      description: "This view was recorded in the audit log.",
    });
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Import pipeline</h1>
          <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
            Every file the ingestion pipeline refused, across all workspaces — which stage
            stopped it and under which error code. Merchants see their own imports on{" "}
            <code className="text-xs">/imports</code>; this is the engineering view.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardHeader className="flex flex-row items-center gap-3">
            <AlertTriangle className="text-destructive h-5 w-5" />
            <div>
              <CardTitle className="text-base">Could not load the dead-letter queue</CardTitle>
              <CardDescription>
                If this reads as a permissions error, the employee read policy has not been
                applied to this environment yet.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      )}

      {/* Denominator first: refusals mean nothing without the volume they came from. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile label="Imports (recent)" value={jobsLoading ? "—" : String(summary.total)} />
        <SummaryTile label="Succeeded" value={jobsLoading ? "—" : String(summary.succeeded)} />
        <SummaryTile label="Failed" value={jobsLoading ? "—" : String(summary.failed)} />
        <SummaryTile
          label="Refusal rate"
          value={
            jobsLoading || summary.refusalRate === null
              ? "—"
              : `${(summary.refusalRate * 100).toFixed(1)}%`
          }
          hint="Of finished jobs only"
        />
        {/*
          Every job has to be accounted for on screen. Showing 10 imports as 6
          succeeded and 2 failed leaves two of them nowhere, and a reader who
          cannot make the tiles add up is right not to trust any of them. These
          two categories are rendered only when they are non-zero, so the row
          stays four tiles wide in the ordinary case.
        */}
        {!jobsLoading && summary.running > 0 && (
          <SummaryTile label="Still running" value={String(summary.running)} hint="Not yet counted in the rate" />
        )}
        {!jobsLoading && summary.legacyPartial > 0 && (
          <SummaryTile
            label="Legacy partial"
            value={String(summary.legacyPartial)}
            hint="Imported before all-or-nothing"
          />
        )}
      </div>

      {unknownCount > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="flex flex-row items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-500" />
            <div>
              <CardTitle className="text-base">
                {unknownCount} refusal{unknownCount === 1 ? "" : "s"} classified as UNKNOWN
              </CardTitle>
              <CardDescription>
                UNKNOWN is only written when the commit itself threw. A non-zero count is a
                defect report about our classifier, not about anyone's data.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Refusals by error code</CardTitle>
            <CardDescription>
              Two of the seven codes cannot be produced by a file's contents. They are listed
              so a zero reads as structural rather than as luck.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {byCode.map(({ code, count }) => {
              const meta = DLQ_ERROR_CODES.find((entry) => entry.code === code)!;
              return (
                <div key={code} className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{meta.label}</span>
                      {!meta.reachable && (
                        <Badge variant="outline" className="text-[10px] uppercase">
                          unreachable from a file
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs">{meta.meaning}</p>
                  </div>
                  <span className="shrink-0 text-lg font-semibold tabular-nums">{count}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Where files stop</CardTitle>
            <CardDescription>
              In the order the DAG runs its stages, not by frequency — the shape across the run
              order is the point.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {byStage.map(({ stage, label, count }) => (
              <div key={stage} className="flex items-center justify-between gap-4">
                <span className="text-sm">{label}</span>
                <span
                  className={`text-sm font-semibold tabular-nums ${count > 0 ? "" : "text-muted-foreground"}`}
                >
                  {count}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base">Refused files</CardTitle>
            <CardDescription>
              Newest first. The quoted failure detail is hidden until asked for, and asking is
              recorded.
            </CardDescription>
          </div>
          <Select value={codeFilter} onValueChange={setCodeFilter}>
            <SelectTrigger className="w-[240px]">
              <SelectValue placeholder="All error codes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CODES}>All error codes</SelectItem>
              {DLQ_ERROR_CODES.map(({ code, label }) => (
                <SelectItem key={code} value={code}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground py-8 text-center text-sm">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center">
              <FileWarning className="text-muted-foreground mx-auto h-8 w-8" />
              <p className="mt-3 text-sm font-medium">
                {records.length === 0
                  ? "No file has been refused yet"
                  : "No refusals under this error code"}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {records.length === 0
                  ? "An empty dead-letter queue means every upload so far was ingested or was a duplicate."
                  : "Clear the filter to see the rest."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((record) => (
                <RefusalRow
                  key={record.id}
                  record={record}
                  isRevealed={revealed.has(record.id)}
                  onReveal={() => reveal(record)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function RefusalRow({
  record,
  isRevealed,
  onReveal,
}: {
  record: DlqRecord;
  isRevealed: boolean;
  onReveal: () => void;
}) {
  const meta = DLQ_ERROR_CODES.find((entry) => entry.code === record.error_code);

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">
              {record.original_filename ?? "(filename not recorded)"}
            </span>
            <Badge variant="secondary" className="text-[10px]">
              {meta?.label ?? record.error_code}
            </Badge>
            {record.platform && (
              <Badge variant="outline" className="text-[10px]">
                {record.platform}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            {record.stage ? `Stopped at ${record.stage}` : "Stage not recorded"} ·{" "}
            {record.rows_rejected} of {record.rows_attempted} rows rejected ·{" "}
            {format(new Date(record.occurred_at), "d MMM yyyy HH:mm")}
          </p>
        </div>

        {isRevealed ? (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Eye className="h-3 w-3" /> revealed
          </Badge>
        ) : (
          <Button variant="outline" size="sm" onClick={onReveal}>
            <EyeOff className="mr-2 h-4 w-4" />
            Reveal detail
          </Button>
        )}
      </div>

      {isRevealed && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <div>
            <p className="text-muted-foreground text-xs font-medium uppercase">Message</p>
            <p className="mt-0.5 text-sm">{record.error_message ?? "(none recorded)"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs font-medium uppercase">Detail</p>
            <pre className="bg-muted mt-1 max-h-64 overflow-auto rounded p-3 text-xs">
              {record.detail ? JSON.stringify(record.detail, null, 2) : "(none recorded)"}
            </pre>
          </div>
          {record.dag_run_id && (
            <p className="text-muted-foreground text-xs">DAG run: {record.dag_run_id}</p>
          )}
        </div>
      )}
    </div>
  );
}
