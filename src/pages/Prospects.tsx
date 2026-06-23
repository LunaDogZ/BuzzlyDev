import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Users,
  Plus,
  Smartphone,
  Loader2,
  LayoutGrid,
  UserCheck,
  Target,
  Activity,
  MapPin,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useOnboardingGuard } from "@/hooks/useOnboardingGuard";
import { OnboardingBanner } from "@/components/dashboard/OnboardingBanner";
import { useAdPersonas, type AdAudienceMode, type PersonaData } from "@/hooks/useAdPersonas";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useCustomerPersonas } from "@/hooks/useCustomerPersonas";
import { CreatePersonaDialog } from "@/components/persona/CreatePersonaDialog";
import { EditHeroPersonaDialog } from "@/components/persona/EditHeroPersonaDialog";
import { LocationMap } from "@/components/persona/LocationMap";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Camera, Pencil, type LucideIcon } from "lucide-react";
import { useWorkspaceAdPersona } from "@/hooks/useWorkspaceAdPersona";

const GENDER_COLORS: Record<string, string> = {
  Male: "#3B82F6",
  Female: "#EC4899",
  Other: "#F59E0B",
  "Unspecified": "#94A3B8",
  male: "#3B82F6",
  female: "#EC4899",
  unknown: "#94A3B8",
};

const DEVICE_COLORS: Record<string, string> = {
  mobile: "#3B82F6",
  desktop: "#10B981",
  tablet: "#F59E0B",
};

/**
 * /personas — Business Logic: Connect API → persona data flows in → display as graph.
 * Ad Audience tab: Shows aggregated audience data from connected ad platforms (ads.persona_data).
 * Gallery tab: Placeholder — build your own.
 */
