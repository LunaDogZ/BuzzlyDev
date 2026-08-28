import { useEffect, useMemo, useRef } from "react";
import { Link2, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { logError } from "@/services/errorLogger";
import { usePlatformConnections } from "@/hooks/usePlatformConnections";
import { readOAuthReturn } from "@/lib/metaOAuth";
import { useSyncHistory } from "@/hooks/useSyncHistory";
import { useLoyaltyTier } from "@/hooks/useLoyaltyTier";
import { PlatformConnectionCard } from "@/components/social/integrations/PlatformConnectionCard";
import { SyncHistoryTable } from "@/components/social/integrations/SyncHistoryTable";
import { Skeleton } from "@/components/ui/skeleton";

function PlatformGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-border/40 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex items-start gap-3">
            <Skeleton className="h-11 w-11 rounded-xl shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3.5 w-16 rounded-full" />
            </div>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-8 w-full rounded-md mt-2" />
        </div>
      ))}
    </div>
  );
}

export default function SocialIntegrations() {
  const {
    platforms,
    loading,
    connectPlatform,
    disconnectPlatform,
    updatePlatformToken,
    refreshPlatformStatus,
    completeMetaOAuth,
    connectPlatformOAuth,
  } = usePlatformConnections();

  const { entries: syncEntries, isLoading: syncLoading, error: syncError } = useSyncHistory();

  // ── Return leg from Meta ──────────────────────────────────────────────────
  // meta-oauth sends the browser back here with ?connect=facebook&status=...
  // The guard is a ref rather than state: React 18's StrictMode mounts effects
  // twice in development, and without it the merchant sees every toast twice and
  // the sync runs twice. The params are stripped once handled so a refresh — or
  // a shared URL — does not replay the whole thing.
  const oauthHandled = useRef(false);
  useEffect(() => {
    if (oauthHandled.current) return;
    const ret = readOAuthReturn(window.location.search);
    if (!ret) return;
    oauthHandled.current = true;

    window.history.replaceState({}, "", window.location.pathname);
    void (async () => {
      try {
        await completeMetaOAuth(ret);
        if (ret.status === "connected") await refetchLoyalty();
      } catch (err) {
        logError("SocialIntegrations.completeMetaOAuth", err);
        toast.error("เชื่อมต่อ Meta ไม่สำเร็จ กรุณาลองอีกครั้ง");
      }
    })();
    // completeMetaOAuth is recreated on every provider render; depending on it
    // would re-run this effect, and the ref would then be the only thing
    // stopping a loop. Running once on mount is the actual intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { refetch: refetchLoyalty } = useLoyaltyTier();

  const stats = useMemo(() => {
    const connected = platforms.filter((p) => p.status === "connected").length;
    const errored = platforms.filter((p) => p.status === "error").length;
    const disconnected = platforms.filter((p) => p.status === "disconnected").length;
    return { connected, errored, disconnected, total: platforms.length };
  }, [platforms]);

  if (syncError) {
    logError("SocialIntegrations.useSyncHistory", syncError);
  }

  const handleConnect = async (id: string, apiKey?: string): Promise<boolean> => {
    try {
      const success = await connectPlatform(id, apiKey);
      if (success) await refetchLoyalty();
      return success;
    } catch (err) {
      logError("SocialIntegrations.handleConnect", err);
      toast.error("ไม่สามารถเชื่อมต่อได้ กรุณาลองอีกครั้ง");
      return false;
    }
  };

  const handleDisconnect = async (id: string): Promise<boolean> => {
    try {
      return await disconnectPlatform(id);
    } catch (err) {
      logError("SocialIntegrations.handleDisconnect", err);
      toast.error("ไม่สามารถยกเลิกการเชื่อมต่อได้ กรุณาลองอีกครั้ง");
      return false;
    }
  };

  const handleUpdateToken = async (id: string, token: string): Promise<boolean> => {
    try {
      return await updatePlatformToken(id, token);
    } catch (err) {
      logError("SocialIntegrations.handleUpdateToken", err);
      toast.error("ไม่สามารถอัปเดต API Key ได้ กรุณาลองอีกครั้ง");
      return false;
    }
  };

  const handleRefresh = async (id: string): Promise<void> => {
    try {
      await refreshPlatformStatus(id);
    } catch (err) {
      logError("SocialIntegrations.handleRefresh", err);
      toast.error("ไม่สามารถรีเฟรชสถานะได้ กรุณาลองอีกครั้ง");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
            การเชื่อมต่อแพลตฟอร์ม
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            จัดการการเชื่อมต่อ API และซิงค์ข้อมูลจากแพลตฟอร์มโฆษณา
          </p>
        </div>

        {/* Summary stats */}
        {!loading && platforms.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-foreground font-medium">{stats.connected}</span>
              <span className="text-muted-foreground">เชื่อมต่อ</span>
            </div>
            {stats.errored > 0 && (
              <div className="flex items-center gap-1.5 text-sm">
                <AlertCircle className="h-4 w-4 text-red-500" />
                <span className="text-foreground font-medium">{stats.errored}</span>
                <span className="text-muted-foreground">ข้อผิดพลาด</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-sm">
              <XCircle className="h-4 w-4 text-muted-foreground" />
              <span className="text-foreground font-medium">{stats.disconnected}</span>
              <span className="text-muted-foreground">ยังไม่เชื่อมต่อ</span>
            </div>
          </div>
        )}
      </div>

      {/* Platform grid */}
      {loading ? (
        <PlatformGridSkeleton />
      ) : platforms.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center dark:border-slate-700 dark:bg-slate-900">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
            <Link2 className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">ไม่พบแพลตฟอร์ม</p>
            <p className="text-xs text-muted-foreground mt-1">
              ยังไม่มีแพลตฟอร์มที่ใช้งานอยู่ในระบบ
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {platforms.map((platform) => (
            <PlatformConnectionCard
              key={platform.id}
              platform={platform}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              onRefresh={handleRefresh}
              onUpdateToken={handleUpdateToken}
              // Only Facebook has a real handshake today. Passing it for every
              // platform would offer merchants a button that cannot work.
              onOAuthConnect={platform.slug === "facebook" ? connectPlatformOAuth : undefined}
            />
          ))}
        </div>
      )}

      {/* Sync history */}
      <SyncHistoryTable entries={syncEntries} isLoading={syncLoading} />
    </div>
  );
}
