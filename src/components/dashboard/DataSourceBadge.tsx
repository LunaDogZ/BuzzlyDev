import { AlertTriangle, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AD_DATA_SOURCE_NOUN,
  isSimulated,
  type AdDataSource,
} from "@/constants/adDataSource";

interface DataSourceBadgeProps {
  /** The sources actually present in the rows on screen, from `useDashboardMetrics`. */
  sources: AdDataSource[];
  className?: string;
}

/**
 * Says whether the numbers next to it are real.
 *
 * This reads the `data_source` of the rows that were rendered. It replaces the
 * banner that keyed off `VITE_USE_MOCK_DATA`, which could not tell the truth:
 * that flag is fixed at build time and describes the bundle, not the database,
 * so a dashboard drawing 608 fixture rows showed no warning whenever the flag
 * happened to be false — which was its state in normal use.
 *
 * Three cases, and the mixed one is the reason this is not a boolean:
 * a view containing both real and simulated rows must not be presented as
 * either, because the totals above it are a sum of the two.
 */
export function DataSourceBadge({ sources, className }: DataSourceBadgeProps) {
  if (sources.length === 0) return null;

  const simulated = sources.filter(isSimulated);
  const real = sources.filter((s) => !isSimulated(s));

  if (simulated.length === 0) return null;

  const isMixed = real.length > 0;

  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium",
        isMixed
          ? "border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200"
          : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
        className
      )}
    >
      {isMixed ? (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <FlaskConical className="h-3.5 w-3.5 shrink-0" />
      )}
      <span>
        {isMixed ? (
          <>
            ตัวเลขนี้รวม{simulated.map((s) => AD_DATA_SOURCE_NOUN[s]).join(" และ ")}
            เข้ากับ{real.map((s) => AD_DATA_SOURCE_NOUN[s]).join(" และ ")} — ใช้ตัดสินใจไม่ได้
          </>
        ) : (
          <>ตัวเลขนี้เป็น{simulated.map((s) => AD_DATA_SOURCE_NOUN[s]).join(" และ ")} ไม่ใช่ข้อมูลจริง</>
        )}
      </span>
    </div>
  );
}
