import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Eye,
  MousePointer,
  UserPlus,
  ShoppingCart,
  CreditCard,
  Loader2,
  Activity,
  LayoutGrid,
  Sparkles,
  BarChart3,
} from "lucide-react";
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
} from "recharts";
import { PlanRestrictedPage } from "@/components/PlanRestrictedPage";
import { useCustomerJourneyData } from "@/hooks/useCustomerJourneyData";
import { useCustomerJourneyMonthlyData } from "@/hooks/useCustomerJourneyMonthlyData";
import { cn } from "@/lib/utils";

const stageConfig = [
  {
    id: "awareness",
    name: "Awareness",
    icon: Eye,
    color: "#0EA5E9",
    gradient: "from-sky-400 to-sky-600",
    bg: "bg-sky-50 dark:bg-sky-950/30",
    border: "border-sky-200 dark:border-sky-800",
    desc: "Ad impressions & Reach",
    tip: "Boost reach with retargeting or broader audiences",
  },
  {
    id: "consideration",
    name: "Consideration",
    icon: MousePointer,
    color: "#10B981",
    gradient: "from-emerald-400 to-emerald-600",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    border: "border-emerald-200 dark:border-emerald-800",
    desc: "Clicks & Site visits",
    tip: "Improve CTR with stronger creatives and headlines",
  },
  {
    id: "acquisition",
    name: "Acquisition",
    icon: UserPlus,
    color: "#8B5CF6",
    gradient: "from-violet-400 to-violet-600",
    bg: "bg-violet-50 dark:bg-violet-950/30",
    border: "border-violet-200 dark:border-violet-800",
    desc: "Sign-ups & Leads",
    tip: "Simplify forms and add social proof",
  },
  {
    id: "intent",
    name: "Intent",
    icon: ShoppingCart,
    color: "#F59E0B",
    gradient: "from-amber-400 to-amber-600",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "border-amber-200 dark:border-amber-800",
    desc: "Cart additions",
    tip: "Reduce friction with guest checkout",
  },
  {
    id: "conversion",
    name: "Conversion",
    icon: CreditCard,
    color: "#EF4444",
    gradient: "from-rose-400 to-rose-600",
    bg: "bg-rose-50 dark:bg-rose-950/30",
    border: "border-rose-200 dark:border-rose-800",
    desc: "Successful checkouts",
    tip: "Offer limited-time incentives at checkout",
  },
];

type JourneyStageWithData = (typeof stageConfig)[number] & {
  value?: number;
  retentionRate?: number;
  metrics?: Record<string, number | string>;
  isEstimated?: boolean;
  funnelWidth?: number;
  dropOff?: number;
};

