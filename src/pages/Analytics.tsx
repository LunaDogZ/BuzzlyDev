import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calendar,
  TrendingUp,
  AlertCircle,
  BarChart3,
  Activity,
  Zap,
  MousePointer2,
  DollarSign,
  PieChart as PieChartIcon,
  Target,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import { usePlatformConnections } from "@/hooks/usePlatformConnections";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import { useAdDataRange, formatAdDataRange, type AdDataRange } from "@/hooks/useAdDataRange";
import {
  AD_DATA_SOURCE_OPTIONS,
  AD_DATA_SOURCE_NOUN,
  type AdDataSourceFilter,
} from "@/constants/adDataSource";
import { PlanRestrictedPage } from "@/components/PlanRestrictedPage";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatRoas, roasWithheldReason } from "@/lib/roas";

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

function getMonday(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function getWeekOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  let monday = getMonday(now);
  for (let i = 0; i < 16; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() - 7 * i);
    const ymd = d.toISOString().split("T")[0]!;
    const end = new Date(d);
    end.setDate(end.getDate() + 6);
    options.push({
      value: ymd,
      label: `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
    });
  }
  return options;
}

function getMonthOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    options.push({
      value,
      label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    });
  }
  return options;
}

function getYearOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const y = new Date().getFullYear();
  for (let i = 0; i < 5; i++) {
    const v = String(y - i);
    options.push({ value: v, label: v });
  }
  return options;
}

const WEEK_OPTS = getWeekOptions();
const MONTH_OPTS = getMonthOptions();
const YEAR_OPTS = getYearOptions();

function AnalyticsContent() {
  const navigate = useNavigate();
  const { connectedPlatforms } = usePlatformConnections();
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const defaultWeek = getMonday(now).toISOString().split("T")[0]!;
  const defaultYear = String(now.getFullYear());

  const [dateMode, setDateMode] = useState<"7d" | "30d" | "year">("30d");
  const [weekValue, setWeekValue] = useState(defaultWeek);
  const [monthValue, setMonthValue] = useState(defaultMonth);
  const [yearValue, setYearValue] = useState(defaultYear);
  const [dataSource, setDataSource] = useState<AdDataSourceFilter>("all");

  const dateRange =
    dateMode === "7d" ? `week:${weekValue}` : dateMode === "30d" ? `month:${monthValue}` : `year:${yearValue}`;

  // Both reads take the same source filter. `useAdDataRange` reporting coverage
  // across every source while the metrics counted one would put a range in the
  // empty state that the page then renders as empty.
  const { data: metrics, isLoading } = useDashboardMetrics(dateRange, "all", dataSource);
  const { data: dataRange, isLoading: isRangeLoading } = useAdDataRange("all", dataSource);

  if (connectedPlatforms.length === 0) {
    return <EmptyPlatformState navigate={navigate} />;
  }

  const hasData = metrics && (metrics.totalImpressions > 0 || metrics.totalClicks > 0);

  if (!isLoading && !hasData) {
    return (
      <NoDataState
        dataRange={dataRange ?? null}
        isRangeLoading={isRangeLoading}
        dataSource={dataSource}
        setDataSource={setDataSource}
        dateMode={dateMode}
        setDateMode={setDateMode}
        weekValue={weekValue}
        setWeekValue={setWeekValue}
        monthValue={monthValue}
        setMonthValue={setMonthValue}
        yearValue={yearValue}
        setYearValue={setYearValue}
      />
    );
  }

  const metricsCards = metrics ? [
    { label: "Total Impressions", value: formatNumber(metrics.totalImpressions), unit: "impressions", icon: Activity, color: "text-blue-500" },
    { label: "CTR Rate", value: `${safeNum(metrics.avgCtr, 0).toFixed(2)}%`, unit: null, icon: MousePointer2, color: "text-emerald-500" },
    { label: "Avg CPC", value: safeNum(metrics.avgCpc, 0).toFixed(2), unit: "฿", icon: Zap, color: "text-amber-500" },
    // "ROAS", not "Net ROAS": nothing here is net of anything. Cost of goods
    // and platform fees are what would make it net, and that is the True Net
    // Profit the product is being built toward — not a label to spend early.
    // Withheld as "—" with the reason when the rows do not support it; the rule
    // lives in `computeRoas`, the wording in `roasWithheldReason`.
    {
      label: "ROAS",
      value: formatRoas(metrics) ?? "—",
      note: metrics.minRoas !== null ? null : roasWithheldReason(metrics),
      unit: null,
      icon: TrendingUp,
      color: "text-indigo-500",
    },
    { label: "Conversions", value: safeNum(metrics.totalConversions, 0).toLocaleString(), unit: "count", icon: Target, color: "text-rose-500" },
    { label: "Total Spend", value: safeNum(metrics.totalSpend, 0).toFixed(2), unit: "฿", icon: DollarSign, color: "text-slate-500" },
  ] : [];

  const pieData = metrics
    ? computeMarketShareData(metrics.trendData, dateMode)
    : [];

  return (
    <div className="max-w-7xl mx-auto space-y-8 p-4 md:p-8 animate-in fade-in duration-500">

      {/* 1. HEADER & GLOBAL FILTERS */}
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between border-b pb-8">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-sky-100 dark:bg-sky-900/50 px-3 py-1 text-xs font-semibold text-sky-700 dark:text-sky-300 uppercase tracking-wider">
            <BarChart3 className="h-3.5 w-3.5" />
            Global Intelligence
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white tracking-tight">
            Analytics Hub
          </h1>
          <p className="text-slate-500 max-w-xl">
            Cross-platform performance audit and predictive growth metrics.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="bg-muted/50 p-1 rounded-xl flex items-center gap-2 border">
            <Select value={dateMode} onValueChange={(v) => setDateMode(v as "7d" | "30d" | "year")}>
              <SelectTrigger className="w-[120px] bg-background border-none shadow-none h-9 rounded-lg">
                <Calendar className="mr-2 h-3.5 w-3.5 opacity-50" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">7 Days</SelectItem>
                <SelectItem value="30d">30 Days</SelectItem>
                <SelectItem value="year">Year</SelectItem>
              </SelectContent>
            </Select>
            {dateMode === "7d" && (
              <Select value={weekValue} onValueChange={setWeekValue}>
                <SelectTrigger className="w-[200px] bg-background border-none shadow-none h-9 rounded-lg">
                  <SelectValue placeholder="Select week" />
                </SelectTrigger>
                <SelectContent>
                  {WEEK_OPTS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {dateMode === "30d" && (
              <Select value={monthValue} onValueChange={setMonthValue}>
                <SelectTrigger className="w-[160px] bg-background border-none shadow-none h-9 rounded-lg">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_OPTS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {dateMode === "year" && (
              <Select value={yearValue} onValueChange={setYearValue}>
                <SelectTrigger className="w-[100px] bg-background border-none shadow-none h-9 rounded-lg">
                  <SelectValue placeholder="Select year" />
                </SelectTrigger>
                <SelectContent>
                  {YEAR_OPTS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <DataSourceSelect value={dataSource} onChange={setDataSource} />
          </div>
        </div>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : (
        <>
          {/* 2. EXECUTIVE METRICS GRID */}
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
            {metricsCards.map((metric) => (
              <Card key={metric.label} className="border-none shadow-sm bg-muted/20 rounded-2xl group hover:bg-muted/40 transition-all">
                <CardContent className="p-4">
                  <div className={cn("h-8 w-8 rounded-lg bg-background flex items-center justify-center mb-3 shadow-sm", metric.color)}>
                    <metric.icon className="h-4 w-4" />
                  </div>
                  <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest opacity-70">{metric.label}</p>
                  <p className="mt-1 text-xl font-black tracking-tight">
                    {metric.unit === "฿" && <span className="text-sm font-medium text-muted-foreground mr-0.5">{metric.unit}</span>}
                    {metric.value}
                    {(metric.unit === "impressions" || metric.unit === "count") && <span className="text-xs font-medium text-muted-foreground ml-1">{metric.unit}</span>}
                  </p>
                  {"note" in metric && metric.note && (
                    <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{metric.note}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* 3. CORE ANALYTICS BENTO */}
          <div className="grid gap-8 lg:grid-cols-3">
            {/* Traffic Area Chart */}
            <Card className="border-none shadow-none bg-muted/10 rounded-[2rem] lg:col-span-2 overflow-hidden">
              <CardHeader className="p-8 pb-0">
                <CardTitle className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" /> Traffic Trajectory
                </CardTitle>
                <CardDescription>Impressions and Clicks by day</CardDescription>
              </CardHeader>
              <CardContent className="p-8">
                <div className="h-[320px] w-full bg-background rounded-2xl p-4 border shadow-inner">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={(metrics?.trendData ?? []).map((d) => ({
                        ...d,
                        impressions: Number.isFinite(d.impressions) ? d.impressions : 0,
                        clicks: Number.isFinite(d.clicks) ? d.clicks : 0,
                        spend: Number.isFinite(d.spend) ? d.spend : 0,
                      }))}
                    >
                      <defs>
                        <linearGradient id="colorImp" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted))" />
                      <XAxis
                        dataKey="date"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fontWeight: 700 }}
                        tickFormatter={(val) => new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      />
                      <YAxis
                        yAxisId="impressions"
                        orientation="left"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => formatNumber(v)}
                      />
                      <YAxis
                        yAxisId="clicks"
                        orientation="right"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => formatNumber(v)}
                        domain={[0, 5000]}
                      />
                      <Tooltip
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        formatter={(value: number, name: string) => [
                          Number.isFinite(value) ? value.toLocaleString() : "0",
                          name === "impressions" ? "Impressions" : "Clicks",
                        ]}
                      />
                      <Legend />
                      <Area yAxisId="impressions" type="monotone" dataKey="impressions" name="Impressions" stroke="hsl(var(--primary))" strokeWidth={3} fill="url(#colorImp)" />
                      <Area yAxisId="clicks" type="monotone" dataKey="clicks" name="Clicks" stroke="hsl(var(--chart-2))" strokeWidth={2.5} fill="transparent" strokeDasharray="6 4" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Weekly Distribution Doughnut */}
            <Card className="border-none shadow-none bg-muted/10 rounded-[2rem] overflow-hidden">
              <CardHeader className="p-8 pb-0">
                <CardTitle className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
                  <PieChartIcon className="h-5 w-5 text-indigo-500" /> Market Share
                </CardTitle>
                <CardDescription>
                  {dateMode === "year"
                    ? "Impressions share by month"
                    : "Impressions share by week"}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-8">
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ borderRadius: '12px', border: 'none' }}
                        formatter={(value: number) => [Number.isFinite(value) ? value.toLocaleString() : "0", "Impressions"]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-6">
                  {pieData.map((item) => (
                    <div key={item.name} className="flex items-center gap-2 p-2 rounded-lg bg-background/50 border">
                      <div className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-[10px] font-bold uppercase tracking-tight truncate">{item.name}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 4. SPEND VELOCITY BAR CHART */}
          <Card className="border-none shadow-none bg-muted/10 rounded-[2rem] overflow-hidden">
            <CardHeader className="p-8 pb-0">
                <CardTitle className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-emerald-500" /> Spend Velocity
                </CardTitle>
              <CardDescription>
                {dateMode === "year"
                  ? "Daily spend (฿) — last 30 days"
                  : dateMode === "30d"
                    ? "Daily spend (฿) for the selected month"
                    : "Daily spend (฿) for the selected week"}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-8">
              <div className="h-[280px] bg-background rounded-2xl p-4 border shadow-inner">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={(metrics?.trendData ?? [])
                      .slice(dateMode === "year" ? -30 : undefined)
                      .map((d) => ({
                        ...d,
                        spend: Number.isFinite(d.spend) ? d.spend : 0,
                      }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted))" />
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fontWeight: 700 }}
                      tickFormatter={(val) => new Date(val).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                    />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} tickFormatter={(v) => `฿${Number.isFinite(Number(v)) ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "0"}`} />
                    <Tooltip
                      cursor={{ fill: 'hsl(var(--muted)/0.4)' }}
                      contentStyle={{ borderRadius: '12px', border: 'none' }}
                      formatter={(value: number) => [`฿${Number.isFinite(value) ? Number(value).toFixed(2) : "0.00"}`, "Spend"]}
                    />
                    <Bar dataKey="spend" name="Spend" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} barSize={30} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// --- INTERNAL HELPERS ---

function computeMarketShareData(
  trendData: { date: string; impressions: number; clicks: number; spend: number }[],
  dateMode: "7d" | "30d" | "year"
): { name: string; value: number; color: string }[] {
  if (!trendData || trendData.length === 0) return [];

  if (dateMode === "year") {
    const byMonth = trendData.reduce((acc, item) => {
      const date = new Date(item.date);
      const key = date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
      const existing = acc.find((i) => i.name === key);
      if (existing) existing.value += item.impressions;
      else acc.push({ name: key, value: item.impressions });
      return acc;
    }, [] as { name: string; value: number }[]);
    return byMonth.map((item, i) => ({ ...item, color: CHART_COLORS[i % CHART_COLORS.length] }));
  }

  if (dateMode === "30d") {
    const byWeek = trendData.reduce((acc, item) => {
      const day = parseInt(item.date.split("-")[2] ?? "1", 10);
      const weekNum = Math.floor((day - 1) / 7) + 1;
      const weekLabel = `Week ${weekNum}`;
      const existing = acc.find((i) => i.name === weekLabel);
      if (existing) existing.value += item.impressions;
      else acc.push({ name: weekLabel, value: item.impressions });
      return acc;
    }, [] as { name: string; value: number }[]);
    byWeek.sort((a, b) => {
      const na = parseInt(a.name.replace("Week ", ""), 10);
      const nb = parseInt(b.name.replace("Week ", ""), 10);
      return na - nb;
    });
    return byWeek.map((item, i) => ({ ...item, color: CHART_COLORS[i % CHART_COLORS.length] }));
  }

  const total = trendData.reduce((s, i) => s + i.impressions, 0);
  return total > 0 ? [{ name: "Week 1", value: total, color: CHART_COLORS[0] }] : [];
}

function formatNumber(num: number) {
  const n = Number(num);
  if (!Number.isFinite(n)) return "0";
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

function safeNum(val: number, fallback: number): number {
  return Number.isFinite(val) ? val : fallback;
}

function EmptyPlatformState({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-12 border-2 border-dashed rounded-[3rem] bg-muted/10">
      <div className="bg-background p-6 rounded-full shadow-xl mb-6"><Activity className="h-10 w-10 text-primary" /></div>
      <h2 className="text-2xl font-black uppercase tracking-tight mb-2">No Engines Connected</h2>
      <p className="text-muted-foreground mb-8 max-w-sm">Establish your API bridges to start populating this intelligence hub with real-time marketing data.</p>
      <Button onClick={() => navigate("/api-keys")} className="rounded-full px-10 shadow-lg shadow-primary/20">Connect Platform</Button>
    </div>
  );
}

interface NoDataStateProps {
  dataRange: AdDataRange | null;
  isRangeLoading: boolean;
  dataSource: AdDataSourceFilter;
  setDataSource: (v: AdDataSourceFilter) => void;
  dateMode: "7d" | "30d" | "year";
  setDateMode: (v: "7d" | "30d" | "year") => void;
  weekValue: string;
  setWeekValue: (v: string) => void;
  monthValue: string;
  setMonthValue: (v: string) => void;
  yearValue: string;
  setYearValue: (v: string) => void;
}

/** The source filter, styled for the pill group both headers use. */
function DataSourceSelect({
  value,
  onChange,
}: {
  value: AdDataSourceFilter;
  onChange: (v: AdDataSourceFilter) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as AdDataSourceFilter)}>
      <SelectTrigger className="w-[150px] bg-background border-none shadow-none h-9 rounded-lg">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {AD_DATA_SOURCE_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Exported for tests for the same reason as the Dashboard's: the "this source
// has nothing at all" branch cannot be produced by the seeded workspace.
export function NoDataState({
  dataRange,
  isRangeLoading,
  dataSource,
  setDataSource,
  dateMode,
  setDateMode,
  weekValue,
  setWeekValue,
  monthValue,
  setMonthValue,
  yearValue,
  setYearValue,
}: NoDataStateProps) {
  // The month picker only lists the last 12 months, so data older than that can
  // be described but not jumped to — say so rather than blanking the trigger.
  const dataMonth = dataRange ? dataRange.end.slice(0, 7) : null;
  const canJumpToData = !!dataMonth && MONTH_OPTS.some((o) => o.value === dataMonth);

  return (
    <div className="space-y-8 p-4 md:p-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Analytics Hub</h1>
        <div className="bg-muted/50 p-1 rounded-xl flex items-center gap-2 border">
          <Select value={dateMode} onValueChange={(v) => setDateMode(v as "7d" | "30d" | "year")}>
            <SelectTrigger className="w-[120px] bg-background border-none shadow-none h-9 rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">7 Days</SelectItem>
              <SelectItem value="30d">30 Days</SelectItem>
              <SelectItem value="year">Year</SelectItem>
            </SelectContent>
          </Select>
          {dateMode === "7d" && (
            <Select value={weekValue} onValueChange={setWeekValue}>
              <SelectTrigger className="w-[200px] bg-background border-none shadow-none h-9 rounded-lg">
                <SelectValue placeholder="Select week" />
              </SelectTrigger>
              <SelectContent>
                {WEEK_OPTS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {dateMode === "30d" && (
            <Select value={monthValue} onValueChange={setMonthValue}>
              <SelectTrigger className="w-[160px] bg-background border-none shadow-none h-9 rounded-lg">
                <SelectValue placeholder="Select month" />
              </SelectTrigger>
              <SelectContent>
                {MONTH_OPTS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {dateMode === "year" && (
            <Select value={yearValue} onValueChange={setYearValue}>
              <SelectTrigger className="w-[100px] bg-background border-none shadow-none h-9 rounded-lg">
                <SelectValue placeholder="Select year" />
              </SelectTrigger>
              <SelectContent>
                {YEAR_OPTS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {/* Kept in the empty state too: the filter is often the reason the
              page is empty, and hiding it would leave no way back. */}
          <DataSourceSelect value={dataSource} onChange={setDataSource} />
        </div>
      </div>
      <Card className="border-dashed bg-muted/10 rounded-[3rem] py-20 flex flex-col items-center text-center">
        <AlertCircle className="h-12 w-12 text-muted-foreground opacity-20 mb-4" />
        {/* Coverage arrives a beat after the metrics do. Showing the generic
            "no activity" copy in that gap flashes the very claim this state
            exists to stop making, so wait rather than guess. */}
        {isRangeLoading ? (
          <>
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-5 w-80 mt-3" />
          </>
        ) : dataRange ? (
          <>
            <h3 className="text-xl font-bold">ไม่มีข้อมูลในช่วงที่เลือก</h3>
            <p className="text-muted-foreground max-w-md">
              {AD_DATA_SOURCE_NOUN[dataSource]}ครอบคลุม{" "}
              <span className="font-semibold text-foreground">{formatAdDataRange(dataRange)}</span>
            </p>
            {canJumpToData && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4 rounded-lg"
                onClick={() => {
                  setDateMode("30d");
                  setMonthValue(dataMonth!);
                }}
              >
                ดูช่วงข้อมูลที่มี
              </Button>
            )}
          </>
        ) : dataSource !== "all" ? (
          // "Ensure your tracking pixels are active" is advice about API data.
          // Given to someone filtered to uploaded files it is simply wrong, and
          // the workspace may be full of data they just filtered out.
          <>
            <h3 className="text-xl font-bold">ไม่มี{AD_DATA_SOURCE_NOUN[dataSource]}</h3>
            <p className="text-muted-foreground max-w-md">
              {dataSource === "import"
                ? "ยังไม่มีไฟล์ที่อัปโหลดสำเร็จในเวิร์กสเปซนี้ — อัปโหลด .csv หรือ .xlsx ที่หน้า Imports"
                : "ยังไม่มีแพลตฟอร์มที่เชื่อมต่อแล้วส่งข้อมูลเข้ามา"}{" "}
              เลือก <span className="font-semibold text-foreground">All sources</span> เพื่อดูข้อมูลทั้งหมดที่มี
            </p>
          </>
        ) : (
          <>
            <h3 className="text-xl font-bold">Data Silence Detected</h3>
            <p className="text-muted-foreground max-w-sm">There is no reported activity for the selected period. Ensure your tracking pixels and ad accounts are active.</p>
          </>
        )}
      </Card>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-6">
        {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
      <div className="grid gap-8 lg:grid-cols-3">
        <Skeleton className="lg:col-span-2 h-[400px] rounded-[2rem]" />
        <Skeleton className="h-[400px] rounded-[2rem]" />
      </div>
    </div>
  );
}

export default function Analytics() {
  return (
    <PlanRestrictedPage requiredFeature="advancedAnalytics" featureDescription="Advanced analytics and insights">
      <AnalyticsContent />
    </PlanRestrictedPage>
  );
}