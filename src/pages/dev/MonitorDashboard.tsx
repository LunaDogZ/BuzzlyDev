import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Activity, Server, Database, Cpu, HardDrive, Wifi, AlertTriangle, CheckCircle2, XCircle, RefreshCw, Clock, TrendingUp, TrendingDown, Zap, Globe, AlertCircle, Search, Play, Filter, ShieldCheck, LayoutGrid, List, ChevronLeft, ChevronRight } from "lucide-react";
import { useServerHealth, useDataPipelines, useExternalAPIStatus, useErrorLogStats, usePerformanceMetrics } from "@/hooks/useAdminMonitor";
import { formatDistanceToNow, subHours, startOfHour, format } from "date-fns";
import { SparklineTrend } from "@/components/dev/SparklineTrend";
import { Input } from "@/components/ui/input";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from "recharts";

// Removed MOCK_PIPELINES as we are now using data from the database

const getStatusIcon = (status: string | null) => {
  switch (status?.toLowerCase()) {
    case "healthy":
    case "running":
    case "operational":
    case "active":
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "warning":
    case "degraded":
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case "critical":
    case "down":
    case "error":
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500" />;
    default:
      return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
  }
};

const getStatusBadge = (status: string | null) => {
  switch (status?.toLowerCase()) {
    case "healthy":
    case "running":
    case "operational":
    case "active":
    case "success":
      return <Badge className="bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20">{status}</Badge>;
    case "warning":
    case "degraded":
      return <Badge className="bg-yellow-500/10 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/20">{status}</Badge>;
    case "critical":
    case "down":
    case "error":
    case "failed":
      return <Badge className="bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20">{status}</Badge>;
    default:
      return <Badge variant="secondary" className="bg-slate-800 text-slate-300 border-slate-700">{status || "Unknown"}</Badge>;
  }
};

const getBarColor = (value: number) => {
  if (value >= 85) return "bg-red-500";
  if (value >= 70) return "bg-yellow-400";
  return "bg-green-500";
};

const getHexColor = (value: number) => {
  if (value >= 85) return "#ef4444"; // red-500
  if (value >= 70) return "#facc15"; // yellow-400
  return "#22c55e"; // green-500
};