// Journey Map — Winding path visualization (SVG path + HTML overlay nodes)
const MAP_VIEWBOX = { w: 1200, h: 380 };
const NODE_POSITIONS: Array<{ x: number; y: number }> = [
  { x: 80, y: 140 },
  { x: 320, y: 80 },
  { x: 560, y: 220 },
  { x: 800, y: 100 },
  { x: 1040, y: 200 },
];
const WINDING_PATH =
  "M 80 140 C 200 100, 260 140, 320 80 C 400 40, 480 80, 560 220 C 640 300, 720 260, 800 100 C 880 40, 960 80, 1040 200";

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function JourneyMap({
  stages,
  selectedStage,
  onStageSelect,
}: {
  stages: JourneyStageWithData[];
  selectedStage: JourneyStageWithData | null;
  onStageSelect: (stage: JourneyStageWithData) => void;
}) {
  const maxVal = Math.max(...stages.map((s) => s.value ?? 0), 1);

  return (
    <div className="relative w-full min-h-[440px] py-8 px-2 md:px-8">
      {/* Map background — terrain feel */}
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-sky-50/80 via-emerald-50/40 to-rose-50/60 dark:from-slate-900/80 dark:via-slate-900/60 dark:to-slate-900/80" />
      <div className="absolute inset-0 rounded-2xl bg-[radial-gradient(ellipse_80%_50%_at_50%_50%,transparent_0%,rgba(255,255,255,0.5)_100%)] dark:bg-[radial-gradient(ellipse_80%_50%_at_50%_50%,transparent_0%,rgba(0,0,0,0.15)_100%)]" />

      {/* SVG: winding path only */}
      <div className="relative w-full h-[320px] md:h-[380px] overflow-visible">
        <svg
          viewBox={`0 0 ${MAP_VIEWBOX.w} ${MAP_VIEWBOX.h}`}
          className="absolute inset-0 w-full h-full overflow-visible"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <linearGradient id="journey-path-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#0EA5E9" />
              <stop offset="25%" stopColor="#10B981" />
              <stop offset="50%" stopColor="#8B5CF6" />
              <stop offset="75%" stopColor="#F59E0B" />
              <stop offset="100%" stopColor="#EF4444" />
            </linearGradient>
            <filter id="path-glow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <path
            d={WINDING_PATH}
            fill="none"
            stroke="url(#journey-path-gradient)"
            strokeWidth="16"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#path-glow)"
            className="opacity-90"
          />
          <path
            d={WINDING_PATH}
            fill="none"
            stroke="rgba(255,255,255,0.7)"
            strokeWidth="12"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="dark:stroke-slate-700/60"
          />
          <path
            d={WINDING_PATH}
            fill="none"
            stroke="rgba(255,255,255,0.9)"
            strokeWidth="2"
            strokeDasharray="10 14"
            strokeLinecap="round"
            style={{ animation: "journey-dash 25s linear infinite" }}
            className="dark:stroke-white/40"
          />
        </svg>

        {/* HTML overlay: nodes positioned via % from viewBox */}
        {stages.map((stage, index) => {
          const Icon = stage.icon;
          const pos = NODE_POSITIONS[index] ?? { x: 0, y: 0 };
          const leftPct = (pos.x / MAP_VIEWBOX.w) * 100;
          const topPct = (pos.y / MAP_VIEWBOX.h) * 100;
          const isSelected = selectedStage?.id === stage.id;
          const widthPct = maxVal > 0 ? Math.max(15, ((stage.value ?? 0) / maxVal) * 100) : 15;
          const labelBelow = index % 2 === 0;

          return (
            <div
              key={stage.id}
              className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer"
              style={{ left: `${leftPct}%`, top: `${topPct}%` }}
              onClick={() => onStageSelect(stage)}
            >
              {/* Node circle — selection glow */}
              {isSelected && (
                <div
                  className="absolute w-20 h-20 rounded-full border-2 animate-pulse -left-3 -top-3"
                  style={{ borderColor: stage.color, opacity: 0.5 }}
                />
              )}
              <div
                className={cn(
                  "relative flex items-center justify-center w-14 h-14 rounded-full border-4 bg-white shadow-lg transition-all duration-300 hover:scale-110 dark:bg-slate-800",
                  isSelected && "scale-110 ring-4 ring-offset-2"
                )}
                style={{ borderColor: stage.color, ...(isSelected ? { boxShadow: `0 0 0 3px ${stage.color}40` } : {}) }}
              >
                <Icon className="w-6 h-6" style={{ color: stage.color }} strokeWidth={2.5} />
              </div>

              {/* Label card */}
              <div
                className={cn(
                  "absolute left-1/2 -translate-x-1/2 w-32 rounded-xl border-2 bg-white/95 shadow-md p-3 transition-all dark:bg-slate-800/95 dark:border-slate-600",
                  labelBelow ? "top-full mt-3" : "bottom-full mb-3"
                )}
                style={{ borderColor: `${stage.color}80` }}
              >
                <p className="text-xs font-bold text-center text-slate-900 dark:text-white truncate">{stage.name}</p>
                <p className="text-sm font-semibold text-center tabular-nums mt-0.5" style={{ color: stage.color }}>
                  {formatCompact(stage.value ?? 0)}
                  {stage.isEstimated && (
                    <span className="ml-1 text-[10px] font-normal text-slate-500 dark:text-slate-400">Est.</span>
                  )}
                </p>
                <div className="mt-2 space-y-1">
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>Funnel</span>
                    <span className="tabular-nums font-medium">{Math.round(stage.funnelWidth ?? 0)}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(4, widthPct)}%`, backgroundColor: stage.color }}
                    />
                  </div>
                </div>
                {index > 0 && (stage.retentionRate ?? 0) > 0 && (
                  <p className="text-[10px] text-center text-slate-500 mt-1 tabular-nums">
                    Pass-through {(stage.retentionRate ?? 0).toFixed(1)}%
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes journey-dash {
          to { stroke-dashoffset: -500; }
        }
      `}</style>
    </div>
  );
}

// Marketing insights panel — prominent when stage is selected
function MarketingInsights({ selectedStage }: { selectedStage: JourneyStageWithData | null }) {
  if (!selectedStage) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 p-8 text-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Click a stage to see details
        </p>
      </div>
    );
  }

  const Icon = selectedStage.icon;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900/80 shadow-md animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Accent bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl"
        style={{ backgroundColor: selectedStage.color }}
      />

      <div className="pl-6 pr-6 py-5 md:pl-8 md:pr-8 md:py-6">
        <div className="flex items-start gap-4">
          <div
            className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${selectedStage.color}15` }}
          >
            <Icon className="h-5 w-5" style={{ color: selectedStage.color }} strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
              {selectedStage.name}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{selectedStage.desc}</p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="rounded-xl bg-slate-50/80 dark:bg-slate-800/50 px-4 py-3">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Volume{selectedStage.isEstimated && " (Est.)"}
            </p>
            <p className="text-xl font-semibold tabular-nums text-slate-900 dark:text-white mt-1">
              {(selectedStage.value ?? 0).toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50/80 dark:bg-slate-800/50 px-4 py-3">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Pass-through</p>
            <p className="text-xl font-semibold tabular-nums mt-1" style={{ color: selectedStage.color }}>
              {(selectedStage.retentionRate ?? 0).toFixed(1)}%
            </p>
          </div>
          {selectedStage.dropOff != null && selectedStage.dropOff > 0 && (
            <div className="rounded-xl bg-rose-50/60 dark:bg-rose-950/30 px-4 py-3">
              <p className="text-xs font-medium text-rose-600/80 dark:text-rose-400/80 uppercase tracking-wider">Drop-off</p>
              <p className="text-xl font-semibold tabular-nums text-rose-600 dark:text-rose-400 mt-1">
                {selectedStage.dropOff.toFixed(0)}%
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CustomerJourneyContent() {
  const navigate = useNavigate();
  const [selectedPeriod, setSelectedPeriod] = useState("30d");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("all");
  const [selectedStage, setSelectedStage] = useState<JourneyStageWithData | null>(null);

  const { data: adAccounts = [] } = useQuery({
    queryKey: ["ad-accounts-active-filter"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_accounts")
        .select("id, account_name, platform_id, is_active")
        .eq("is_active", true)
        .order("account_name");
      if (error) throw error;
      return data || [];
    },
  });

  const platformIdFilter = selectedPlatform === "all" ? undefined : selectedPlatform;
  const { journeyStages: rawStages, isLoading } = useCustomerJourneyData(
    selectedPeriod,
    platformIdFilter
  );
  const { monthlyData, usedFallback: monthlyUsedFallback, isLoading: monthlyLoading } = useCustomerJourneyMonthlyData(6, platformIdFilter);

  const journeyStages = useMemo(() => {
    const awarenessValue = rawStages[0]?.value ?? 1;
    return rawStages.map((stage, index) => {
      const config = stageConfig[index];
      const funnelWidth = awarenessValue > 0 ? Math.min(100, (stage.value / awarenessValue) * 100) : 0;
      const prevValue = index > 0 ? (rawStages[index - 1]?.value ?? 0) : stage.value;
      const dropOff = prevValue > 0 ? 100 - (stage.value / prevValue) * 100 : 0;
      return config
        ? {
            ...config,
            value: stage.value,
            retentionRate: stage.retentionRate,
            metrics: stage.metrics,
            isEstimated: stage.isEstimated,
            funnelWidth,
            dropOff,
          }
        : { ...stageConfig[0], ...stage, funnelWidth: 0, dropOff: 0 };
    });
  }, [rawStages]);

  const hasData = journeyStages.length > 0 && journeyStages.some((s) => s.value > 0);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
        <div className="relative">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-sky-100 to-rose-100 dark:from-sky-900/50 dark:to-rose-900/50 flex items-center justify-center">
            <Activity className="h-8 w-8 text-sky-500 animate-pulse" />
          </div>
          <div className="absolute -inset-1 bg-gradient-to-r from-sky-400/20 to-rose-400/20 rounded-3xl blur-xl animate-pulse" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Mapping customer paths...</p>
          <p className="text-xs text-slate-500">Analyzing funnel stages</p>
        </div>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="relative inline-block mb-6">
            <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-sky-100 to-rose-100 dark:from-sky-900/50 dark:to-rose-900/50 flex items-center justify-center mx-auto">
              <Activity className="h-10 w-10 text-sky-500" />
            </div>
            <div className="absolute -inset-2 bg-gradient-to-r from-sky-400/10 to-rose-400/10 rounded-3xl blur-2xl" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight mb-2">
            No Journey Data Yet
          </h2>
          <p className="text-slate-500 mb-8">
            Connect your ad platforms and sync data to visualize how customers move from awareness to purchase.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              variant="outline"
              onClick={() => navigate("/api-keys")}
              className="rounded-xl border-2"
            >
              API Settings
            </Button>
            <Button onClick={() => window.open("https://supabase.com/dashboard", "_blank")} className="rounded-xl">
              Open Supabase
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50/80 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="max-w-[1600px] mx-auto p-4 md:p-6 lg:p-8 space-y-8">
        {/* Hero Header */}
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-sky-100 dark:bg-sky-900/50 px-3 py-1 text-xs font-semibold text-sky-700 dark:text-sky-300 uppercase tracking-wider">
              <Sparkles className="h-3.5 w-3.5" />
              Pipeline Intelligence
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white tracking-tight">
              Customer Journey
            </h1>
            <p className="text-slate-500 max-w-xl">
              See how prospects flow from first impression to purchase. Identify drop-offs and optimize each stage.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {adAccounts.length > 0 && (
              <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
                <SelectTrigger className="w-[180px] bg-white dark:bg-slate-900 rounded-xl border-2 h-11">
                  <LayoutGrid className="h-3.5 w-3.5 mr-1.5 text-slate-500" />
                  <SelectValue placeholder="All Platforms" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="all">All Platforms</SelectItem>
                  {adAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.platform_id ?? acc.id}>
                      {acc.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="w-[160px] bg-white dark:bg-slate-900 rounded-xl border-2 h-11">
                <SelectValue placeholder="Period" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="7d">Last 7 Days</SelectItem>
                <SelectItem value="30d">Last 30 Days</SelectItem>
                <SelectItem value="90d">Last 90 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Main Journey Visualization */}
        <div className="rounded-3xl border-2 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 shadow-xl shadow-slate-200/50 dark:shadow-none overflow-hidden">
          <div className="p-6 md:p-8">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">Funnel Flow</h2>
            <p className="text-sm text-slate-500">Click a stage to see optimization tips</p>
          </div>

          <div className="p-4 md:p-8">
            <JourneyMap
              stages={journeyStages}
              selectedStage={selectedStage}
              onStageSelect={(s) => setSelectedStage(selectedStage?.id === s.id ? null : s)}
            />
          </div>

          {/* Stage selector for insights */}
          <div className="px-6 md:px-8 pb-6">
            <div className="flex flex-wrap gap-2 mb-4">
              {journeyStages.map((stage) => (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => setSelectedStage(selectedStage?.id === stage.id ? null : stage)}
                  className={cn(
                    "rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200",
                    selectedStage?.id === stage.id
                      ? "ring-2 ring-offset-2 text-white"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                  )}
                  style={
                    selectedStage?.id === stage.id
                      ? ({ backgroundColor: stage.color, "--tw-ring-color": stage.color } as React.CSSProperties)
                      : {}
                  }
                >
                  {stage.name}
                </button>
              ))}
            </div>

            <MarketingInsights selectedStage={selectedStage} />
          </div>
        </div>

        {/* Monthly Comparison */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
            <div className="p-4 md:p-6 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">Monthly Comparison — Awareness & Consideration</h3>
            </div>
            <div className="p-4 md:p-6">
              <div className="h-[260px] w-full">
                {monthlyLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                  </div>
                ) : monthlyData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={monthlyData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.6} />
                      <XAxis dataKey="monthLabel" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis
                        yAxisId="left"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        tickFormatter={(v) => (v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))}
                      />
                      <Tooltip
                        contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", backgroundColor: "hsl(var(--card))", fontSize: "12px" }}
                        formatter={(value: number) => value.toLocaleString()}
                      />
                      <Legend />
                      <Bar yAxisId="left" dataKey="awareness" name="Awareness" fill="#0EA5E9" radius={[4, 4, 0, 0]} />
                      <Bar yAxisId="right" dataKey="consideration" name="Consideration" fill="#10B981" radius={[4, 4, 0, 0]} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-slate-500">
                    <BarChart3 className="h-10 w-10 mb-2 opacity-40" />
                    <p className="text-sm">No monthly data yet</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
            <div className="p-4 md:p-6 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Monthly Comparison — Acquisition, Intent & Conversion
                {(monthlyUsedFallback?.acquisition || monthlyUsedFallback?.intent || monthlyUsedFallback?.conversion) && (
                  <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">(Est.)</span>
                )}
              </h3>
            </div>
            <div className="p-4 md:p-6">
              <div className="h-[260px] w-full">
                {monthlyLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                  </div>
                ) : monthlyData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.6} />
                      <XAxis dataKey="monthLabel" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v))}
                      />
                      <Tooltip
                        contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", backgroundColor: "hsl(var(--card))", fontSize: "12px" }}
                        formatter={(value: number) => value.toLocaleString()}
                      />
                      <Legend />
                      <Bar
                        dataKey="acquisition"
                        name={monthlyUsedFallback?.acquisition ? "Acquisition (Est.)" : "Acquisition"}
                        fill="#8B5CF6"
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="intent"
                        name={monthlyUsedFallback?.intent ? "Intent (Est.)" : "Intent"}
                        fill="#F59E0B"
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="conversion"
                        name={monthlyUsedFallback?.conversion ? "Conversion (Est.)" : "Conversion"}
                        fill="#EF4444"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-slate-500">
                    <BarChart3 className="h-10 w-10 mb-2 opacity-40" />
                    <p className="text-sm">No monthly data yet</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CustomerJourney() {
  return (
    <PlanRestrictedPage requiredFeature="advancedAnalytics">
      <CustomerJourneyContent />
    </PlanRestrictedPage>
  );
}
