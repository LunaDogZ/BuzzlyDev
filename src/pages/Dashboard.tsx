import React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw,
  Eye,
  Target,
  Wallet,
  TrendingUp,
  BarChart3,
  Zap,
  MousePointer2,
  DollarSign,
  TrendingDown,
  ShoppingCart,
  Users,
  Minus,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useQueryClient } from "@tanstack/react-query";
import { usePlatformConnections } from "@/hooks/usePlatformConnections";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import {
  useAdDataRange,
  formatAdDataRange,
  toCustomRangeValue,
  type AdDataRange,
} from "@/hooks/useAdDataRange";
import {
  AD_DATA_SOURCE_OPTIONS,
  AD_DATA_SOURCE_NOUN,
  type AdDataSourceFilter,
} from "@/constants/adDataSource";
import { DataSourceBadge } from "@/components/dashboard/DataSourceBadge";
import { useRevenueMetrics } from "@/hooks/useRevenueMetrics";
import { useOnboardingGuard } from "@/hooks/useOnboardingGuard";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";
import { OnboardingBanner } from "@/components/dashboard/OnboardingBanner";
import { cn } from "@/lib/utils";

const formatValue = (value: number, format: string) => {
  switch (format) {
    case "number":
      if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
      if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
      return value.toLocaleString();
    case "percent":
      return `${value.toFixed(1)}%`;
    case "currency":
      return `฿${value.toLocaleString()}`;
    case "multiplier":
      return `${value.toFixed(1)}x`;
    default:
      return value.toString();
  }
};

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { connectedPlatforms } = usePlatformConnections();
  const { state: onboardingState } = useOnboardingGuard();
  // 30d suits a live platform connection, but an uploaded merchant export is
  // historical — so when this window comes back empty we ask useAdDataRange
  // what the workspace actually covers instead of claiming there is no data.
  const [dateRange, setDateRange] = React.useState("30d");
  const [selectedPlatform, setSelectedPlatform] = React.useState<string>("all");
  // Which origin the numbers on this page are counting. Defaults to everything,
  // so the page a merchant already knows is unchanged until they ask to split it.
  const [dataSource, setDataSource] = React.useState<AdDataSourceFilter>("all");
  const [isRefreshing, setIsRefreshing] = React.useState(false);

  const { data: metrics, isLoading, refetch } = useDashboardMetrics(
    dateRange,
    selectedPlatform,
    dataSource
  );
  const { data: dataRange, isLoading: isRangeLoading } = useAdDataRange(
    selectedPlatform,
    dataSource
  );
  const dataRangeValue = dataRange ? toCustomRangeValue(dataRange) : null;

  const { revenueMetrics, isFromAdInsights } = useRevenueMetrics(
    metrics
      ? {
          totalSpend: metrics.totalSpend,
          avgRoas: metrics.avgRoas,
          totalConversions: metrics.totalConversions,
        }
      : undefined
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: ["revenue-metrics-dashboard"] }),
    ]);
    setIsRefreshing(false);
  };

  if (onboardingState === "loading") {
    return (
      <div className="flex items-center justify-center min-h-[70vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (onboardingState !== "ready") {
    return <OnboardingBanner state={onboardingState} />;
  }

  const hasData = metrics && (metrics.totalImpressions > 0 || metrics.totalClicks > 0);

  // Derived stats from trend data
  const trendData = metrics?.trendData ?? [];
  const avgDailyImpressions = trendData.length > 0
    ? Math.round(trendData.reduce((s, d) => s + d.impressions, 0) / trendData.length)
    : 0;
  const avgDailyClicks = trendData.length > 0
    ? Math.round(trendData.reduce((s, d) => s + d.clicks, 0) / trendData.length)
    : 0;
  const peakDay = trendData.length > 0
    ? trendData.reduce((best, d) => (d.impressions > (best?.impressions ?? 0) ? d : best), trendData[0])
    : null;
  const costPerConversion = metrics && metrics.totalConversions > 0
    ? metrics.totalSpend / metrics.totalConversions
    : 0;

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 animate-in fade-in duration-500">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {selectedPlatform === "all"
              ? `${connectedPlatforms.length} platforms connected`
              : connectedPlatforms.find((p) => p.id === selectedPlatform)?.name ?? "Platform"}
          </p>
          {/* Beside the numbers it describes, not pinned to the top of the app:
              it reports what these rows are, and it has nothing to say about
              any other page. */}
          <DataSourceBadge sources={metrics?.sourcesPresent ?? []} className="mt-2 w-fit" />
        </div>
        <div className="flex items-center gap-2">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[130px] h-9 border-border/60 bg-background rounded-lg text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="7d">7 days</SelectItem>
              <SelectItem value="30d">30 days</SelectItem>
              <SelectItem value="90d">90 days</SelectItem>
              <SelectItem value="1y">1 year</SelectItem>
              <SelectItem value="all">All time</SelectItem>
              {/* Without this the jump button would set a `custom:` value that
                  matches no item, and the trigger would render blank. */}
              {dataRange && dataRangeValue && (
                <SelectItem value={dataRangeValue}>{formatAdDataRange(dataRange)}</SelectItem>
              )}
            </SelectContent>
          </Select>
          <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
            <SelectTrigger className="w-[130px] h-9 border-border/60 bg-background rounded-lg text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All platforms</SelectItem>
              {connectedPlatforms.map((platform) => (
                <SelectItem key={platform.id} value={platform.id}>
                  {platform.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={dataSource}
            onValueChange={(value) => setDataSource(value as AdDataSourceFilter)}
          >
            <SelectTrigger className="w-[150px] h-9 border-border/60 bg-background rounded-lg text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AD_DATA_SOURCE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg shrink-0"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
          </Button>
        </div>
      </header>

      {isLoading ? (
        <LoadingSkeleton />
      ) : !hasData ? (
        <NoDataState
          dataRange={dataRange ?? null}
          isRangeLoading={isRangeLoading}
          isRangeSelected={!!dataRangeValue && dateRange === dataRangeValue}
          dataSource={dataSource}
          onJumpToData={() => dataRangeValue && setDateRange(dataRangeValue)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-6 lg:grid-cols-12 gap-3">
          {/* Bento Grid — Row 1: Hero metrics */}
          <BentoCard className="md:col-span-2 lg:col-span-4" size="large">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Impressions</p>
                <p className="text-2xl font-semibold tracking-tight mt-0.5 text-foreground">
                  {formatValue(metrics.totalImpressions, "number")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Total reach</p>
              </div>
              <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                <Eye className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
          </BentoCard>

          <BentoCard className="md:col-span-2 lg:col-span-4" size="large">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Clicks</p>
                <p className="text-2xl font-semibold tracking-tight mt-0.5 text-foreground">
                  {formatValue(metrics.totalClicks, "number")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Engagement</p>
              </div>
              <div className="h-10 w-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                <MousePointer2 className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              </div>
            </div>
          </BentoCard>

          <BentoCard className="md:col-span-2 lg:col-span-4" size="large">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Conversions</p>
                <p className="text-2xl font-semibold tracking-tight mt-0.5 text-foreground">
                  {formatValue(metrics.totalConversions, "number")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">CTR {formatValue(metrics.avgCtr, "percent")}</p>
              </div>
              <div className="h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                <Target className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
          </BentoCard>

          {/* Row 2: Trend chart — full width */}
          <BentoCard className="md:col-span-6 lg:col-span-8" size="xlarge">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Performance trend</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Impressions & clicks over time</p>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <LegendDot color="#3b82f6" label="Impressions" />
                  <LegendDot color="#8b5cf6" label="Clicks" />
                  <span className="text-xs text-muted-foreground border-l border-border/60 pl-4">
                    Avg: {formatValue(avgDailyImpressions, "number")} imp · {formatValue(avgDailyClicks, "number")} clk/day
                  </span>
                </div>
              </div>
              <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={metrics.trendData}>
                    <defs>
                      <linearGradient id="colorImp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorClicks" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.6} />
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(val) =>
                        new Date(val).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                      }
                    />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: "8px",
                        border: "1px solid hsl(var(--border))",
                        backgroundColor: "hsl(var(--card))",
                        fontSize: "12px",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="impressions"
                      stroke="#3b82f6"
                      strokeWidth={2.5}
                      fill="url(#colorImp)"
                    />
                    <Area
                      type="monotone"
                      dataKey="clicks"
                      stroke="#8b5cf6"
                      strokeWidth={2.5}
                      fill="url(#colorClicks)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </BentoCard>

          {/* Row 2: ROAS & Spend — sidebar */}
          <BentoCard className="md:col-span-6 lg:col-span-4" size="tall">
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">ROAS</p>
                <p className="text-2xl font-semibold tracking-tight mt-0.5 text-foreground">
                  {formatValue(metrics.avgRoas, "multiplier")}
                </p>
              </div>
              <div className="pt-3 border-t border-border/60">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Ad spend</p>
                <p className="text-xl font-semibold tracking-tight mt-0.5 text-foreground">
                  {formatValue(metrics.totalSpend, "currency")}
                </p>
              </div>
              <div className="pt-3 border-t border-border/60">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cost / conversion</p>
                <p className="text-lg font-medium text-foreground mt-0.5">{formatValue(costPerConversion, "currency")}</p>
              </div>
              <div className="pt-3 border-t border-border/60 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Coverage</span>
                <span className="text-sm font-medium text-foreground">{metrics.trendData.length} days</span>
              </div>
              {peakDay && (
                <div className="pt-3 border-t border-border/60">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Peak day</p>
                  <p className="text-sm font-medium text-foreground mt-0.5">
                    {new Date(peakDay.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {formatValue(peakDay.impressions, "number")} imp
                  </p>
                </div>
              )}
            </div>
          </BentoCard>

          {/* Row 3: Granular KPIs */}
          <BentoCard className="md:col-span-3 lg:col-span-3" size="small">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
                <Zap className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg. CPC</p>
                <p className="text-base font-semibold text-foreground">{formatValue(metrics.avgCpc, "currency")}</p>
              </div>
            </div>
          </BentoCard>
          <BentoCard className="md:col-span-3 lg:col-span-3" size="small">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
                <BarChart3 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg. CPM</p>
                <p className="text-base font-semibold text-foreground">{formatValue(metrics.avgCpm, "currency")}</p>
              </div>
            </div>
          </BentoCard>
          <BentoCard className="md:col-span-3 lg:col-span-3" size="small">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                <Target className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">CTR</p>
                <p className="text-base font-semibold text-foreground">{formatValue(metrics.avgCtr, "percent")}</p>
              </div>
            </div>
          </BentoCard>
          <BentoCard className="md:col-span-3 lg:col-span-3" size="small">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center shrink-0">
                <DollarSign className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total spend</p>
                <p className="text-base font-semibold text-foreground">{formatValue(metrics.totalSpend, "currency")}</p>
              </div>
            </div>
          </BentoCard>

          {/* Row 4: Revenue — full width */}
          <BentoCard className="md:col-span-6 lg:col-span-12" size="wide">
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-foreground">Revenue overview</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {revenueMetrics
                    ? isFromAdInsights
                      ? `Estimated from ad performance · ${revenueMetrics.metric_date}`
                      : `From revenue_metrics · ${revenueMetrics.metric_date}`
                    : "Connect platforms or revenue data to see metrics"}
                </p>
              </div>
              {revenueMetrics ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <RevenueItem
                    label="Gross"
                    value={`฿${Number(revenueMetrics.gross_revenue).toLocaleString()}`}
                    icon={DollarSign}
                    variant="amber"
                  />
                  <RevenueItem
                    label="Net"
                    value={`฿${Number(revenueMetrics.net_revenue).toLocaleString()}`}
                    icon={Wallet}
                    variant="indigo"
                  />
                  <RevenueItem
                    label="Margin"
                    value={`${Number(revenueMetrics.profit_margin).toFixed(1)}%`}
                    icon={revenueMetrics.profit_margin > 0 ? TrendingUp : TrendingDown}
                    positive={revenueMetrics.profit_margin > 0}
                  />
                  <RevenueItem
                    label="Growth"
                    value={
                      revenueMetrics.revenue_growth_percent != null
                        ? `${revenueMetrics.revenue_growth_percent > 0 ? "+" : ""}${revenueMetrics.revenue_growth_percent.toFixed(1)}%`
                        : "—"
                    }
                    icon={
                      revenueMetrics.revenue_growth_percent != null
                        ? revenueMetrics.revenue_growth_percent > 0
                          ? TrendingUp
                          : revenueMetrics.revenue_growth_percent < 0
                            ? TrendingDown
                            : Minus
                        : Minus
                    }
                    positive={
                      revenueMetrics.revenue_growth_percent != null
                        ? revenueMetrics.revenue_growth_percent > 0
                          ? true
                          : revenueMetrics.revenue_growth_percent < 0
                            ? false
                            : undefined
                        : undefined
                    }
                    variant="sky"
                  />
                  <RevenueItem
                    label="Orders"
                    value={revenueMetrics.total_orders.toLocaleString()}
                    icon={ShoppingCart}
                    variant="blue"
                  />
                  <RevenueItem
                    label="New customers"
                    value={revenueMetrics.new_customers.toLocaleString()}
                    icon={Users}
                    variant="violet"
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-4">
                  ไม่มีข้อมูลรายได้ — เชื่อมต่อแพลตฟอร์มโฆษณาหรือเพิ่มข้อมูลใน revenue_metrics
                </p>
              )}
            </div>
          </BentoCard>
        </div>
      )}
    </div>
  );
}

// ─── Bento Card ─────────────────────────────────────────────────────────────
interface BentoCardProps {
  children: React.ReactNode;
  className?: string;
  size?: "small" | "large" | "tall" | "wide" | "xlarge";
}

function BentoCard({ children, className, size = "large" }: BentoCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm transition-colors hover:border-border/80 hover:bg-card/70",
        size === "small" && "p-3",
        size === "large" && "p-4",
        size === "tall" && "p-4",
        size === "wide" && "p-4",
        size === "xlarge" && "p-4",
        className
      )}
    >
      {children}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

type RevenueVariant =
  | "amber"
  | "indigo"
  | "emerald"
  | "red"
  | "blue"
  | "violet"
  | "rose"
  | "sky"
  | "neutral";

const revenueVariantStyles: Record<
  RevenueVariant,
  { icon: string; value: string }
> = {
  amber: {
    icon: "bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400",
    value: "text-amber-600 dark:text-amber-400",
  },
  indigo: {
    icon: "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400",
    value: "text-indigo-600 dark:text-indigo-400",
  },
  emerald: {
    icon: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400",
    value: "text-emerald-600 dark:text-emerald-400",
  },
  red: {
    icon: "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400",
    value: "text-red-600 dark:text-red-400",
  },
  blue: {
    icon: "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400",
    value: "text-blue-600 dark:text-blue-400",
  },
  violet: {
    icon: "bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400",
    value: "text-violet-600 dark:text-violet-400",
  },
  rose: {
    icon: "bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400",
    value: "text-rose-600 dark:text-rose-400",
  },
  sky: {
    icon: "bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400",
    value: "text-sky-600 dark:text-sky-400",
  },
  neutral: {
    icon: "bg-muted text-muted-foreground",
    value: "text-foreground",
  },
};

interface RevenueItemProps {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  /** true = เขียว, false = แดง, undefined = ใช้ variant */
  positive?: boolean;
  variant?: RevenueVariant;
}

function RevenueItem({ label, value, icon: Icon, positive, variant = "neutral" }: RevenueItemProps) {
  const iconStyle =
    positive === true
      ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400"
      : positive === false
        ? "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400"
        : revenueVariantStyles[variant].icon;

  const valueStyle =
    positive === true
      ? "text-emerald-600 dark:text-emerald-400"
      : positive === false
        ? "text-red-600 dark:text-red-400"
        : revenueVariantStyles[variant].value;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/40 hover:bg-muted/50 transition-colors">
      <div
        className={cn(
          "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
          iconStyle
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className={cn("text-sm font-medium truncate", valueStyle)}>{value}</p>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-6 lg:grid-cols-12 gap-4">
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-32 rounded-xl md:col-span-2 lg:col-span-4" />
      ))}
      <Skeleton className="h-80 rounded-xl md:col-span-6 lg:col-span-8" />
      <Skeleton className="h-80 rounded-xl md:col-span-6 lg:col-span-4" />
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-20 rounded-xl md:col-span-3 lg:col-span-3" />
      ))}
    </div>
  );
}