export default function MonitorDashboard() {
  const navigate = useNavigate();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [serverPage, setServerPage] = useState(1);
  const serversPerPage = 4;
  const [pipelinePage, setPipelinePage] = useState(1);
  const pipelinesPerPage = 8;
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const { data: servers, isLoading: serversLoading, refetch: refetchServers } = useServerHealth();

  const indexOfLastServer = serverPage * serversPerPage;
  const indexOfFirstServer = indexOfLastServer - serversPerPage;
  const currentServers = servers?.slice(indexOfFirstServer, indexOfLastServer);
  const totalServerPages = Math.ceil((servers?.length || 0) / serversPerPage);

  const { data: pipelines, isLoading: pipelinesLoading, refetch: refetchPipelines } = useDataPipelines();

  const filteredAndSortedPipelines = (pipelines || [])
    .filter(pipeline => pipeline.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .filter(pipeline => statusFilter === "All" || (pipeline.status || "").toLowerCase() === statusFilter.toLowerCase())
    .sort((a, b) => {
      const order: Record<string, number> = { failed: 0, error: 0, critical: 0, warning: 1, active: 2, running: 2, healthy: 2 };
      return (order[(a.status || "").toLowerCase()] ?? 3) - (order[(b.status || "").toLowerCase()] ?? 3);
    });

  const indexOfLastPipeline = pipelinePage * pipelinesPerPage;
  const indexOfFirstPipeline = indexOfLastPipeline - pipelinesPerPage;
  const currentPipelines = filteredAndSortedPipelines.slice(indexOfFirstPipeline, indexOfLastPipeline);
  const totalPipelinePages = Math.ceil(filteredAndSortedPipelines.length / pipelinesPerPage);

  const { data: externalApis, isLoading: apisLoading, refetch: refetchApis } = useExternalAPIStatus();
  const { data: errorStatsData, refetch: refetchErrors } = useErrorLogStats();
  const { data: perfMetrics, refetch: refetchPerf } = usePerformanceMetrics();

  const [selectedLevelFilter, setSelectedLevelFilter] = useState<string | null>(null);

  // ── Service Health Dashboard State ──────────────────────────────────────────
  const [apiSearch, setApiSearch] = useState('');
  const [apiStatusFilter, setApiStatusFilter] = useState('All'); // All | Operational | Degraded | Down
  const [apiCategoryFilter, setApiCategoryFilter] = useState('All'); // All | Social | Shopping | Cloud | Payment | Other
  const [apiPage, setApiPage] = useState(1);
  const API_PAGE_SIZE = 15;

  const getSmartStatus = (code: number | null, latency: number | null) => {
    if (!code || (code >= 400)) return { label: 'Down',        color: 'red',    badgeCls: 'bg-red-500/15 text-red-500 border-red-500/30' };
    if (code >= 200 && code < 300 && latency && latency > 1000)
      return { label: 'Degraded',    color: 'yellow', badgeCls: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30' };
    return   { label: 'Operational', color: 'green',  badgeCls: 'bg-green-500/15 text-green-500 border-green-500/30' };
  };

  const getCategoryFromName = (name: string): string => {
    const n = name.toLowerCase();
    if (['facebook','instagram','linkedin','tiktok','line','twitter','x.com'].some(k => n.includes(k))) return 'Social';
    if (['lazada','shopee','woocommerce','shopify'].some(k => n.includes(k))) return 'Shopping';
    if (['google','aws','azure','gcp'].some(k => n.includes(k))) return 'Cloud';
    if (['stripe','paypal','omise','2c2p'].some(k => n.includes(k))) return 'Payment';
    return 'Other';
  };

  const apiCategories = ['All', ...Array.from(new Set((externalApis ?? []).map(a => getCategoryFromName(a.platform_name ?? ''))))];

  const enrichedApis = (externalApis ?? []).map(api => {
    const status   = getSmartStatus(api.last_status_code, api.latency_ms);
    const category = getCategoryFromName(api.platform_name ?? '');
    return { ...api, status, category };
  });

  const filteredApis = enrichedApis
    .filter(a => a.platform_name?.toLowerCase().includes(apiSearch.toLowerCase()))
    .filter(a => apiStatusFilter   === 'All' || a.status.label === apiStatusFilter)
    .filter(a => apiCategoryFilter === 'All' || a.category     === apiCategoryFilter);

  const totalApiPages = Math.ceil(filteredApis.length / API_PAGE_SIZE);
  const pagedApis     = filteredApis.slice((apiPage - 1) * API_PAGE_SIZE, apiPage * API_PAGE_SIZE);

  const STATUS_PILLS = ['All', 'Operational', 'Degraded', 'Down'] as const;
  const STATUS_PILL_CLS: Record<string, string> = {
    All:         'bg-blue-600   text-white', // Changed to blue to match Category All
    Operational: 'bg-green-600/20 text-green-500',
    Degraded:    'bg-yellow-600/20 text-yellow-500',
    Down:        'bg-red-600/20    text-red-500',
  };
  // ─────────────────────────────────────────────────────────────────────────────

  const processedErrorStats = useMemo(() => {
    const defaultStats = { total: 0, critical: 0, errors: 0, warnings: 0, info: 0, chartData: [], topIssues: [], recentLogs: [] };
    if (!errorStatsData || errorStatsData.length === 0) return defaultStats;

    const now = new Date();
    const twentyFourHoursAgo = subHours(now, 24);

    const recent24hLogs = errorStatsData.filter((log) => new Date(log.created_at) >= twentyFourHoursAgo);

    const criticalLogs = recent24hLogs.filter((l) => l.level.toLowerCase() === 'critical');
    const errorLogs = recent24hLogs.filter((l) => l.level.toLowerCase() === 'error');
    const warningLogs = recent24hLogs.filter((l) => ['warning', 'warn'].includes(l.level.toLowerCase()));
    const infoLogs = recent24hLogs.filter((l) => l.level.toLowerCase() === 'info');

    const chartData = [];
    for (let i = 23; i >= 0; i--) {
      const hourStart = startOfHour(subHours(now, i));
      const nextHourStart = startOfHour(subHours(now, i - 1));

      const hourLogs = recent24hLogs.filter((l) => {
        const d = new Date(l.created_at);
        return d >= hourStart && d < (i === 0 ? now : nextHourStart);
      });

      chartData.push({
        time: format(hourStart, "HH:mm"),
        critical: hourLogs.filter((l) => l.level.toLowerCase() === 'critical').length,
        error: hourLogs.filter((l) => l.level.toLowerCase() === 'error').length,
        warning: hourLogs.filter((l) => ['warning', 'warn'].includes(l.level.toLowerCase())).length,
        info: hourLogs.filter((l) => l.level.toLowerCase() === 'info').length,
      });
    }

    const filteredLogs = selectedLevelFilter
      ? recent24hLogs.filter((l) => {
        if (selectedLevelFilter === 'warning') return ['warning', 'warn'].includes(l.level.toLowerCase());
        return l.level.toLowerCase() === selectedLevelFilter;
      })
      : recent24hLogs;

    // Use selected filter, or default to critical if not filtered (for recent logs showing)
    const logsForRecent = selectedLevelFilter ? filteredLogs : criticalLogs;

    const messageCounts: Record<string, number> = {};
    filteredLogs.forEach((l) => {
      messageCounts[l.message] = (messageCounts[l.message] || 0) + 1;
    });
    const topIssues = Object.entries(messageCounts)
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const recentLogs = logsForRecent.slice(0, 5);

    return {
      total: recent24hLogs.length,
      critical: criticalLogs.length,
      errors: errorLogs.length,
      warnings: warningLogs.length,
      info: infoLogs.length,
      chartData,
      topIssues,
      recentLogs
    };
  }, [errorStatsData, selectedLevelFilter]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      refetchServers(),
      refetchPipelines(),
      refetchApis(),
      refetchErrors(),
      refetchPerf(),
    ]);
    setIsRefreshing(false);
  };

  const systemStatus = perfMetrics?.criticalServers
    ? "Critical"
    : perfMetrics?.warningServers
      ? "Warning"
      : "Healthy";

  return (
    <div className="space-y-6 text-slate-200 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Monitor Dashboard</h1>
          <p className="text-slate-400 font-medium">Real-time System Status and Metrics Monitoring</p>
        </div>
        <Button
          onClick={handleRefresh}
          disabled={isRefreshing}
          variant="outline"
          className="bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Overall Status Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card className="bg-[#111827] border-slate-800 shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-slate-400 uppercase tracking-wider">System Status</CardTitle>
            <Server className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              {getStatusIcon(systemStatus)}
              <div>
                <p className="text-2xl font-bold text-white leading-tight">{systemStatus}</p>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  {perfMetrics?.healthyServers || 0}/{perfMetrics?.totalServers || 0} servers up
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#111827] border-slate-800 shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-slate-400 uppercase tracking-wider">CPU Usage</CardTitle>
            <Cpu className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="text-2xl font-bold text-white">{perfMetrics?.avgCpuUsage || 0}%</div>
                {perfMetrics?.avgCpuUsage && perfMetrics.avgCpuUsage < 70 ? (
                  <TrendingDown className="h-4 w-4 text-green-400" />
                ) : (
                  <TrendingUp className="h-4 w-4 text-yellow-400" />
                )}
              </div>
              <div className="flex flex-col items-end">
                <SparklineTrend color={getHexColor(perfMetrics?.avgCpuUsage || 0)} />
                <span className="text-[10px] text-slate-500 font-medium">(Last 1h Trend)</span>
              </div>
            </div>
            <Progress
              value={perfMetrics?.avgCpuUsage || 0}
              className="h-1.5 bg-slate-800"
              indicatorClassName={getBarColor(perfMetrics?.avgCpuUsage || 0)}
            />
          </CardContent>
        </Card>

        <Card className="bg-[#111827] border-slate-800 shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Memory Usage</CardTitle>
            <HardDrive className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-2">
              <div className="text-2xl font-bold text-white">{perfMetrics?.avgMemoryUsage || 0}%</div>
              <div className="flex flex-col items-end">
                <SparklineTrend color={getHexColor(perfMetrics?.avgMemoryUsage || 0)} />
                <span className="text-[10px] text-slate-500 font-medium">(Last 1h Trend)</span>
              </div>
            </div>
            <Progress
              value={perfMetrics?.avgMemoryUsage || 0}
              className="h-1.5 bg-slate-800"
              indicatorClassName={getBarColor(perfMetrics?.avgMemoryUsage || 0)}
            />
          </CardContent>
        </Card>

        <Card className="bg-[#111827] border-slate-800 shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Disk Usage</CardTitle>
            <Database className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-2">
              <div className="text-2xl font-bold text-white">{perfMetrics?.avgDiskUsage || 0}%</div>
              <div className="flex flex-col items-end">
                <SparklineTrend color={getHexColor(perfMetrics?.avgDiskUsage || 0)} />
                <span className="text-[10px] text-slate-500 font-medium">(Last 1h Trend)</span>
              </div>
            </div>
            <Progress
              value={perfMetrics?.avgDiskUsage || 0}
              className="h-1.5 bg-slate-800"
              indicatorClassName={getBarColor(perfMetrics?.avgDiskUsage || 0)}
            />
          </CardContent>
        </Card>

        <Card className="bg-[#111827] border-slate-800 shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Errors (Total)</CardTitle>
            <AlertTriangle className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <div className="text-2xl font-bold text-red-500 tracking-tight">{processedErrorStats?.errors || 0}</div>
              <Badge className={processedErrorStats?.errors === 0 ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"}>
                {processedErrorStats?.errors === 0 ? "Normal" : "Review"}
              </Badge>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-1">{processedErrorStats?.warnings || 0} warnings identified</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs for Different Sections */}
      <Tabs defaultValue="servers" className="space-y-4 min-h-[600px]">
        <TabsList className="grid w-full grid-cols-4 bg-[#111827] border border-slate-800 p-1">
          <TabsTrigger value="servers" className="data-[state=active]:bg-[#1F2937] data-[state=active]:text-white text-slate-400">
            <Server className="h-4 w-4 mr-2" />
            Servers
          </TabsTrigger>
          <TabsTrigger value="pipelines" className="data-[state=active]:bg-[#1F2937] data-[state=active]:text-white text-slate-400">
            <Database className="h-4 w-4 mr-2" />
            Data Pipelines
          </TabsTrigger>
          <TabsTrigger value="errors" className="data-[state=active]:bg-[#1F2937] data-[state=active]:text-white text-slate-400">
            <AlertCircle className="h-4 w-4 mr-2" />
            Errors
          </TabsTrigger>
          <TabsTrigger value="apis" className="data-[state=active]:bg-[#1F2937] data-[state=active]:text-white text-slate-400">
            <Globe className="h-4 w-4 mr-2" />
            External APIs
          </TabsTrigger>
        </TabsList>

        {/* Servers Tab */}
        <TabsContent value="servers" className="space-y-4">
          {serversLoading ? (
            <div className="text-center py-12 text-slate-500 animate-pulse font-medium">Loading server infrastructure details...</div>
          ) : servers?.length === 0 ? (
            <Card className="bg-[#111827] border-slate-800">
              <CardContent className="py-12 text-center text-slate-500 font-medium">
                No servers configured in the monitoring system
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                {currentServers?.map((server) => {
                  const memoryPercent = server.total_memory && server.used_memory
                    ? Math.round((Number(server.used_memory) / Number(server.total_memory)) * 100)
                    : 0;

                  const diskPercent = server.disk_total && server.disk_used
                    ? Math.round((Number(server.disk_used) / Number(server.disk_total)) * 100)
                    : 0;

                  return (
                    <Card key={server.id} className="bg-[#111827] border-slate-800 hover:border-blue-500/30 transition-all duration-300 shadow-md">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-lg flex items-center gap-2 text-white">
                            {getStatusIcon(server.status)}
                            {server.hostname || "Unknown Server"}
                          </CardTitle>
                          {getStatusBadge(server.status)}
                        </div>
                        {server.ip_address && (
                          <p className="text-xs text-slate-500 font-mono mt-1 opacity-80">{server.ip_address}</p>
                        )}
                      </CardHeader>
                      <CardContent className="space-y-5">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs uppercase tracking-wider font-semibold text-slate-400">
                            <span className="flex items-center gap-2">
                              <Cpu className="h-3.5 w-3.5" />
                              CPU Utilization
                            </span>
                            <span className="text-slate-200">{Number(server.cpu_usage_percent) || 0}%</span>
                          </div>
                          <Progress
                            value={Number(server.cpu_usage_percent) || 0}
                            className="h-1.5 bg-slate-800"
                            indicatorClassName={getBarColor(Number(server.cpu_usage_percent) || 0)}
                          />
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs uppercase tracking-wider font-semibold text-slate-400">
                            <span className="flex items-center gap-2">
                              <HardDrive className="h-3.5 w-3.5" />
                              Memory Allocation
                            </span>
                            <span className="text-slate-200">{memoryPercent}%</span>
                          </div>
                          <Progress
                            value={memoryPercent}
                            className="h-1.5 bg-slate-800"
                            indicatorClassName={getBarColor(memoryPercent)}
                          />
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs uppercase tracking-wider font-semibold text-slate-400">
                            <span className="flex items-center gap-2">
                              <HardDrive className="h-3.5 w-3.5" />
                              Disk Occupancy
                            </span>
                            <span className="text-slate-200">{diskPercent}%</span>
                          </div>
                          <Progress
                            value={diskPercent}
                            className="h-1.5 bg-slate-800"
                            indicatorClassName={getBarColor(diskPercent)}
                          />
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
              {totalServerPages > 1 && (
                <div className="flex justify-center items-center gap-4 mt-8">
                  <Button
                    variant="outline"
                    onClick={() => setServerPage((p) => Math.max(1, p - 1))}
                    disabled={serverPage === 1}
                    className="bg-[#111827] border-slate-700 text-slate-300 hover:text-white"
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-slate-500 font-medium">
                    Page <span className="text-slate-200">{serverPage}</span> of <span className="text-slate-200">{totalServerPages}</span>
                  </span>
                  <Button
                    variant="outline"
                    onClick={() => setServerPage((p) => Math.min(totalServerPages, p + 1))}
                    disabled={serverPage === totalServerPages}
                    className="bg-[#111827] border-slate-700 text-slate-300 hover:text-white"
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* Data Pipelines Tab */}
        <TabsContent value="pipelines">
          <Card className="bg-[#0B0F1A] border-slate-800 shadow-xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 bg-[#111827]">
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <Input
                  type="text"
                  placeholder="Search pipelines..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-[#1F2937]/50 border-slate-700 text-slate-200 placeholder:text-slate-500 h-9"
                />
              </div>
              <div className="flex items-center gap-1.5 p-1 bg-[#1F2937]/50 rounded-lg border border-slate-700 overflow-x-auto w-full sm:w-auto">
                <Filter className="h-4 w-4 text-slate-500 ml-2 mr-1" />
                {['All', 'Active', 'Warning', 'Failed'].map((status) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={cn(
                      "px-3 py-1 text-xs font-semibold rounded-md transition-all whitespace-nowrap",
                      statusFilter === status
                        ? "bg-slate-700 text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                    )}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>

            <CardContent className="p-0">
              {currentPipelines.length === 0 ? (
                <div className="text-center py-12 text-slate-500 font-medium">No pipelines match your search criteria</div>
              ) : (
                <div className="divide-y divide-slate-800">
                  {currentPipelines.map((pipeline) => (
                    <div
                      key={pipeline.id}
                      className="group flex flex-col md:flex-row md:items-center p-4 hover:bg-[#1F2937]/30 transition-colors bg-[#0B0F1A]"
                    >
                      {/* Col 1: Name and Subtitle */}
                      <div className="flex-1 min-w-[200px] mb-3 md:mb-0">
                        <div className="flex items-center gap-3">
                          <Database className="h-4 w-4 text-slate-500" />
                          <div>
                            <p className="font-semibold text-white tracking-tight text-sm">{pipeline.name}</p>
                            <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                              {pipeline.last_run_at
                                ? `Processed ${formatDistanceToNow(new Date(pipeline.last_run_at), { addSuffix: true })}`
                                : "Awaiting first execution"}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 md:gap-8 justify-between md:justify-end flex-wrap md:flex-nowrap">

                        {/* Col 2: Cron Schedule */}
                        <div className="w-[100px] text-left">
                          <p className="font-mono text-xs font-semibold text-slate-400">{pipeline.schedule_cron || "MANUAL"}</p>
                          <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Schedule</p>
                        </div>

                        {/* Col 3: Status Badge */}
                        <div className="w-[100px] text-right">
                          {getStatusBadge(pipeline.status)}
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Pagination Footer */}
                  {totalPipelinePages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 bg-[#111827] border-t border-slate-800">
                      <span className="text-xs text-slate-500 font-medium">
                        Showing {indexOfFirstPipeline + 1} to {Math.min(indexOfLastPipeline, filteredAndSortedPipelines.length)} of {filteredAndSortedPipelines.length}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPipelinePage((p) => Math.max(1, p - 1))}
                          disabled={pipelinePage === 1}
                          className="h-8 bg-[#1F2937] border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700"
                        >
                          Prev
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPipelinePage((p) => Math.min(totalPipelinePages, p + 1))}
                          disabled={pipelinePage === totalPipelinePages}
                          className="h-8 bg-[#1F2937] border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700"
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Errors Tab */}
        <TabsContent value="errors">
          <Card className="bg-[#0B0F1A] border-slate-800 shadow-xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-4 bg-[#111827]">
              <div>
                <CardTitle className="text-white text-lg font-bold">System Error Analytics</CardTitle>
                <CardDescription className="text-slate-400">Comprehensive overview of real-time system anomalies</CardDescription>
              </div>
              <Button
                variant="outline"
                onClick={() => navigate("/dev/support")}
                className="bg-transparent border-slate-700 text-slate-300 hover:text-white hidden sm:flex"
                size="sm"
              >
                View All Detailed Logs
              </Button>
            </div>
            <CardContent className="p-6 space-y-6 bg-[#0B0F1A]">

              {/* Row 1: Interactive Summary Cards */}
              <div className="grid gap-4 md:grid-cols-5">
                {[
                  { key: null, label: "Total Logs", value: processedErrorStats.total, color: "text-white", border: "border-slate-800 hover:border-slate-600", bg: "bg-[#1F2937]/20 hover:bg-[#1F2937]/40" },
                  { key: "critical", label: "Critical", value: processedErrorStats.critical, color: "text-red-400", border: processedErrorStats.critical > 0 ? "border-red-900/50 hover:border-red-500/50" : "border-slate-800 hover:border-slate-600", bg: processedErrorStats.critical > 0 ? "bg-red-950/20 hover:bg-red-950/40" : "bg-[#1F2937]/20 hover:bg-[#1F2937]/40", activeBorder: "border-red-500 bg-red-950/40" },
                  { key: "error", label: "Errors", value: processedErrorStats.errors, color: "text-red-500", border: processedErrorStats.errors > 0 ? "border-red-900/30 hover:border-red-500/30" : "border-slate-800 hover:border-slate-600", bg: processedErrorStats.errors > 0 ? "bg-red-950/10 hover:bg-red-950/30" : "bg-[#1F2937]/20 hover:bg-[#1F2937]/40", activeBorder: "border-red-400 bg-red-950/30" },
                  { key: "warning", label: "Warnings", value: processedErrorStats.warnings, color: "text-yellow-500", border: processedErrorStats.warnings > 0 ? "border-yellow-900/30 hover:border-yellow-500/30" : "border-slate-800 hover:border-slate-600", bg: processedErrorStats.warnings > 0 ? "bg-yellow-950/10 hover:bg-yellow-950/30" : "bg-[#1F2937]/20 hover:bg-[#1F2937]/40", activeBorder: "border-yellow-400 bg-yellow-950/30" },
                  { key: "info", label: "Info", value: processedErrorStats.info, color: "text-blue-400", border: processedErrorStats.info > 0 ? "border-blue-900/30 hover:border-blue-500/30" : "border-slate-800 hover:border-slate-600", bg: processedErrorStats.info > 0 ? "bg-blue-950/10 hover:bg-blue-950/30" : "bg-[#1F2937]/20 hover:bg-[#1F2937]/40", activeBorder: "border-blue-400 bg-blue-950/30" },
                ].map((stat, i) => {
                  const isActive = selectedLevelFilter === stat.key;
                  const isZero = stat.value === 0;
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedLevelFilter(stat.key)}
                      className={cn(
                        "p-4 rounded-lg border text-center transition-all cursor-pointer flex flex-col justify-center items-center h-full",
                        isActive ? (stat.activeBorder || "border-slate-500 bg-[#1F2937]/40") : stat.border,
                        isActive ? "" : stat.bg,
                        isZero && !isActive ? "opacity-60" : ""
                      )}
                    >
                      <p className={cn("text-3xl font-bold", isZero && !isActive ? "text-slate-400" : stat.color)}>{stat.value}</p>
                      <p className={cn("text-xs font-bold uppercase tracking-widest mt-1", isZero && !isActive ? "text-slate-500" : stat.color.replace('text-', 'text-').replace('400', '500/70').replace('500', '500/60'))}>{stat.label}</p>
                    </button>
                  );
                })}
                <Button
                  variant="outline"
                  onClick={() => navigate("/dev/support")}
                  className="bg-transparent border-slate-700 text-slate-300 hover:text-white sm:hidden w-full mt-2"
                >
                  View All Detailed Logs
                </Button>
              </div>

              {/* Row 2: 24-Hour Trend Chart */}
              <div className="bg-[#111827] border border-slate-800 rounded-lg p-6 relative h-[300px] flex flex-col">
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4 flex-none">24-Hour Event Trend</h3>
                <div className="flex-1 min-h-0 relative">
                  {processedErrorStats.total === 0 ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none opacity-50 z-10">
                      <p className="text-slate-500 font-medium bg-[#111827] px-4 rounded-full border border-slate-800 shadow-sm py-1">No data for this period</p>
                    </div>
                  ) : null}
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={processedErrorStats.chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} />
                      <RechartsTooltip
                        contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '8px' }}
                        itemStyle={{ fontSize: '12px' }}
                        labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
                      />
                      <Bar dataKey="critical" stackId="a" fill="#ef4444" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="error" stackId="a" fill="#f97316" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="warning" stackId="a" fill="#eab308" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="info" stackId="a" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Row 3: Insights */}
              <div className="grid lg:grid-cols-2 gap-6">

                {/* Top Issues */}
                <div className="bg-[#111827] border border-slate-800 rounded-lg overflow-hidden flex flex-col h-[350px]">
                  <div className="p-4 border-b border-slate-800 bg-[#1F2937]/30 flex-none">
                    <h3 className="text-sm font-semibold text-slate-300">Top Issues {selectedLevelFilter ? `(${selectedLevelFilter})` : ""}</h3>
                  </div>
                  <div className="p-0 flex-1 overflow-y-auto w-full no-scrollbar">
                    {processedErrorStats.topIssues.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                        <ShieldCheck className="h-12 w-12 text-green-500/50 mb-3" />
                        <p className="text-green-400 font-medium">System Healthy</p>
                        <p className="text-xs text-slate-500 mt-1">Great job! No issues detected.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-800/50">
                        {processedErrorStats.topIssues.map((issue, idx) => (
                          <div key={idx} className="p-4 flex items-start gap-3 hover:bg-[#1F2937]/20 transition-colors">
                            <div className="mt-0.5 bg-slate-800 text-slate-400 text-xs font-bold px-2 py-0.5 rounded-md min-w-[32px] text-center">
                              {issue.count}
                            </div>
                            <p className="text-sm text-slate-300 font-mono break-all line-clamp-2">
                              {issue.message}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Recent Logs */}
                <div className="bg-[#111827] border border-slate-800 rounded-lg overflow-hidden flex flex-col h-[350px]">
                  <div className="p-4 border-b border-slate-800 bg-[#1F2937]/30 flex-none">
                    <h3 className="text-sm font-semibold text-slate-300">
                      Recent {selectedLevelFilter ? selectedLevelFilter.charAt(0).toUpperCase() + selectedLevelFilter.slice(1) : "Critical"} Logs
                    </h3>
                  </div>
                  <div className="p-0 flex-1 overflow-y-auto w-full no-scrollbar">
                    {processedErrorStats.recentLogs.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                        <ShieldCheck className="h-12 w-12 text-green-500/50 mb-3" />
                        <p className="text-green-400 font-medium">System Healthy</p>
                        <p className="text-xs text-slate-500 mt-1">Great job! No issues detected.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-800/50">
                        {processedErrorStats.recentLogs.map((log, idx: number) => (
                          <div key={idx} className="p-4 hover:bg-[#1F2937]/20 transition-colors flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                              {getStatusBadge(log.level)}
                              <span className="text-[10px] sm:text-xs text-slate-500 font-medium">
                                {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                              </span>
                            </div>
                            <p className="text-sm text-slate-300 font-mono break-all line-clamp-2">
                              {log.message}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

              </div>

            </CardContent>
          </Card>
        </TabsContent>

        {/* ── External APIs Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="apis" className="space-y-3">
          <Card className="bg-[#111827]/80 border-slate-800 shadow-xl overflow-hidden">

            {/* Header */}
            <CardHeader className="border-b border-slate-800 py-4 px-5">
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-bold text-white flex items-center gap-2">
                    <Activity className="h-5 w-5 text-blue-400" />
                    External Service Health
                  </CardTitle>
                </div>

                {/* Control bar */}
                <div className="flex flex-wrap items-center gap-4">
                  {/* Search */}
                  <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <Input placeholder="Search platform..." value={apiSearch}
                      onChange={e => { setApiSearch(e.target.value); setApiPage(1); }}
                      className="pl-9 h-9 text-sm bg-black/40 border-slate-800 text-white placeholder-slate-600 focus-visible:ring-1 focus-visible:ring-slate-700 rounded-lg" />
                  </div>

                  {/* Status pills */}
                  <div className="flex items-center gap-1 bg-black/20 p-1 rounded-full border border-slate-800">
                    <span className="text-[10px] text-slate-500 uppercase tracking-widest pl-2 pr-1 font-medium">Status</span>
                    {STATUS_PILLS.map(s => (
                      <button key={s} onClick={() => { setApiStatusFilter(s); setApiPage(1); }}
                        className={`text-xs font-medium px-3 py-1.5 rounded-full transition-all ${
                          apiStatusFilter === s ? STATUS_PILL_CLS[s] : 'text-slate-400 hover:text-slate-200'
                        }`}>{s}</button>
                    ))}
                  </div>

                  {/* Category pills */}
                  <div className="flex items-center gap-1 bg-black/20 p-1 rounded-full border border-slate-800">
                    <span className="text-[10px] text-slate-500 uppercase tracking-widest pl-2 pr-1 font-medium">Category</span>
                    {apiCategories.map(c => (
                      <button key={c} onClick={() => { setApiCategoryFilter(c); setApiPage(1); }}
                        className={`text-xs font-medium px-3 py-1.5 rounded-full transition-all ${
                          apiCategoryFilter === c ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                        }`}>{c}</button>
                    ))}
                  </div>
                </div>
              </div>
            </CardHeader>

            {/* Body */}
            <CardContent className="p-0">
              {apisLoading ? (
                <div className="py-16 text-center text-slate-500 text-sm">Probing endpoints…</div>
              ) : filteredApis.length === 0 ? (
                <div className="py-16 text-center text-slate-500 text-sm">No services match the current filters</div>
              ) : (

                /* ─ List/Table View ─ */
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-slate-800 bg-[#0D1117]/50">
                        <th className="px-5 py-4 font-semibold text-slate-400 tracking-wider">#</th>
                        <th className="px-5 py-4 font-semibold text-slate-400 uppercase tracking-wider">Platform</th>
                        <th className="px-5 py-4 font-semibold text-slate-400 uppercase tracking-wider">Category</th>
                        <th className="px-5 py-4 font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                        <th className="px-5 py-4 font-semibold text-slate-400 uppercase tracking-wider text-center">HTTP</th>
                        <th className="px-5 py-4 font-semibold text-slate-400 uppercase tracking-wider text-center">Latency</th>
                        <th className="px-5 py-4 font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap text-right">Last Check</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {pagedApis.map((api, idx) => (
                        <tr key={api.id}
                          className={`hover:bg-[#1F2937]/30 transition-colors ${ idx % 2 === 0 ? 'bg-transparent' : 'bg-[#0D1117]/20' }`}>
                          <td className="px-5 py-4 text-slate-500 tabular-nums">{(apiPage - 1) * API_PAGE_SIZE + idx + 1}</td>
                          <td className="px-5 py-4 font-semibold text-slate-200 whitespace-nowrap">{api.platform_name}</td>
                          <td className="px-5 py-4">
                            <span className="bg-slate-800/80 text-slate-400 text-[10px] px-2 py-1 rounded-sm uppercase tracking-wide font-medium">{api.category}</span>
                          </td>
                          <td className="px-5 py-4">
                            <Badge className={`text-[10px] font-bold px-2 py-0.5 shadow-none ${api.status.badgeCls}`}>
                              {api.status.label.toUpperCase()}
                            </Badge>
                          </td>
                          <td className={`px-5 py-4 font-mono text-center font-bold ${
                            api.last_status_code && api.last_status_code < 300 ? 'text-green-500' :
                            api.last_status_code && api.last_status_code < 500 ? 'text-yellow-500' : 'text-red-500'
                          }`}>{api.last_status_code ?? '---'}</td>
                          <td className={`px-5 py-4 font-mono text-center font-bold ${
                            !api.latency_ms ? 'text-slate-500' :
                            api.latency_ms < 500 ? 'text-green-500' :
                            api.latency_ms < 1000 ? 'text-yellow-500' : 'text-red-500'
                          }`}>{api.latency_ms ? `${api.latency_ms}ms` : '---'}</td>
                          <td className="px-5 py-4 font-mono text-slate-500 text-right whitespace-nowrap">
                            {format(new Date(), 'HH:mm:ss')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ─ Pagination ─ */}
              {totalApiPages > 1 && (
                <div className="flex items-center justify-between p-5 border-t border-slate-800 bg-[#0D1117]/30">
                  <span className="text-sm text-slate-500">
                    Showing {(apiPage - 1) * API_PAGE_SIZE + 1}–{Math.min(apiPage * API_PAGE_SIZE, filteredApis.length)} of {filteredApis.length}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setApiPage(p => Math.max(1, p - 1))} disabled={apiPage === 1}
                      className="p-1.5 rounded-md border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    {Array.from({ length: totalApiPages }, (_, i) => i + 1).map(p => (
                      <button key={p} onClick={() => setApiPage(p)}
                        className={`w-8 h-8 rounded-md text-sm font-medium transition-colors ${
                          p === apiPage ? 'bg-blue-600 text-white border border-blue-600' : 'border border-transparent text-slate-400 hover:bg-slate-800 hover:text-white'
                        }`}>{p}</button>
                    ))}
                    <button onClick={() => setApiPage(p => Math.min(totalApiPages, p + 1))} disabled={apiPage === totalApiPages}
                      className="p-1.5 rounded-md border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
