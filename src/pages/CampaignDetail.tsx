import { useParams, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Pause,
  Play,
  Download,
  DollarSign,
  TrendingUp,
  Eye,
  MousePointer,
  Target,
  Users,
  Calendar,
  Clock,
  CalendarDays,
  Megaphone,
  Loader2,
  Tag,
  Plus,
  X,
  BarChart2,
  Image,
  FileText,
  ExternalLink,
  MoreHorizontal,
  Trash2,
  BarChart3,
  Settings2,
  CheckCircle2,
} from "lucide-react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCampaigns, calculateCampaignProgress, type CampaignWithInsights } from "@/hooks/useCampaigns";
import { useCampaignInsights } from "@/hooks/useAdInsights";
import { useCampaignAdsAndPosts } from "@/hooks/useCampaignAdsAndPosts";
import { useAds } from "@/hooks/useAds";
import { AdAllocator } from "@/components/campaigns/AdAllocator";
import { useTags, useCampaignTags } from "@/hooks/useTags";
import { useState, useMemo } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { format } from "date-fns";

const statusStyles: Record<string, string> = {
  active: "bg-success/10 text-success border-success/20",
  scheduled: "bg-info/10 text-info border-info/20",
  paused: "bg-warning/10 text-warning border-warning/20",
  draft: "bg-muted text-muted-foreground border-muted",
  completed: "bg-primary/10 text-primary border-primary/20",
};


