import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Key,
  Eye,
  EyeOff,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Link2,
  FlaskConical,
  MoreVertical,
  Plus,
  Filter,
  ArrowUpDown,
  Building2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePlatformConnections } from "@/hooks/usePlatformConnections";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { KEYS_BY_PLATFORM } from "@/lib/mockApiKeys";
import { useSyncHistory } from "@/hooks/useSyncHistory";
import { SyncHistoryTable } from "@/components/social/integrations/SyncHistoryTable";
import { readOAuthReturn } from "@/lib/metaOAuth";
import { logError } from "@/services/errorLogger";
import type { Platform } from "@/hooks/usePlatformConnections";
import { TH_DATE_LOCALE } from "@/lib/date";
import { isConnectablePlatform, IMPORT_ONLY_ROUTE_TH } from "@/constants/platformSupport";

const statusConfig = {
  connected: {
    label: "Active",
    icon: CheckCircle2,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
  error: {
    label: "System Error",
    icon: XCircle,
    color: "text-destructive",
    bg: "bg-destructive/10",
    border: "border-destructive/20",
  },
  disconnected: {
    label: "Inactive",
    icon: AlertCircle,
    color: "text-muted-foreground",
    bg: "bg-muted",
    border: "border-border",
  },
};

/**
 * What each card says it does.
 *
 * Only the Meta line describes a connection, because only Meta has one. The
 * other four used to open with "Connect …" and list the analytics they would
 * sync, which read as a promise the product could not keep — the merchant found
 * out after opening the card and pressing the button. They now name the route
 * their data actually takes.
 */
const PLATFORM_DESCRIPTIONS: Record<string, string> = {
  facebook: "เชื่อมต่อ Facebook Ads เพื่อดึงข้อมูลแคมเปญ ผลโฆษณา และกลุ่มเป้าหมายอัตโนมัติ",
  instagram: `Instagram ${IMPORT_ONLY_ROUTE_TH}`,
  tiktok: `TikTok Ads ${IMPORT_ONLY_ROUTE_TH}`,
  shopee: `Shopee ${IMPORT_ONLY_ROUTE_TH}`,
  google: `Google Ads ${IMPORT_ONLY_ROUTE_TH}`,
};

export default function APIKeys() {
  const navigate = useNavigate();
  const { workspace, loading: workspaceLoading, hasTeam } = useWorkspace();
  const {
    platforms,
    loading: platformsLoading,
    connectPlatform,
    disconnectPlatform,
    updatePlatformToken,
    refreshPlatformStatus,
    refetch,
    connectPlatformOAuth,
    completeMetaOAuth,
  } = usePlatformConnections();
  const { members = [] } = useWorkspaceMembers();
  const { entries: syncEntries, isLoading: syncLoading, error: syncError } = useSyncHistory();

  const [editingPlatformId, setEditingPlatformId] = useState<string | null>(null);
  const [visibleTokens, setVisibleTokens] = useState<string[]>([]);
  const [newToken, setNewToken] = useState("");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [openFormId, setOpenFormId] = useState<string | null>(null);
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [sortBy, setSortBy] = useState<"name" | "status" | "lastSync">("name");

  useEffect(() => {
    refetch();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Return leg from Meta ──────────────────────────────────────────────────
  // meta-oauth sends the browser back to whichever page started the flow, and
  // this is that page: `connectPlatformOAuth` passes window.location.href as the
  // return URL, so the params land here as ?connect=facebook&status=...
  //
  // The guard is a ref rather than state: StrictMode mounts effects twice in
  // development, and without it the merchant sees every toast twice and the sync
  // runs twice. The params are stripped once handled so a refresh — or a URL
  // pasted to a colleague — does not replay it.
  const oauthHandled = useRef(false);
  useEffect(() => {
    if (oauthHandled.current) return;
    const ret = readOAuthReturn(window.location.search);
    if (!ret) return;
    oauthHandled.current = true;

    window.history.replaceState({}, "", window.location.pathname);
    void completeMetaOAuth(ret).catch((err) => {
      logError("APIKeys.completeMetaOAuth", err);
      toast.error("เชื่อมต่อ Meta ไม่สำเร็จ กรุณาลองอีกครั้ง");
    });
    // completeMetaOAuth is recreated on every provider render; depending on it
    // would re-run this effect and the ref would be the only thing stopping a
    // loop. Running once on mount is the actual intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (syncError) logError("APIKeys.useSyncHistory", syncError);

  const isLoading = workspaceLoading || platformsLoading;

  if (isLoading) return <LoadingState />;

  const categories = ["All", ...Array.from(new Set(platforms.map((p) => p.category_name || "Other").filter(Boolean)))];
  const filteredPlatforms = platforms
    .filter((p) => categoryFilter === "All" || (p.category_name || "Other") === categoryFilter)
    .sort((a, b) => {
      // Create a shallow copy array effect conceptually by returning new sorted order
      if (sortBy === "name") {
        return (a.name || "").localeCompare(b.name || "");
      }
      if (sortBy === "status") {
        const order = { connected: 1, error: 2, disconnected: 3 };
        return order[a.status] - order[b.status];
      }
      if (sortBy === "lastSync") {
        const dateA = a.lastSync ? new Date(a.lastSync).getTime() : 0;
        const dateB = b.lastSync ? new Date(b.lastSync).getTime() : 0;
        return dateB - dateA; // Newest first
      }
      return 0;
    });

  const connectedPlatforms = filteredPlatforms.filter((p) => p.status === "connected");
  const inactivePlatforms = filteredPlatforms.filter((p) => p.status !== "connected");

  return (
    <div className="space-y-6">
      {/* 0. NO WORKSPACE BANNER */}
      {!hasTeam && (
        <Card className="border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/10">
          <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20">
                <Building2 className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Create your workspace first</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  You need a workspace before connecting platforms. Go to Settings to create one.
                </p>
              </div>
            </div>
            <Button
              onClick={() => navigate("/settings?tab=manage-workspace")}
              className="shrink-0"
            >
              <Building2 className="h-4 w-4 mr-2" />
              Create Workspace
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 1. PAGE HEADER — Apps integration style */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
            <Key className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
            <p className="text-sm text-muted-foreground">Manage platform integrations and credentials</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => navigate("/settings")}>Workspace Settings</DropdownMenuItem>
              <DropdownMenuItem onClick={() => document.getElementById("integrations-list")?.scrollIntoView({ behavior: "smooth" })}>
                View Integrations
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            {members.slice(0, 4).map((m) => (
              <Avatar key={m.id} className="h-8 w-8 border-2 border-background">
                <AvatarFallback className="text-[10px] bg-muted">
                  {(m.fullName || m.email || "?").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ))}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5 rounded-lg">
                <Filter className="h-3.5 w-3.5" />
                Filter
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setCategoryFilter("All")}>All categories</DropdownMenuItem>
              {categories.filter((c) => c !== "All").map((c) => (
                <DropdownMenuItem key={c} onClick={() => setCategoryFilter(c)}>
                  {c}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5 rounded-lg">
                <ArrowUpDown className="h-3.5 w-3.5" />
                Sort by
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setSortBy("name")}>Name</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("status")}>Status</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("lastSync")}>Last sync</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 2. SECTION TITLE + CATEGORY PILLS */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">API Keys</h2>
        <ScrollArea className="w-full whitespace-nowrap">
          <div className="flex gap-2 pb-2">
            {categories.map((cat) => (
              <Button
                key={cat}
                variant={categoryFilter === cat ? "secondary" : "ghost"}
                size="sm"
                className={cn(
                  "rounded-full shrink-0",
                  categoryFilter === cat && "bg-muted-foreground/15 text-foreground"
                )}
                onClick={() => setCategoryFilter(cat)}
              >
                {cat}
              </Button>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      {/* 3. INTEGRATIONS — sectioned: connected first, then available */}
      <div id="integrations-list" className="space-y-8">
        {filteredPlatforms.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* Connected — expanded cards at top */}
            {connectedPlatforms.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Connected ({connectedPlatforms.length})
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {connectedPlatforms.map((platform) => (
                    <IntegrationCard
                      key={platform.id}
                      platform={platform}
                      hasTeam={hasTeam}
                      visibleTokens={visibleTokens}
                      setVisibleTokens={setVisibleTokens}
                      openFormId={openFormId}
                      setOpenFormId={setOpenFormId}
                      apiKeyInputs={apiKeyInputs}
                      setApiKeyInputs={setApiKeyInputs}
                      connecting={connecting}
                      editingPlatformId={editingPlatformId}
                      setEditingPlatformId={setEditingPlatformId}
                      newToken={newToken}
                      setNewToken={setNewToken}
                      onConnect={handleConnect}
                      onUpdateKey={handleUpdateKey}
                      onDeleteKey={handleDeleteKey}
                      onRefreshStatus={handleRefreshStatus}
                      onOAuthConnect={platform.slug === "facebook" ? handleOAuthConnect : undefined}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Available — compact grid */}
            {inactivePlatforms.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  {connectedPlatforms.length > 0 ? "Connect more" : "Available platforms"}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {inactivePlatforms.map((platform) => (
                    <IntegrationCard
                      key={platform.id}
                      platform={platform}
                      hasTeam={hasTeam}
                      visibleTokens={visibleTokens}
                      setVisibleTokens={setVisibleTokens}
                      openFormId={openFormId}
                      setOpenFormId={setOpenFormId}
                      apiKeyInputs={apiKeyInputs}
                      setApiKeyInputs={setApiKeyInputs}
                      connecting={connecting}
                      editingPlatformId={editingPlatformId}
                      setEditingPlatformId={setEditingPlatformId}
                      newToken={newToken}
                      setNewToken={setNewToken}
                      onConnect={handleConnect}
                      onUpdateKey={handleUpdateKey}
                      onDeleteKey={handleDeleteKey}
                      onRefreshStatus={handleRefreshStatus}
                      onOAuthConnect={platform.slug === "facebook" ? handleOAuthConnect : undefined}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 4. SYNC HISTORY — moved here when /social/integrations was removed */}
      <SyncHistoryTable entries={syncEntries} isLoading={syncLoading} />
    </div>
  );

  async function handleOAuthConnect(platformId: string) {
    if (!hasTeam) {
      toast.error("Please create a Workspace first", {
        description: "Go to Settings > Manage Workspace to create a Workspace before connecting a Platform",
      });
      return;
    }
    // Navigates away to Facebook and never resolves with the browser still on
    // this page, so nothing may be sequenced after it.
    await connectPlatformOAuth(platformId);
  }

  async function handleUpdateKey(platformId: string) {
    if (!newToken) return;
    await updatePlatformToken(platformId, newToken);
    setEditingPlatformId(null);
    setNewToken("");
  }

  async function handleDeleteKey(platformId: string) {
    await disconnectPlatform(platformId);
  }

  async function handleRefreshStatus(platformId: string) {
    await refreshPlatformStatus(platformId);
  }

  async function handleConnect(platformId: string) {
    if (!hasTeam) {
      toast.error("Please create a Workspace first", {
        description: "Go to Settings > Manage Workspace to create a Workspace before connecting a Platform",
      });
      return;
    }
    setConnecting(platformId);
    const key = apiKeyInputs[platformId]?.trim() || undefined;
    await connectPlatform(platformId, key);
    setConnecting(null);
    setOpenFormId(null);
    setApiKeyInputs((prev) => {
      const next = { ...prev };
      delete next[platformId];
      return next;
    });
  }
}

interface IntegrationCardProps {
  platform: Platform;
  hasTeam: boolean;
  visibleTokens: string[];
  setVisibleTokens: React.Dispatch<React.SetStateAction<string[]>>;
  openFormId: string | null;
  setOpenFormId: React.Dispatch<React.SetStateAction<string | null>>;
  apiKeyInputs: Record<string, string>;
  setApiKeyInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  connecting: string | null;
  editingPlatformId: string | null;
  setEditingPlatformId: React.Dispatch<React.SetStateAction<string | null>>;
  newToken: string;
  setNewToken: React.Dispatch<React.SetStateAction<string>>;
  onConnect: (id: string) => Promise<void>;
  onUpdateKey: (id: string) => Promise<void>;
  onDeleteKey: (id: string) => Promise<void>;
  onRefreshStatus: (id: string) => Promise<void>;
  /** Only passed for platforms that have a real handshake — today that is
   *  Facebook alone. Offering the button on TikTok or Shopee would be offering
   *  something that cannot work. */
  onOAuthConnect?: (id: string) => Promise<void>;
}

function IntegrationCard({
  platform,
  hasTeam,
  visibleTokens,
  setVisibleTokens,
  openFormId,
  setOpenFormId,
  apiKeyInputs,
  setApiKeyInputs,
  connecting,
  editingPlatformId,
  setEditingPlatformId,
  newToken,
  setNewToken,
  onConnect,
  onUpdateKey,
  onDeleteKey,
  onRefreshStatus,
  onOAuthConnect,
}: IntegrationCardProps) {
  const navigate = useNavigate();
  const status = statusConfig[platform.status];
  const isVisible = visibleTokens.includes(platform.id);
  const connectable = isConnectablePlatform(platform.slug);
  const description =
    PLATFORM_DESCRIPTIONS[platform.slug ?? ""] ?? `${platform.name} ${IMPORT_ONLY_ROUTE_TH}`;
  const isConnected = platform.status === "connected";

  return (
    <Card
      className={cn(
        "group overflow-hidden rounded-2xl border bg-card shadow-sm transition-all hover:shadow-md",
        isConnected && "min-h-[220px]"
      )}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white dark:bg-white/10 shadow-sm ring-1 ring-black/5 dark:ring-white/10 overflow-hidden p-2">
            {platform.icon ? (
              <platform.icon className="h-8 w-8 shrink-0" />
            ) : platform.icon_url ? (
              <img src={platform.icon_url} alt={platform.name} className="h-8 w-8 object-contain" />
            ) : (
              <Key className="h-8 w-8 text-muted-foreground" />
            )}
          </div>
          {platform.status === "connected" ? (
            <Badge className="shrink-0 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px] font-medium px-2 py-0.5">
              Active
            </Badge>
          ) : connectable ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-full border bg-background hover:bg-muted"
              onClick={() => setOpenFormId((prev) => (prev === platform.id ? null : platform.id))}
              disabled={connecting === platform.id}
              title={!hasTeam ? "Create workspace first" : undefined}
            >
              <Plus className="h-4 w-4" />
            </Button>
          ) : (
            /* No connector exists for this platform, so the card offers the route
               that does work instead of a "+" that opens a form ending in a
               refusal. */
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-full border bg-background hover:bg-muted"
              onClick={() => navigate("/imports")}
              title="ไปที่หน้านำเข้าข้อมูล"
            >
              <Upload className="h-4 w-4" />
            </Button>
          )}
        </div>

        <h3 className="font-semibold text-base mb-1">{platform.name}</h3>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{description}</p>

        <div className="flex flex-wrap gap-1.5 mb-4">
          <Badge variant="secondary" className="text-[10px] font-medium rounded-md">
            {platform.category_name || "Service"}
          </Badge>
          {/* "Inactive" invites a merchant to go and activate it. For a platform
              with no connector that is a dead end, so the badge names the route
              that exists rather than a state that cannot be reached. */}
          <Badge
            variant="outline"
            className={cn("text-[10px] rounded-md", connectable || isConnected ? status.color : "text-muted-foreground")}
          >
            {connectable || isConnected ? status.label : "นำเข้าไฟล์เท่านั้น"}
          </Badge>
        </div>

        {/* An OAuth connection has no token to show here on purpose — the token
            lives server-side in `platform_oauth_tokens`. Show what it IS
            connected to instead, so a connected card is not blank. */}
        {!platform.accessToken && platform.accountId && (
          <div className="space-y-1.5 mb-3">
            <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Connected account
            </Label>
            <div className="rounded-lg bg-muted/50 px-3 py-2">
              <code className="block truncate text-xs font-mono">{platform.accountId}</code>
              {platform.tokenExpiresAt && (
                <span className="text-[10px] text-muted-foreground">
                  หมดอายุ {new Date(platform.tokenExpiresAt).toLocaleDateString(TH_DATE_LOCALE, {
                    day: "2-digit", month: "short", year: "numeric",
                  })}
                </span>
              )}
            </div>
          </div>
        )}

        {platform.accessToken && (
          <div className="space-y-1.5 mb-3">
            <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Token</Label>
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
              <code className="flex-1 truncate text-xs font-mono">
                {isVisible ? platform.accessToken : "•".repeat(20)}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() =>
                  setVisibleTokens((prev) =>
                    isVisible ? prev.filter((i) => i !== platform.id) : [...prev, platform.id]
                  )
                }
              >
                {isVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        )}

        {openFormId === platform.id && platform.status !== "connected" && connectable && (
          <div className="space-y-2 pt-2 border-t">
            {!hasTeam && (
              <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                Create your workspace first to connect platforms.
              </p>
            )}
            {onOAuthConnect && (
              <div className="space-y-2">
                <Button
                  size="sm"
                  className="h-9 w-full"
                  onClick={() => void onOAuthConnect(platform.id)}
                  disabled={connecting === platform.id || !hasTeam}
                >
                  เชื่อมต่อด้วยบัญชี {platform.name}
                </Button>
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  คุณจะถูกพาไปยังหน้าอนุญาตของ {platform.name} แล้วกลับมาที่นี่ —
                  Buzzly ขอสิทธิ์อ่านข้อมูลโฆษณาเท่านั้น และไม่เก็บรหัสผ่านของคุณ
                </p>
                <div className="flex items-center gap-2 pt-0.5">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[10px] text-muted-foreground">หรือใช้ API Key (สำหรับนักพัฒนา)</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              </div>
            )}
            <Label className="text-[10px] font-medium text-muted-foreground uppercase">API Key</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Paste API key..."
                value={apiKeyInputs[platform.id] ?? ""}
                onChange={(e) => setApiKeyInputs((prev) => ({ ...prev, [platform.id]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && connecting !== platform.id && hasTeam && onConnect(platform.id)}
                className="h-9 text-xs rounded-lg"
                disabled={connecting === platform.id || !hasTeam}
              />
              <Button
                size="sm"
                className="h-9 shrink-0"
                onClick={() => onConnect(platform.id)}
                disabled={connecting === platform.id || !hasTeam}
              >
                {connecting === platform.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : "Connect"}
              </Button>
            </div>
            {import.meta.env.DEV && (KEYS_BY_PLATFORM[platform.slug ?? ""] ?? []).length > 0 && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-2 space-y-1">
                <p className="text-[10px] font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1">
                  <FlaskConical className="h-3 w-3" /> Dev keys
                </p>
                {(KEYS_BY_PLATFORM[platform.slug ?? ""] ?? []).map((hint) => (
                  <button
                    key={hint.key}
                    type="button"
                    className="block w-full text-left"
                    onClick={() => setApiKeyInputs((prev) => ({ ...prev, [platform.id]: hint.key }))}
                  >
                    <code className="text-[10px] text-amber-800 dark:text-amber-300 font-mono">{hint.key}</code>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {platform.status === "connected" && (
          <div className="flex items-center gap-1 pt-2 border-t">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onRefreshStatus(platform.id)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <EditAction
              platform={platform}
              handleUpdateKey={onUpdateKey}
              newToken={newToken}
              setNewToken={setNewToken}
              editingPlatformId={editingPlatformId}
              setEditingPlatformId={setEditingPlatformId}
            />
            <DeleteAction platform={platform} handleDeleteKey={onDeleteKey} />
          </div>
        )}

        {platform.error && (
          <div className="mt-2 p-2 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2">
            <XCircle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
            <p className="text-[10px] text-destructive">{platform.error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EditAction({
  platform,
  handleUpdateKey,
  newToken,
  setNewToken,
  editingPlatformId,
  setEditingPlatformId,
}: {
  platform: Platform;
  handleUpdateKey: (id: string) => Promise<void>;
  newToken: string;
  setNewToken: React.Dispatch<React.SetStateAction<string>>;
  editingPlatformId: string | null;
  setEditingPlatformId: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  return (
    <Dialog open={editingPlatformId === platform.id} onOpenChange={(open) => !open && setEditingPlatformId(null)}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingPlatformId(platform.id)}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Update credentials</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>New access token</Label>
            <Input
              type="password"
              value={newToken}
              onChange={(e) => setNewToken(e.target.value)}
              placeholder="Paste new key..."
              className="rounded-lg"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setEditingPlatformId(null)}>
            Cancel
          </Button>
          <Button onClick={() => handleUpdateKey(platform.id)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteAction({
  platform,
  handleDeleteKey,
}: {
  platform: Platform;
  handleDeleteKey: (id: string) => Promise<void>;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke access?</AlertDialogTitle>
          <AlertDialogDescription>
            This will disconnect {platform.name} and pause data sync.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => handleDeleteKey(platform.id)} className="bg-destructive hover:bg-destructive/90">
            Revoke
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <div className="flex gap-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-9 w-24 rounded-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-64 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-20 bg-muted/30 rounded-2xl border border-dashed flex flex-col items-center">
      <Link2 className="h-12 w-12 text-muted-foreground opacity-20 mb-4" />
      <p className="font-bold text-muted-foreground">No platforms available in this category.</p>
    </div>
  );
}
