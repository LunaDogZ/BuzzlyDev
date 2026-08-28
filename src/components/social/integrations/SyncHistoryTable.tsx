import { History, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SyncStatusBadge } from "./ConnectionStatusBadge";
import type { SyncHistoryEntry } from "@/hooks/useSyncHistory";
import { TH_DATE_LOCALE } from "@/lib/date";

interface SyncHistoryTableProps {
  entries: SyncHistoryEntry[];
  isLoading: boolean;
  className?: string;
}

const SYNC_TYPE_LABELS: Record<SyncHistoryEntry["sync_type"], string> = {
  manual: "Manual",
  scheduled: "Scheduled",
  webhook: "Webhook",
};

function formatDateTime(isoString: string): string {
  return new Date(isoString).toLocaleString(TH_DATE_LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "—";
  const diffMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const diffSecs = Math.round(diffMs / 1000);
  if (diffSecs < 60) return `${diffSecs}s`;
  const diffMins = Math.floor(diffSecs / 60);
  const secs = diffSecs % 60;
  return `${diffMins}m ${secs}s`;
}

function SyncHistoryTableSkeleton() {
  return (
    <div className="divide-y divide-border/30">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-4 w-16 ml-auto" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-12" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
        <History className="h-6 w-6 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">ยังไม่มีประวัติซิงค์</p>
        <p className="text-xs text-muted-foreground mt-1">
          เมื่อซิงค์ข้อมูลจากแพลตฟอร์ม ประวัติจะแสดงที่นี่
        </p>
      </div>
    </div>
  );
}

export function SyncHistoryTable({ entries, isLoading, className }: SyncHistoryTableProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/40 bg-white dark:bg-slate-900 shadow-sm overflow-hidden",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40 bg-slate-50/80 dark:bg-slate-800/50">
        <RefreshCw className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">ประวัติการซิงค์</h3>
        {entries.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">50 รายการล่าสุด</span>
        )}
      </div>

      {isLoading ? (
        <SyncHistoryTableSkeleton />
      ) : entries.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/30 text-left">
                <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground">แพลตฟอร์ม</th>
                <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground">สถานะ</th>
                <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground">ประเภท</th>
                <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-right">
                  แถวที่ซิงค์
                </th>
                <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground">เริ่มต้น</th>
                <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground">ใช้เวลา</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className="font-medium text-foreground capitalize">
                      {entry.platform_name}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      <SyncStatusBadge status={entry.status} />
                      {entry.error_message && (
                        <p className="text-xs text-red-500 max-w-[200px] truncate" title={entry.error_message}>
                          {entry.error_message}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {SYNC_TYPE_LABELS[entry.sync_type]}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {entry.rows_synced.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {formatDateTime(entry.started_at)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground tabular-nums">
                    {formatDuration(entry.started_at, entry.completed_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