export default function CampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { campaigns, isLoading, updateCampaign } = useCampaigns();

  // Real daily insights from ad_insights table
  const { dailyInsights, isLoading: insightsLoading } = useCampaignInsights(id);

  // Ads and posts in this campaign
  const campaignAdIds = useMemo(
    () => (campaigns.find((c) => c.id === id) as CampaignWithInsights | undefined)?.ad_ids ?? [],
    [campaigns, id]
  );
  const { ads: campaignAds, posts: campaignPosts, isLoading: adsPostsLoading } = useCampaignAdsAndPosts(id, campaignAdIds);

  // Tags
  const { tags, createTag, assignTagToCampaign, removeTagFromCampaign } = useTags("campaign");
  const { data: campaignTags = [], isLoading: tagsLoading } = useCampaignTags(id ?? null);

  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#6366f1");
  const [manageAdsOpen, setManageAdsOpen] = useState(false);
  const [managedAdIds, setManagedAdIds] = useState<string[]>([]);

  const { updateAd } = useAds();
  type ChartMetric = "impressions" | "reach" | "clicks" | "conversions" | "spend";
  const chartMetrics: ChartMetric[] = ["impressions", "reach", "clicks", "conversions", "spend"];
  const [chartMetric, setChartMetric] = useState<ChartMetric>("clicks");

  // Find campaign by ID
  const campaign = useMemo(() => {
    return campaigns.find((c) => c.id === id);
  }, [campaigns, id]);

  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const status = localStatus ?? campaign?.status ?? "draft";

  const campaignTagIds = new Set(campaignTags.map((t) => t.id));

  // Chart data — must be before early returns (hooks rule)
  const chartData = useMemo(() => {
    return dailyInsights.map((d) => ({
      day: format(new Date(d.date), "MMM d"),
      impressions: d.impressions,
      reach: d.reach,
      clicks: d.clicks,
      conversions: d.conversions,
      spend: d.spend,
    }));
  }, [dailyInsights]);

  const handleToggleTag = async (tagId: string) => {
    if (!id) return;
    if (campaignTagIds.has(tagId)) {
      await removeTagFromCampaign.mutateAsync({ campaignId: id, tagId });
    } else {
      await assignTagToCampaign.mutateAsync({ campaignId: id, tagId });
    }
  };

  const handleRemoveAdFromCampaign = async (adId: string) => {
    if (!id) return;
    const newIds = campaignAdIds.filter((aid) => aid !== adId);
    await updateCampaign.mutateAsync({ id, updates: {}, adIds: newIds });
    toast.success("Ad removed from campaign");
  };

  const handleToggleAdStatus = async (ad: { id: string; status: string | null }) => {
    const newStatus = ad.status === "active" ? "paused" : "active";
    await updateAd.mutateAsync({ id: ad.id, updates: { status: newStatus } });
    toast.success(`Ad ${newStatus === "active" ? "resumed" : "paused"}`);
  };

  const openManageAds = () => {
    setManagedAdIds([...campaignAdIds]);
    setManageAdsOpen(true);
  };

  const handleSaveManagedAds = async () => {
    if (!id) return;
    await updateCampaign.mutateAsync({ id, updates: {}, adIds: managedAdIds });
    setManageAdsOpen(false);
    toast.success("Campaign ads updated");
  };

  const handleCreateAndAddTag = async () => {
    if (!newTagName.trim() || !id) return;
    const tag = await createTag.mutateAsync({
      name: newTagName.trim(),
      color_code: newTagColor,
      entity_type: "campaign",
    });
    if (tag) {
      await assignTagToCampaign.mutateAsync({ campaignId: id, tagId: tag.id });
    }
    setNewTagName("");
    setNewTagColor("#6366f1");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] space-y-4">
        <Megaphone className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Campaign not found</h2>
        <Button onClick={() => navigate("/campaigns")}>
          Back to Campaigns
        </Button>
      </div>
    );
  }

  const progressResult = calculateCampaignProgress(campaign);

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const handleToggleStatus = async () => {
    const newStatus = status === "active" ? "paused" : "active";
    setLocalStatus(newStatus);
    await updateCampaign.mutateAsync({ id: campaign.id, updates: { status: newStatus } });
    toast.success(`Campaign ${newStatus === "active" ? "resumed" : "paused"}`);
  };

  const ctr = campaign.impressions > 0
    ? ((campaign.clicks / campaign.impressions) * 100).toFixed(2)
    : "0";

  const metrics = [
    { title: "Impressions", value: formatNumber(campaign.impressions), icon: Eye, color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-100" },
    { title: "Reach", value: formatNumber(campaign.reach), icon: Users, color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-100" },
    { title: "Clicks", value: formatNumber(campaign.clicks), icon: MousePointer, color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-100" },
    { title: "Conversions", value: formatNumber(campaign.conversions), icon: Target, color: "text-rose-600", bg: "bg-rose-50", border: "border-rose-100" },
    { title: "Spend", value: `฿${campaign.spend.toFixed(0)}`, icon: DollarSign, color: "text-cyan-600", bg: "bg-cyan-50", border: "border-cyan-100" },
    { title: "CTR", value: `${ctr}%`, icon: TrendingUp, color: "text-violet-600", bg: "bg-violet-50", border: "border-violet-100" },
  ];

  const hasChartData = chartData.length > 0;

  return (
    <div className="space-y-8 p-4 md:p-8 bg-gradient-to-b from-slate-50/80 to-blue-50/30 dark:bg-background">
      {/* Header — refined, integrated */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg shrink-0 border border-slate-100 bg-white/80 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:bg-white hover:border-slate-200"
            onClick={() => navigate("/campaigns")}
          >
            <ArrowLeft className="h-4 w-4 text-slate-600" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <Badge
                variant="outline"
                className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-md border ${statusStyles[status] || statusStyles.draft} ${status === "active" ? "animate-pulse-soft" : ""}`}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </Badge>
              <span className="text-xs text-muted-foreground">{campaign.objective || "Conversion"}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{campaign.name}</h1>
            <div className="flex items-center gap-5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-slate-400" />
                {campaign.start_date
                  ? new Date(campaign.start_date).toLocaleDateString("th-TH")
                  : "TBD"} – {campaign.end_date
                    ? new Date(campaign.end_date).toLocaleDateString("th-TH")
                    : "TBD"}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-slate-400" />
                Budget: ฿{campaign.budget_amount?.toLocaleString() || 0}
              </span>
            </div>

            {/* Tag Chips */}
            <div className="flex items-center gap-2 mt-4 flex-wrap">
              {tagsLoading ? (
                <span className="text-xs text-muted-foreground">Loading tags...</span>
              ) : (
                campaignTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: tag.color_code }}
                  >
                    {tag.name}
                    <button
                      onClick={() => handleToggleTag(tag.id)}
                      className="ml-0.5 hover:opacity-70 transition-opacity"
                      aria-label={`Remove tag ${tag.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))
              )}

              {/* Add Tag Popover */}
              <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-6 px-2 text-xs gap-1">
                    <Tag className="h-3 w-3" />
                    + Tag
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3" align="start">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">EXISTING TAGS</p>
                  <div className="flex flex-col gap-1 max-h-36 overflow-y-auto mb-3">
                    {tags.length === 0 && (
                      <p className="text-xs text-muted-foreground">No tags yet</p>
                    )}
                    {tags.map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => handleToggleTag(tag.id)}
                        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted text-sm text-left transition-colors"
                      >
                        <span
                          className="h-3 w-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: tag.color_code }}
                        />
                        <span className="flex-1 truncate">{tag.name}</span>
                        {campaignTagIds.has(tag.id) && (
                          <span className="text-xs text-success font-medium">✓</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">CREATE NEW TAG</p>
                  <div className="flex gap-2 mb-2">
                    <Input
                      placeholder="Tag name"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      className="h-7 text-xs"
                      onKeyDown={(e) => e.key === "Enter" && handleCreateAndAddTag()}
                    />
                    <input
                      type="color"
                      value={newTagColor}
                      onChange={(e) => setNewTagColor(e.target.value)}
                      className="h-7 w-7 rounded border cursor-pointer"
                      title="Pick color"
                    />
                  </div>
                  <Button
                    size="sm"
                    className="w-full h-7 text-xs gap-1"
                    onClick={handleCreateAndAddTag}
                    disabled={!newTagName.trim() || createTag.isPending}
                  >
                    <Plus className="h-3 w-3" />
                    Create & Add
                  </Button>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
        <div className="flex gap-2 sm:shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 rounded-lg border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
            onClick={() => toast.info("Export coming soon")}
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
          {status !== "completed" && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 rounded-lg border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
              onClick={handleToggleStatus}
              disabled={updateCampaign.isPending}
            >
              {updateCampaign.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : status === "active" ? (
                <>
                  <Pause className="h-3.5 w-3.5" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 fill-current" />
                  Activate
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Campaign Progress — Timeline visual */}
      <Card className="rounded-xl bg-white border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardContent className="p-8">
          <div className="flex items-center gap-2 mb-6">
            <CalendarDays className="h-4 w-4 text-slate-400" />
            <span className="text-sm font-semibold text-slate-900">Campaign Progress</span>
            {progressResult.overallProgress >= 100 && (
              <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs font-medium">Complete</Badge>
            )}
          </div>

          {/* Timeline bar — shows when we are in the campaign period */}
          {campaign.start_date && campaign.end_date ? (
            <div className="mb-6">
              <div className="relative h-3 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-teal-500 transition-all duration-300"
                  style={{ width: `${progressResult.timeProgress}%` }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white border-2 border-teal-500 shadow-sm z-10"
                  style={{ left: `${progressResult.timeProgress}%` }}
                  title="Today"
                />
              </div>
              <div className="flex justify-between mt-2 text-[10px] font-medium text-slate-500">
                <span>{format(new Date(campaign.start_date), "MMM d")}</span>
                <span className="text-teal-600 font-semibold">Today</span>
                <span>{format(new Date(campaign.end_date), "MMM d")}</span>
              </div>
            </div>
          ) : (
            <div className="mb-6">
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-teal-500 transition-all duration-300"
                  style={{ width: `${progressResult.timeProgress}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-2">Set start & end dates to see timeline</p>
            </div>
          )}

          {/* KPI Progress bars — individual, colors match Performance Over Time, thinner than Time bar */}
          {(() => {
            const kpiItems: { label: string; actual: number; target: number; barColor: string; textColor: string }[] = [];
            const c = campaign as CampaignWithInsights & {
              target_kpi_clicks?: number | null;
              target_kpi_conversions?: number | null;
              target_kpi_spend?: number | null;
              target_kpi_impressions?: number | null;
              target_kpi_metric?: string | null;
              target_kpi_value?: number | null;
            };
            if ((c.target_kpi_clicks ?? 0) > 0) {
              kpiItems.push({ label: "Clicks", actual: c.clicks ?? 0, target: c.target_kpi_clicks!, barColor: "bg-amber-500", textColor: "text-amber-600" });
            }
            if ((c.target_kpi_conversions ?? 0) > 0) {
              kpiItems.push({ label: "Conversions", actual: c.conversions ?? 0, target: c.target_kpi_conversions!, barColor: "bg-rose-500", textColor: "text-rose-600" });
            }
            if ((c.target_kpi_spend ?? 0) > 0) {
              kpiItems.push({ label: "Spend", actual: c.spend ?? 0, target: c.target_kpi_spend!, barColor: "bg-cyan-500", textColor: "text-cyan-600" });
            }
            if ((c.target_kpi_impressions ?? 0) > 0) {
              kpiItems.push({ label: "Impressions", actual: c.impressions ?? 0, target: c.target_kpi_impressions!, barColor: "bg-blue-500", textColor: "text-blue-600" });
            }
            if (kpiItems.length === 0 && c.target_kpi_metric && (c.target_kpi_value ?? 0) > 0) {
              const KPI_MAP: Record<string, { label: string; actual: number; barColor: string; textColor: string }> = {
                clicks: { label: "Clicks", actual: c.clicks ?? 0, barColor: "bg-amber-500", textColor: "text-amber-600" },
                conversions: { label: "Conversions", actual: c.conversions ?? 0, barColor: "bg-rose-500", textColor: "text-rose-600" },
                spend: { label: "Spend", actual: c.spend ?? 0, barColor: "bg-cyan-500", textColor: "text-cyan-600" },
                impressions: { label: "Impressions", actual: c.impressions ?? 0, barColor: "bg-blue-500", textColor: "text-blue-600" },
              };
              const def = KPI_MAP[c.target_kpi_metric];
              if (def) kpiItems.push({ ...def, target: c.target_kpi_value! });
            }
            if (kpiItems.length === 0) return null;
            return (
              <div className="mb-6 space-y-3">
                {kpiItems.map((item) => {
                  const pct = item.target > 0 ? Math.min(100, Math.round((item.actual / item.target) * 100)) : 0;
                  const isComplete = pct >= 100;
                  return (
                    <div key={item.label}>
                      <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest mb-1">
                        <span className={cn("font-medium", item.textColor)}>{item.label}</span>
                        <span className="flex items-center gap-1.5">
                          {isComplete && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                          <span className={cn("font-mono shrink-0", item.textColor)}>{pct}%</span>
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all duration-300", item.barColor)}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* Summary badges */}
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Time</span>
              <span className="font-mono text-sm font-bold text-teal-600">{progressResult.timeProgress}%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 truncate max-w-[120px]">{progressResult.kpiLabel}</span>
              <span className="font-mono text-sm font-bold text-indigo-600">{progressResult.kpiProgress}%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Overall</span>
              <span className="font-mono text-sm font-bold text-slate-900">{progressResult.overallProgress}%</span>
            </div>
          </div>

          {(campaign.ad_ids?.length ?? 0) > 0 && (
            <p className="text-xs text-slate-400 mt-4 flex items-center gap-1.5 font-medium">
              <Megaphone className="h-3 w-3" />
              {campaign.ad_ids?.length} ad{campaign.ad_ids?.length !== 1 ? "s" : ""} assigned
            </p>
          )}
        </CardContent>
      </Card>

      {/* Performance Over Time */}
      <Card className="rounded-xl bg-white border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader className="px-8 !pt-4 pb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <CardTitle className="text-base font-semibold text-slate-900">Performance Over Time</CardTitle>
            <Tabs
              value={chartMetric}
              onValueChange={(v) => setChartMetric(v as ChartMetric)}
              className="w-full sm:w-auto"
            >
              <TabsList className="inline-flex items-center rounded-full bg-slate-100/80 p-1 border border-slate-100 h-9">
                {chartMetrics.map((m) => (
                  <TabsTrigger
                    key={m}
                    value={m}
                    className="rounded-full px-3 py-1.5 text-xs font-medium text-slate-500 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm transition-all"
                  >
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          {/* Metric summary — clear boxes with color accents */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4 pt-4 border-t border-slate-100">
            {metrics.map((metric) => (
              <div
                key={metric.title}
                className={cn(
                  "flex flex-col gap-1.5 rounded-lg border px-3 py-2.5",
                  metric.bg,
                  metric.border,
                )}
              >
                <div className="flex items-center gap-1.5">
                  <div className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/70", metric.color)}>
                    <metric.icon className="h-3.5 w-3.5" />
                  </div>
                  <span className={cn("text-[10px] font-bold uppercase tracking-wider truncate", metric.color)}>
                    {metric.title}
                  </span>
                </div>
                <span className={cn("font-mono text-sm font-bold tabular-nums", metric.color)}>{metric.value}</span>
              </div>
            ))}
          </div>
        </CardHeader>
        <CardContent className="px-8 pb-8">
            {insightsLoading ? (
              <div className="h-[300px] flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !hasChartData ? (
              <div className="h-[300px] flex flex-col items-center justify-center gap-3 text-center border border-dashed border-slate-100 rounded-xl bg-slate-50/30">
                <BarChart2 className="h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm font-medium text-muted-foreground">No daily insights yet</p>
                <p className="text-xs text-muted-foreground/60 max-w-[200px]">
                  Daily performance data will appear here once ad insights are recorded for this campaign.
                </p>
              </div>
            ) : (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="chart-area-fill-detail" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.08} />
                        <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                    <Tooltip
                      formatter={(value: number | string, name: string) => {
                        if (name === "Spend") return [`฿${Number(value).toFixed(2)}`, name];
                        if (name === "Ctr" || name === "Cpc" || name === "Cpm" || name === "Roas") return [`${Number(value).toFixed(2)}`, name];
                        const valNum = Number(value);
                        if (valNum >= 1000000) return [`${(valNum / 1000000).toFixed(1)}M`, name];
                        if (valNum >= 1000) return [`${(valNum / 1000).toFixed(1)}K`, name];
                        return [valNum.toLocaleString(), name];
                      }}
                      contentStyle={{
                        backgroundColor: "rgba(255,255,255,0.98)",
                        backdropFilter: "blur(8px)",
                        color: "#0f172a",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                        padding: "8px 12px",
                        fontSize: "12px",
                        fontFamily: "JetBrains Mono, ui-monospace, monospace",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                      }}
                      labelStyle={{ fontWeight: 600, marginBottom: 4, color: "#64748b" }}
                      cursor={{ stroke: "#e2e8f0", strokeWidth: 1 }}
                    />
                    <Area
                      type="monotone"
                      dataKey={chartMetric}
                      name={chartMetric.charAt(0).toUpperCase() + chartMetric.slice(1)}
                      stroke="#06b6d4"
                      strokeWidth={2}
                      fill="url(#chart-area-fill-detail)"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
      </Card>

      {/* Ads & Posts in this Campaign */}
      {(campaignAdIds.length > 0) && (
        <Card className="rounded-xl bg-white border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <CardHeader className="px-8 pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <Megaphone className="h-4 w-4 text-slate-500" />
                  Ads & Posts in this Campaign
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Ads and posts included in this campaign
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 shrink-0 rounded-lg"
                onClick={openManageAds}
              >
                <Settings2 className="h-3.5 w-3.5" />
                Manage Ads
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-8 pb-8">
            {adsPostsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : campaignAds.length === 0 && campaignPosts.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground border border-dashed rounded-xl bg-slate-50/50">
                No ads or posts found for this campaign.
              </div>
            ) : (
              <div className="space-y-6">
                {campaignAds.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                      <Image className="h-3.5 w-3.5" />
                      Ads ({campaignAds.length})
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {campaignAds.map((ad) => (
                        <div
                          key={ad.id}
                          className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-100/50 transition-colors group"
                        >
                          {ad.creative_url || (ad.media_urls?.[0]) ? (
                            <img
                              src={ad.creative_url ?? ad.media_urls?.[0] ?? ""}
                              alt=""
                              className="h-12 w-12 rounded-lg object-cover shrink-0 bg-slate-200"
                            />
                          ) : (
                            <div className="h-12 w-12 rounded-lg bg-slate-200 flex items-center justify-center shrink-0">
                              <Megaphone className="h-5 w-5 text-slate-400" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm truncate">{ad.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {ad.ad_groups?.name ?? ad.platform ?? "—"}
                            </p>
                            <div className="flex items-center gap-1.5 mt-1">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px] px-1.5 py-0 capitalize",
                                  ad.status === "active" && "border-emerald-500/30 text-emerald-600",
                                  ad.status === "paused" && "border-amber-500/30 text-amber-600",
                                  ad.status === "draft" && "border-slate-300 text-slate-500"
                                )}
                              >
                                {ad.status ?? "draft"}
                              </Badge>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                            {(ad.status === "active" || ad.status === "paused") && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-lg"
                                onClick={() => handleToggleAdStatus(ad)}
                                disabled={updateAd.isPending}
                              >
                                {updateAd.isPending ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : ad.status === "active" ? (
                                  <Pause className="h-3.5 w-3.5" />
                                ) : (
                                  <Play className="h-3.5 w-3.5 fill-current" />
                                )}
                              </Button>
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg">
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48 rounded-xl p-2">
                                <DropdownMenuItem
                                  onClick={() => navigate("/social/analytics")}
                                  className="rounded-lg"
                                >
                                  <BarChart3 className="h-4 w-4 mr-2" />
                                  View in Social Analytics
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => handleRemoveAdFromCampaign(ad.id)}
                                  className="text-destructive rounded-lg"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Remove from campaign
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {campaignPosts.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5" />
                      Posts ({campaignPosts.length})
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {campaignPosts.map((post) => (
                        <div
                          key={post.id}
                          className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-100/50 transition-colors"
                        >
                          {post.media_urls?.[0] ? (
                            <img
                              src={post.media_urls[0]}
                              alt=""
                              className="h-12 w-12 rounded-lg object-cover shrink-0 bg-slate-200"
                            />
                          ) : (
                            <div className="h-12 w-12 rounded-lg bg-slate-200 flex items-center justify-center shrink-0">
                              <FileText className="h-5 w-5 text-slate-400" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm truncate">
                              {post.name ?? post.content?.slice(0, 40) ?? "Untitled"}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {post.ad_groups?.name ?? post.post_channel ?? "—"}
                            </p>
                            <div className="flex items-center gap-1.5 mt-1">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px] px-1.5 py-0",
                                  post.status === "published" && "border-emerald-500/30 text-emerald-600",
                                  post.status === "scheduled" && "border-blue-500/30 text-blue-600",
                                  post.status === "draft" && "border-slate-300 text-slate-500"
                                )}
                              >
                                {post.status ?? "draft"}
                              </Badge>
                            </div>
                          </div>
                          {post.post_url && (
                            <a
                              href={post.post_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 p-1.5 rounded-lg hover:bg-slate-200/50 text-muted-foreground hover:text-foreground transition-colors"
                              aria-label="Open post"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Manage Ads Dialog */}
      <Dialog open={manageAdsOpen} onOpenChange={setManageAdsOpen}>
        <DialogContent className="sm:max-w-[540px] rounded-[2rem] p-0 overflow-hidden border-none shadow-2xl">
          <DialogHeader className="p-8 pb-0">
            <div className="flex items-center gap-3 text-primary mb-1">
              <div className="h-8 w-8 rounded-xl bg-primary/10 flex items-center justify-center">
                <Settings2 className="h-4 w-4" />
              </div>
              <DialogTitle className="text-2xl font-black tracking-tight">Manage Ads</DialogTitle>
            </div>
            <DialogDescription className="text-slate-500 font-medium ml-11">
              Add or remove ads from this campaign. Changes are saved when you click Save.
            </DialogDescription>
          </DialogHeader>
          <div className="px-8 py-6">
            <AdAllocator value={managedAdIds} onChange={setManagedAdIds} />
          </div>
          <DialogFooter className="p-6 bg-slate-50/80 border-t flex sm:justify-between items-center gap-4">
            <Button 
              variant="ghost" 
              onClick={() => setManageAdsOpen(false)}
              className="rounded-xl px-6 hover:bg-slate-200/50 font-bold"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveManagedAds}
              disabled={updateCampaign.isPending}
              className="rounded-xl px-8 bg-cyan-500 hover:bg-cyan-600 shadow-lg shadow-cyan-500/30 border-none transition-all hover:scale-[1.02] active:scale-95 font-black"
            >
              {updateCampaign.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