export default function Prospects() {
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const { state: onboardingState } = useOnboardingGuard();

  const [activeTab, setActiveTab] = useState<"ad-audience" | "gallery">("ad-audience");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [adAudienceMode, setAdAudienceMode] = useState<AdAudienceMode>("all");
  const [selectedAdId, setSelectedAdId] = useState<string | undefined>();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | undefined>();

  const { campaigns } = useCampaigns();
  const { createPersona, genders } = useCustomerPersonas(workspace.id);
  const { persona: savedPersona, upsertPersona, ensurePersonaFromApi } = useWorkspaceAdPersona(workspace.id);
  const [showEditHeroDialog, setShowEditHeroDialog] = useState(false);
  const { personaData: adPersonaData, isLoading: adPersonaLoading, adsWithPersona, totalImpressions, isFallbackData } = useAdPersonas({
    mode: adAudienceMode,
    adId: selectedAdId,
    campaignId: selectedCampaignId,
  });

  const displayStats = useMemo(() => {
    let mainDevice = "N/A";
    let primaryInterest = "N/A";
    let topLocation = "N/A";
    let topAgeRange = "25-34";

    if (adPersonaData) {
      const deviceEntries = Object.entries(adPersonaData.device_type);
      if (deviceEntries.length > 0) {
        const top = deviceEntries.reduce((a, b) => (a[1] > b[1] ? a : b))[0];
        mainDevice = top.charAt(0).toUpperCase() + top.slice(1);
      }
      if (adPersonaData.interests.length > 0) primaryInterest = adPersonaData.interests[0].name;
      if (adPersonaData.top_locations.length > 0) topLocation = adPersonaData.top_locations[0].name;
      const ageEntries = Object.entries(adPersonaData.age_distribution ?? {});
      if (ageEntries.length > 0) {
        topAgeRange =
          ageEntries.reduce((a, b) => (a[1] > b[1] ? a : b))[0];
      }
    }

    return {
      activeProfiles: adsWithPersona.length,
      topLocation,
      mainDevice,
      primaryInterest,
      topAgeRange,
    };
  }, [adPersonaData, adsWithPersona.length]);

  const heroPersona = useMemo(() => {
    const { topLocation, mainDevice, primaryInterest, topAgeRange } = displayStats;
    const title =
      topLocation !== "N/A"
        ? `Modern ${topLocation} Professional`
        : "Your Audience Persona";
    const bioParts: string[] = [];
    if (topAgeRange) bioParts.push(`Age ${topAgeRange}`);
    if (mainDevice !== "N/A") bioParts.push(`highly active on ${mainDevice}`);
    if (primaryInterest !== "N/A") bioParts.push(`prioritizes ${primaryInterest} trends`);
    const bio = bioParts.length > 0 ? bioParts.join(", ") + "." : "Connect ad platforms to see your audience come to life.";
    return { title, bio };
  }, [displayStats]);

  const displayPersona = useMemo(() => ({
    title: savedPersona?.custom_title ?? heroPersona.title,
    bio: savedPersona?.custom_bio ?? heroPersona.bio,
    avatarUrl: savedPersona?.avatar_url ?? null,
  }), [savedPersona, heroPersona]);

  useEffect(() => {
    if (adsWithPersona.length > 0 && heroPersona.title && savedPersona === null) {
      ensurePersonaFromApi.mutate({ title: heroPersona.title, bio: heroPersona.bio });
    }
  }, [adsWithPersona.length, heroPersona.title, heroPersona.bio, savedPersona]);

  if (workspaceLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="text-sm font-medium text-muted-foreground animate-pulse">Loading...</p>
      </div>
    );
  }

  if (onboardingState !== "ready") {
    return <OnboardingBanner state={onboardingState} />;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 p-4 md:p-8 font-sans">
      {/* Header with Hero Persona Card */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch border-b border-border/60 pb-8">
        {/* Hero Persona Card — left side, premium feel. Right-click to add image or edit. */}
        {adsWithPersona.length > 0 && (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <Card className="lg:w-[400px] shrink-0 rounded-2xl border-0 overflow-hidden shadow-lg shadow-primary/5 bg-gradient-to-br from-card via-card to-primary/[0.03] relative cursor-context-menu">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary/60 to-primary/30 rounded-l-2xl" />
                <CardContent className="p-6 flex items-center gap-5 pl-7">
                  <div className="h-20 w-20 shrink-0 rounded-full overflow-hidden ring-2 ring-primary/20 bg-muted">
                    {displayPersona.avatarUrl ? (
                      <img
                        src={displayPersona.avatarUrl}
                        alt="Persona avatar"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <img
                        src="/persona-avatar-default.svg"
                        alt="Persona avatar"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xl font-extrabold tracking-tight text-foreground truncate">
                      {displayPersona.title}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                      {displayPersona.bio}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
              <ContextMenuItem onClick={() => setShowEditHeroDialog(true)}>
                <Camera className="h-4 w-4 mr-2" />
                Add or change image
              </ContextMenuItem>
              <ContextMenuItem onClick={() => setShowEditHeroDialog(true)}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit name or details
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )}
        <div className="flex-1 space-y-1 flex flex-col justify-center">
          <div className="flex items-center gap-2 text-muted-foreground font-semibold text-xs uppercase tracking-widest">
            <Target className="h-4 w-4" /> Audience Intelligence
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-foreground">Customer Personas</h1>
          <p className="text-sm text-muted-foreground">
            Connect your ad platforms to see audience data flow in and display as graphs.
          </p>
        </div>
      </div>

      {/* Bento Grid — Audience Summary Cards (asymmetric layout) */}
      {adsWithPersona.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <BentoStatCard label="Ads with Data" value={displayStats.activeProfiles} icon={Users} tint="bg-cyan-500/10" iconClass="text-cyan-600 dark:text-cyan-400" />
          <BentoStatCard label="Top Location" value={displayStats.topLocation} icon={MapPin} tint="bg-emerald-500/10" iconClass="text-emerald-600 dark:text-emerald-400" />
          <BentoStatCard label="Main Device" value={displayStats.mainDevice} icon={Smartphone} tint="bg-violet-500/10" iconClass="text-violet-600 dark:text-violet-400" />
          <BentoStatCard label="Primary Interest" value={displayStats.primaryInterest} icon={UserCheck} tint="bg-amber-500/10" iconClass="text-amber-600 dark:text-amber-400" />
        </div>
      )}

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "ad-audience" | "gallery")} className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <TabsList className="bg-muted/40 p-1.5 rounded-xl border border-border/40">
            <TabsTrigger value="ad-audience" className="rounded-lg gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm">
              <Activity className="h-4 w-4" /> Ad Audience
            </TabsTrigger>
            <TabsTrigger value="gallery" className="rounded-lg gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm">
              <LayoutGrid className="h-4 w-4" /> Gallery
            </TabsTrigger>
          </TabsList>

          {activeTab === "ad-audience" && (
            <div className="flex flex-wrap items-center gap-3">
              <Select
                value={adAudienceMode}
                onValueChange={(v) => {
                  setAdAudienceMode(v as AdAudienceMode);
                  setSelectedAdId(undefined);
                  setSelectedCampaignId(undefined);
                }}
              >
                <SelectTrigger className="w-[180px] rounded-xl bg-muted/50 border-none">
                  <SelectValue placeholder="Select scope" />
                </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Ads</SelectItem>
                <SelectItem value="ad">Specific Ad</SelectItem>
                <SelectItem value="campaign">Specific Campaign</SelectItem>
              </SelectContent>
            </Select>

            {adAudienceMode === "ad" && (
              <Select value={selectedAdId} onValueChange={setSelectedAdId}>
                <SelectTrigger className="w-[260px] rounded-xl bg-muted/50 border-none">
                  <SelectValue placeholder="Select an ad…" />
                </SelectTrigger>
                <SelectContent>
                  {adsWithPersona.map((ad) => (
                    <SelectItem key={ad.id} value={ad.id}>
                      <span className="font-medium">{ad.name}</span>
                      {ad.platform && (
                        <span className="ml-2 text-xs text-muted-foreground capitalize">{ad.platform}</span>
                      )}
                    </SelectItem>
                  ))}
                  {adsWithPersona.length === 0 && (
                    <SelectItem value="__none" disabled>
                      No ads with audience data
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            )}

            {adAudienceMode === "campaign" && (
              <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
                <SelectTrigger className="w-[260px] rounded-xl bg-muted/50 border-none">
                  <SelectValue placeholder="Select a campaign…" />
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                  {campaigns.length === 0 && (
                    <SelectItem value="__none" disabled>
                      No campaigns found
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            )}
            </div>
          )}
        </div>

        {/* ── AD AUDIENCE TAB: API → persona data → graph ── */}
        <TabsContent value="ad-audience" className="space-y-6 animate-in fade-in duration-500">
          {adPersonaLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : !adPersonaData ? (
            <Card className="border-2 border-dashed bg-muted/20 rounded-3xl">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Activity className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h3 className="text-lg font-bold mb-1">No Audience Data</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  {adAudienceMode === "ad" && !selectedAdId
                    ? "Select an ad above to view its audience breakdown."
                    : adAudienceMode === "campaign" && !selectedCampaignId
                      ? "Select a campaign above to view its audience breakdown."
                      : "Connect a platform via API Keys to import ad audience data."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {isFallbackData && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
                  <strong>Sample data.</strong> Connect your ad platform via API Keys to import your real audience data.
                </div>
              )}
              <AdAudienceCharts data={adPersonaData} totalImpressions={totalImpressions} />
            </div>
          )}
        </TabsContent>

        {/* ── GALLERY TAB: Placeholder — build your own ── */}
        <TabsContent value="gallery" className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
          <div className="flex justify-end">
            <Button onClick={() => setShowCreateDialog(true)} className="rounded-xl shadow-lg shadow-primary/20 gap-2 px-6">
              <Plus className="h-4 w-4" /> Create Persona
            </Button>
          </div>
          <Card className="border-2 border-dashed bg-muted/20 rounded-3xl">
            <CardContent className="flex flex-col items-center justify-center py-20 text-center">
              <LayoutGrid className="h-16 w-16 text-muted-foreground/40 mb-4" />
              <h3 className="text-xl font-bold mb-2">Gallery</h3>
              <p className="text-muted-foreground max-w-md">
                Build your own gallery here. This area is reserved for your custom implementation.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <CreatePersonaDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSubmit={(data) =>
          createPersona.mutate(data, {
            onSuccess: () => setShowCreateDialog(false),
          })
        }
        teamId={workspace.id}
        genders={genders ?? []}
        isLoading={createPersona.isPending}
        isOwner
      />

      {adsWithPersona.length > 0 && (
        <EditHeroPersonaDialog
          open={showEditHeroDialog}
          onOpenChange={setShowEditHeroDialog}
          initialTitle={displayPersona.title}
          initialBio={displayPersona.bio}
          initialAvatarUrl={displayPersona.avatarUrl}
          workspaceId={workspace.id}
          onSave={(data) =>
            upsertPersona.mutate(data)
          }
          isSaving={upsertPersona.isPending}
        />
      )}
    </div>
  );
}

// Age Distribution: Deep Indigo → Electric Blue gradient (more dramatic)
const AGE_GRADIENT = { start: "#1e1b4b", end: "#0ea5e9" };
const AGE_HIGHLIGHT = "#6366f1"; // Indigo highlight for peak bar
const AGE_HIGHLIGHT_GLOW = "#818cf8"; // Lighter glow
// Top interest (index 0) = darkest/most prominent; lower interests = lighter
const LAVENDER_PALETTE = ["#5b21b6", "#6d28d9", "#7c3aed", "#8b5cf6", "#a78bfa", "#c4b5fd"];

// ── Ad Audience Charts ──────────────────────────────────────────────────────
function AdAudienceCharts({ data, totalImpressions = 0 }: { data: PersonaData; totalImpressions?: number }) {
  const ageData = Object.entries(data.age_distribution ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => ({ name, value: Math.round(value * 100) }));

  const maxAgeValue = ageData.length > 0 ? Math.max(...ageData.map((d) => d.value)) : 0;

  const genderData = Object.entries(data.gender ?? {}).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value: Math.round(value * 100),
  }));

  const interestData = (data.interests ?? []).map((i) => ({
    name: i.name,
    value: Math.round(i.pct * 100),
  }));

  const deviceData = Object.entries(data.device_type ?? {}).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value: Math.round(value * 100),
  }));

  return (
    <div className="space-y-6">
      {/* Row 1: Age + Gender */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 rounded-3xl border border-border/40 shadow-md shadow-primary/5 bg-card overflow-hidden">
          <CardHeader>
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Age Distribution
            </CardTitle>
            <CardDescription className="text-sm">Audience breakdown by age group</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ageData} margin={{ bottom: 4 }}>
                  <defs>
                    <linearGradient id="ageGradient" x1="0" y1="1" x2="0" y2="0">
                      <stop offset="0%" stopColor={AGE_GRADIENT.start} />
                      <stop offset="100%" stopColor={AGE_GRADIENT.end} />
                    </linearGradient>
                    <filter id="ageHighlight" x="-30%" y="-30%" width="160%" height="160%">
                      <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor={AGE_HIGHLIGHT_GLOW} floodOpacity="0.5" />
                      <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor={AGE_HIGHLIGHT} floodOpacity="0.3" />
                    </filter>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 500 }} />
                  <YAxis hide />
                  <Tooltip
                    cursor={{ fill: "transparent" }}
                    contentStyle={{ borderRadius: "12px", border: "none" }}
                    formatter={(v: number) => [`${v}%`, "Share"]}
                  />
                  <Bar
                    dataKey="value"
                    radius={[8, 8, 0, 0]}
                    barSize={36}
                    shape={(props: { x?: number; y?: number; width?: number; height?: number; payload?: { value: number }; fill?: string }) => {
                      const isHighlight = props.payload?.value === maxAgeValue && maxAgeValue > 0;
                      return (
                        <rect
                          x={props.x}
                          y={props.y}
                          width={props.width}
                          height={props.height}
                          fill={isHighlight ? AGE_HIGHLIGHT : "url(#ageGradient)"}
                          filter={isHighlight ? "url(#ageHighlight)" : undefined}
                          rx={8}
                          ry={8}
                        />
                      );
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1 rounded-3xl border border-border/40 shadow-md shadow-primary/5 bg-card overflow-hidden">
          <CardHeader>
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Gender Split
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative h-[200px] flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={genderData} innerRadius={55} outerRadius={80} paddingAngle={4} dataKey="value">
                    {genderData.map((entry, i) => (
                      <Cell key={i} fill={GENDER_COLORS[entry.name] ?? "#8b5cf6"} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [`${v}%`, "Share"]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="rounded-full bg-gradient-to-br from-primary/15 to-primary/5 p-3.5 ring-2 ring-primary/10">
                  <User className="h-6 w-6 text-primary/70" strokeWidth={1.5} />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 mt-2">
              {genderData.map((item) => (
                <div key={item.name} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="h-2 w-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: GENDER_COLORS[item.name] ?? "#8b5cf6" }}
                    />
                    <span className="text-xs font-semibold truncate">{item.name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">{item.value}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Interests + Device */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 rounded-3xl border border-border/40 shadow-md shadow-primary/5 bg-card overflow-hidden">
          <CardHeader>
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Top Interests
            </CardTitle>
            <CardDescription className="text-sm">Interest categories weighted by ad impressions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={interestData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 500 }} width={140} />
                  <Tooltip
                    cursor={{ fill: "transparent" }}
                    contentStyle={{ borderRadius: "12px", border: "none" }}
                    formatter={(v: number) => [`${v}%`, "Affinity"]}
                  />
                  <Bar
                    dataKey="value"
                    radius={[0, 999, 999, 0]}
                    barSize={22}
                    fill={LAVENDER_PALETTE[0]}
                    shape={(props: { x?: number; y?: number; width?: number; height?: number; index?: number }) => {
                      const i = props.index ?? 0;
                      const colorIndex = Math.min(i, LAVENDER_PALETTE.length - 1);
                      return (
                        <rect
                          x={props.x}
                          y={props.y}
                          width={props.width}
                          height={props.height}
                          fill={LAVENDER_PALETTE[colorIndex]}
                          rx={999}
                          ry={999}
                        />
                      );
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1 rounded-3xl border border-border/40 shadow-md shadow-primary/5 bg-card overflow-hidden">
          <CardHeader>
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Device Type
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative h-[200px] flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={deviceData} innerRadius={55} outerRadius={80} paddingAngle={4} dataKey="value">
                    {deviceData.map((entry, i) => (
                      <Cell key={i} fill={DEVICE_COLORS[entry.name.toLowerCase()] ?? "#94A3B8"} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [`${v}%`, "Share"]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="rounded-full bg-gradient-to-br from-primary/15 to-primary/5 p-3.5 ring-2 ring-primary/10">
                  <Smartphone className="h-6 w-6 text-primary/70" strokeWidth={1.5} />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 mt-2">
              {deviceData.map((item) => (
                <div key={item.name} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="h-2 w-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: DEVICE_COLORS[item.name.toLowerCase()] ?? "#94A3B8" }}
                    />
                    <span className="text-xs font-semibold truncate">{item.name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">{item.value}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Geographic Map — Where they live */}
      <Card className="rounded-3xl border border-border/40 shadow-md shadow-primary/5 bg-card overflow-hidden">
        <CardHeader>
          <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Where they live
          </CardTitle>
          <CardDescription className="text-sm">Geographic reach — darker color means more users</CardDescription>
        </CardHeader>
        <CardContent>
          <LocationMap locations={data.top_locations ?? []} totalImpressions={totalImpressions} />
        </CardContent>
      </Card>
    </div>
  );
}

function BentoStatCard({
  label,
  value,
  icon: Icon,
  tint,
  iconClass,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tint: string;
  iconClass: string;
}) {
  return (
    <Card className="group border border-border/40 bg-card/80 backdrop-blur-sm shadow-sm hover:shadow-md hover:border-border/60 rounded-2xl overflow-hidden transition-all duration-300">
      <CardContent className="p-5 flex items-center gap-4">
        <div className={`p-3.5 rounded-xl ${tint} shrink-0 transition-transform duration-300 group-hover:scale-105`}>
          <Icon className={`h-5 w-5 ${iconClass}`} strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
          <p className="text-lg font-extrabold text-foreground truncate tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