interface NoDataStateProps {
  dataRange: AdDataRange | null;
  isRangeLoading: boolean;
  /** The data range is already what's selected — offering to jump there is a lie. */
  isRangeSelected: boolean;
  /** Which source the emptiness is about, so the copy cannot overclaim. */
  dataSource: AdDataSourceFilter;
  onJumpToData: () => void;
}

/**
 * Two genuinely different situations that look identical on screen:
 * the workspace has no ad data at all, or it has data and the selected window
 * simply misses it. Uploaded merchant exports are historical, so the second is
 * the common case right after a successful import — and telling the merchant
 * "no data yet" there is false, and reads as "the import failed".
 */
// Exported for tests: two of its four states depend on a workspace having no
// data at all for one source, which the seeded e2e workspace cannot produce —
// so they are unreachable in a browser and would otherwise ship unrun.
export function NoDataState({
  dataRange,
  isRangeLoading,
  isRangeSelected,
  dataSource,
  onJumpToData,
}: NoDataStateProps) {
  const hasDataElsewhere = !!dataRange && !isRangeSelected;

  return (
    <div className="flex flex-col items-center justify-center py-24 rounded-xl border border-dashed border-border/60 bg-muted/20">
      <BarChart3 className="h-10 w-10 text-muted-foreground/50 mb-4" />

      {isRangeLoading ? (
        <>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64 mt-2" />
        </>
      ) : hasDataElsewhere ? (
        <>
          <h3 className="text-base font-medium text-foreground">ไม่มีข้อมูลในช่วงที่เลือก</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md text-center">
            {AD_DATA_SOURCE_NOUN[dataSource]}ครอบคลุม{" "}
            <span className="font-medium text-foreground">{formatAdDataRange(dataRange)}</span>{" "}
            — ไฟล์ที่อัปโหลดมักเป็นข้อมูลย้อนหลัง จึงไม่อยู่ในช่วงที่เลือกไว้
          </p>
          <Button variant="outline" size="sm" className="mt-4 rounded-lg" onClick={onJumpToData}>
            ดูช่วงข้อมูลที่มี
          </Button>
        </>
      ) : dataSource === "import" ? (
        // Telling someone filtered to uploads to "connect platforms" answers a
        // question they did not ask, and connecting one would not fill this page.
        <>
          <h3 className="text-base font-medium text-foreground">ยังไม่มีข้อมูลจากไฟล์ที่อัปโหลด</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm text-center">
            อัปโหลดไฟล์ .csv หรือ .xlsx ที่หน้า Imports แล้วตัวเลขจะขึ้นที่นี่
          </p>
          <Button variant="outline" size="sm" className="mt-4 rounded-lg" asChild>
            <Link to="/imports">ไปหน้า Imports</Link>
          </Button>
        </>
      ) : dataSource === "api" ? (
        <>
          <h3 className="text-base font-medium text-foreground">ยังไม่มีข้อมูลจากการเชื่อม API</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm text-center">
            เชื่อมต่อแพลตฟอร์มโฆษณาแล้วรอให้ข้อมูลไหลเข้ามา
          </p>
        </>
      ) : (
        <>
          <h3 className="text-base font-medium text-foreground">No data yet</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm text-center">
            Connect platforms and wait for activity to appear in this period.
          </p>
        </>
      )}
    </div>
  );
}
