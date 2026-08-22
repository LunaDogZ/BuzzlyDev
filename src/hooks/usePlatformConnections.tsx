import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { FacebookLogo, InstagramLogo, TikTokLogo, ShopeeLogo, GoogleLogo } from "@/components/icons/PlatformIcons";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { getErrorMessage } from "@/lib/utils";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { backendUrl, MOCK_API_BASE_URL } from "@/lib/mockApiKeys";
import { postValidateMockApiKey, type ValidateKeyPayload } from "@/lib/mockApiBackend";
import { invalidateSocialRealtimeQueries } from "@/lib/socialQueryInvalidation";
import { logAuditEvent } from "@/lib/auditLogger";
import { logError } from "@/services/errorLogger";

export type PlatformStatus = "connected" | "disconnected" | "error";

export interface Platform {
  id: string;
  name: string;
  slug: string;
  icon: React.ComponentType<{ className?: string }> | null;
  icon_url?: string | null;
  emoji?: string;
  status: PlatformStatus;
  lastSync?: string;
  accessToken?: string;
  error?: string;
  category_name?: string;
}

// Icon mapping for platforms
const platformIcons: Record<string, React.ComponentType<{ className?: string }> | null> = {
  facebook: FacebookLogo,
  instagram: InstagramLogo,
  tiktok: TikTokLogo,
  shopee: ShopeeLogo,
  google: GoogleLogo,
};

const platformEmojis: Record<string, string> = {
  tiktok: "🎵",
  shopee: "🛒",
  google: "🔍",
};

interface PlatformConnectionsContextType {
  platforms: Platform[];
  connectedPlatforms: Platform[];
  loading: boolean;
  connectPlatform: (id: string, apiKey?: string) => Promise<boolean>;
  disconnectPlatform: (id: string) => Promise<boolean>;
  updatePlatformToken: (id: string, token: string) => Promise<boolean>;
  refreshPlatformStatus: (id: string) => Promise<void>;
  getPlatformById: (id: string) => Platform | undefined;
  refetch: () => Promise<void>;
}

const PlatformConnectionsContext = createContext<PlatformConnectionsContextType | undefined>(undefined);

export function PlatformConnectionsProvider({ children }: { children: ReactNode }) {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamId, setTeamId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const connectedPlatforms = platforms.filter((p) => p.status === "connected");

  const invalidateConnectedData = async () => {
    await Promise.all([
      invalidateSocialRealtimeQueries(queryClient),
      queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
      queryClient.invalidateQueries({ queryKey: ["ad-accounts"] }),
      queryClient.invalidateQueries({ queryKey: ["ad-accounts-active-filter"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
      queryClient.invalidateQueries({ queryKey: ["ad_insights"] }),
      queryClient.invalidateQueries({ queryKey: ["ad_insights_funnel_totals"] }),
      queryClient.invalidateQueries({ queryKey: ["revenue-metrics-dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["customer-personas"] }),
      queryClient.invalidateQueries({ queryKey: ["sync_history"] }),
      queryClient.invalidateQueries({ queryKey: ["ad-personas-ads"] }),
      queryClient.invalidateQueries({ queryKey: ["ad-personas-insights"] }),
    ]);
  };

  // Fetch team ID and platforms from database
  const fetchPlatforms = async () => {
    try {
      setLoading(true);

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // Clear rather than just return: this provider outlives a session. It
        // mounts above the router, so it runs once signed-out on the landing
        // page and again on sign-out, and leaving the previous user's
        // platforms in state would show them to whoever logs in next.
        setPlatforms([]);
        setTeamId(null);
        setLoading(false);
        return;
      }

      // Get user's team
      let currentTeamId: string | null = null;

      // Check if user owns a workspace
      const { data: ownedWorkspace } = await supabase
        .from('workspaces')
        .select('id')
        .eq('owner_id', user.id)
        .maybeSingle();

      if (ownedWorkspace) {
        currentTeamId = ownedWorkspace.id;
      } else {
        // Check if user is a member of a workspace
        const { data: memberData } = await supabase
          .from('workspace_members')
          .select('team_id')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .maybeSingle();

        if (memberData) {
          currentTeamId = memberData.team_id;
        }
      }

      setTeamId(currentTeamId);

      // Fetch platforms from database (all 5 supported platforms)
      const ALLOWED_SLUGS = ['facebook', 'instagram', 'tiktok', 'shopee', 'google'];
      const { data: platformsData, error: platformsError } = await supabase
        .from('platforms')
        .select(`
          *,
          platform_categories(name)
        `)
        .eq('is_active', true)
        .in('slug', ALLOWED_SLUGS)
        .order('name');

      if (platformsError) throw platformsError;

      // Fetch connections for this team
      let connectionsMap: Record<string, Tables<"workspace_api_keys">> = {};
      if (currentTeamId) {
        const { data: connectionsData } = await supabase
          .from('workspace_api_keys')
          .select('*')
          .eq('team_id', currentTeamId);

        if (connectionsData) {
          connectionsData.forEach((conn) => {
            connectionsMap[conn.platform_id] = conn;
          });
        }
      }

      // Transform to Platform format
      const transformedPlatforms: Platform[] = (platformsData || []).map((p) => {
        const connection = connectionsMap[p.id];
        let status: PlatformStatus = 'disconnected';

        if (connection) {
          if (connection.error_message) {
            status = 'error';
          } else if (connection.is_active && (connection.access_token || connection.api_key_encrypted)) {
            status = 'connected';
          }
        }

        return {
          id: p.id, // Use UUID from DB, not slug
          slug: p.slug,
          name: p.name,
          icon: platformIcons[p.slug] || null,
          icon_url: p.icon_url,
          emoji: platformEmojis[p.slug],
          status,
          lastSync: connection?.last_synced_at
            ? new Date(connection.last_synced_at).toLocaleString()
            : undefined,
          accessToken: connection?.access_token,
          error: connection?.error_message,
          category_name: p.platform_categories?.name,
        };
      });

      setPlatforms(transformedPlatforms);
    } catch {
      toast.error("ไม่สามารถโหลดรายการแพลตฟอร์มได้");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlatforms();

    // Re-fetch when the session changes. This provider wraps the whole router,
    // so its first and only mount happens on the public landing page, before
    // anyone has signed in: `getUser()` returns null, the fetch bails, and
    // without this listener nothing would ever load the platform list again.
    // `connectedPlatforms` would stay empty for the rest of the session and
    // `useOnboardingGuard` would answer "no_platform", so every merchant who
    // had just logged in was shown "Connect an Ad Platform" instead of their
    // dashboard — including merchants with a live connection and years of data.
    // Only a manual reload fixed it, because that remounts with a session
    // already restored from storage.
    //
    // Same shape the other session-scoped providers already use (PlanContext,
    // useLoyaltyTier): refetch on every auth event, including SIGNED_OUT, which
    // the clear above turns into a reset.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchPlatforms();
    });

    // Re-fetch when workspace is created (dispatched from useWorkspace.createWorkspace)
    // Using window events is more reliable than realtime for same-session state updates
    const onWorkspaceCreated = () => {
      // Retry a few times to handle any auth token propagation delay
      fetchPlatforms();
      setTimeout(() => fetchPlatforms(), 800);
      setTimeout(() => fetchPlatforms(), 2000);
    };
    window.addEventListener('workspace-created', onWorkspaceCreated);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('workspace-created', onWorkspaceCreated);
    };
  }, []);


  // Connect platform — with optional API key for real data ingestion
  const connectPlatform = async (id: string, apiKey?: string): Promise<boolean> => {
    if (!teamId) {
      toast.error('กรุณาสร้าง Workspace ก่อน');
      return false;
    }

    try {
      const platform = platforms.find(p => p.id === id);
      let tenant: string | null = null;
      // Decided by the server, never inferred here: a live Meta connection and
      // a Facebook fixture connection share the slug `facebook`, so the slug
      // cannot tell them apart. Only the server knows whether a key selects a
      // real connector, and the two are ingested by different endpoints.
      let isLiveConnection = false;
      const accessToken = apiKey?.trim() || `oauth_${platform?.slug || 'key'}_${Date.now().toString(36)}`;

      // ── Step 1: Validate the API key against the backend ──────────
      if (apiKey?.trim()) {
        toast.info('กำลังตรวจสอบ API Key...');
        const validated = await postValidateMockApiKey(apiKey.trim(), platform?.slug);
        if (!validated.ok) {
          // strictNullChecks is off in this project, so narrow the discriminated union explicitly.
          const failed = validated as { ok: false; userMessage: string; detail?: string };
          toast.error(failed.userMessage, {
            description: failed.detail
              ? `${failed.detail} · URL: ${MOCK_API_BASE_URL ?? 'ไม่ได้ตั้งค่า'}`
              : (MOCK_API_BASE_URL ?? 'ไม่ได้ตั้งค่า VITE_BACKEND_API_URL'),
          });
          return false;
        }
        const validation = (validated as { ok: true; validation: ValidateKeyPayload }).validation;
        if (!validation.valid) {
          toast.error(`API Key ไม่ถูกต้อง: ${validation.error ?? 'Unknown key'}`);
          return false;
        }
        tenant = validation.tenant ?? null;
        isLiveConnection = validation.live === true;
        toast.info(
          isLiveConnection
            ? `พบ ${validation.shopLabel}${validation.adAccountId ? ` (${validation.adAccountId})` : ''} · กำลังดึงข้อมูลจริง...`
            : `พบ ${validation.shopLabel} · กำลังนำเข้าข้อมูล...`
        );
      } else {
        toast.info(`กำลังเชื่อมต่อ ${platform?.name}...`);
        await new Promise(resolve => setTimeout(resolve, 800));
      }

      // ── Step 2: Save connection record (sync_status=pending) ──────
      const { error: keyError } = await supabase
        .from('workspace_api_keys')
        .upsert({
          team_id: teamId,
          platform_id: id,
          access_token: accessToken,
          sync_status: 'pending',
          is_active: true,
          last_synced_at: new Date().toISOString(),
          error_message: null,
        }, { onConflict: 'team_id,platform_id' });

      if (keyError) {
        throw keyError;
      }

      // ── Step 3: Ensure ad_account exists, get its ID ──────────────
      await supabase
        .from('ad_accounts')
        .upsert({
          team_id: teamId,
          platform_id: id,
          account_name: `${platform?.name || 'Platform'} Account`,
          is_active: true,
        }, { onConflict: 'team_id,platform_id', ignoreDuplicates: false });

      const { data: adAccount } = await supabase
        .from('ad_accounts')
        .select('id')
        .eq('team_id', teamId)
        .eq('platform_id', id)
        .maybeSingle();

      // ── Step 4: Ingest via backend (API key required) ─────────────
      if (adAccount?.id) {
        if (isLiveConnection && apiKey?.trim()) {
          // The REAL leg. The server holds the Meta token and does the reading;
          // the browser only names the workspace and account to write into.
          //
          // No apiKey is forwarded: unlike the fixture endpoint, this one does
          // not select a tenant from the key — there is exactly one configured
          // Meta account, and passing the selector on would imply a choice the
          // server does not offer.
          toast.info('กำลังดึงข้อมูลจริงจาก Meta Ads...');
          const syncRes = await fetch(backendUrl('/api/meta/sync'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceId: teamId, adAccountId: adAccount.id }),
          });
          if (!syncRes.ok) {
            const err = await syncRes.json().catch(() => ({ error: `HTTP ${syncRes.status}` }));
            throw new Error((err as { error?: string }).error ?? `Meta sync failed: ${syncRes.status}`);
          }
          const result = await syncRes.json() as {
            spend: string;
            impressions: number;
            days: number;
            activeDays: number;
            window: { since: string; until: string };
            written: { insights: number };
          };
          // `activeDays`, not `days` and certainly not the window's length.
          // Meta omits most quiet days and returns a few as explicit zero rows,
          // so "days you advertised" is the count that cost money — measured on
          // the live account as 19 of 26 dates returned.
          toast.success(
            `Meta Ads: ${result.written.insights} แถว · ${result.activeDays} วันที่มีการยิงแอด · ` +
            `฿${result.spend} · ${result.window.since} → ${result.window.until}`
          );
        } else if (tenant && apiKey?.trim()) {
          // Delegate to backend ingestion endpoint.
          // The server fetches from EXTERNAL_API_BASE_URL and writes to DB.
          // Raw external API data is never forwarded to the browser.
          toast.info('กำลังซิงค์ข้อมูลจาก API...');
          const ingestRes = await fetch(backendUrl('/api/connect'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              apiKey: apiKey.trim(),
              platformSlug: platform?.slug,
              workspaceId: teamId,
              adAccountId: adAccount.id,
            }),
          });
          if (!ingestRes.ok) {
            const err = await ingestRes.json().catch(() => ({ error: `HTTP ${ingestRes.status}` }));
            throw new Error((err as { error?: string }).error ?? `Ingestion failed: ${ingestRes.status}`);
          }
          const result = await ingestRes.json() as { message: string; rowsInserted: number };
          toast.success(`${result.message} · ${result.rowsInserted} วันข้อมูล`);
        } else {
          // No API key → connection saved but no data ingested
          toast.warning(`${platform?.name} เชื่อมต่อแล้ว แต่ยังไม่มีข้อมูล — กรุณาใส่ API Key เพื่อซิงค์ข้อมูล`);
        }
      }

      // ── Step 5: Mark connection as fully synced ───────────────────
      await supabase
        .from('workspace_api_keys')
        .update({ sync_status: 'connected' })
        .eq('team_id', teamId)
        .eq('platform_id', id);

      // ── Step 6: Update local state ────────────────────────────────
      setPlatforms((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
              ...p,
              status: "connected" as PlatformStatus,
              accessToken,
              lastSync: new Date().toLocaleString(),
              error: undefined,
            }
            : p
        )
      );

      toast.success(`${platform?.name} เชื่อมต่อสำเร็จ!`);

      // Log platform connection
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await logAuditEvent({
          userId: user.id,
          actionName: 'Platform Connected',
          category: 'integration',
          description: `Connected platform: ${platform?.name}`,
          status: 'success',
          metadata: { platformName: platform?.name, platformSlug: platform?.slug },
        });
      }

      // Mission 2: award points for connecting the first API platform (one-time)
      const { data: missionRaw, error: missionError } = await supabase.rpc(
        'award_loyalty_points',
        { p_action_type: 'connect_api' }
      );
      const missionResult = missionRaw as { success?: boolean; points_awarded?: number } | null;

      if (missionResult?.success) {
        window.dispatchEvent(new CustomEvent('loyalty-refetch'));
      } else if (missionError) {
        void logError('usePlatformConnections.connectPlatform.mission', new Error(missionError.message), {
          hook: 'usePlatformConnections',
          code: missionError.code,
        });
        toast.error(
          'เชื่อมต่อสำเร็จแล้ว แต่ระบบแต้มอัปเดตไม่สำเร็จ — ตรวจสอบ Supabase env และ migration บนโปรเจกต์คลาวด์'
        );
      }

      // ── Step 7: Invalidate caches → frontend re-fetches from DB ──
      await invalidateConnectedData();
      await fetchPlatforms();

      return true;
    } catch (error) {
      toast.error(`เชื่อมต่อล้มเหลว: ${getErrorMessage(error)}`);
      return false;
    }
  };

  // Disconnect platform
  const disconnectPlatform = async (id: string): Promise<boolean> => {
    if (!teamId) return false;

    try {
      const platform = platforms.find(p => p.id === id);

      const { error } = await supabase
        .from('workspace_api_keys')
        .delete()
        .eq('team_id', teamId)
        .eq('platform_id', id);

      if (error) throw error;

      // Mark the ad_account as inactive so its data is hidden from charts/funnel
      await supabase
        .from('ad_accounts')
        .update({ is_active: false })
        .eq('team_id', teamId)
        .eq('platform_id', id);

      setPlatforms((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
              ...p,
              status: "disconnected" as PlatformStatus,
              accessToken: undefined,
              lastSync: undefined,
              error: undefined,
            }
            : p
        )
      );

      toast.success(`${platform?.name} ถูกยกเลิกการเชื่อมต่อ`);

      // Log platform disconnection
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await logAuditEvent({
          userId: user.id,
          actionName: 'Platform Disconnected',
          category: 'integration',
          description: `Disconnected platform: ${platform?.name}`,
          status: 'success',
          metadata: { platformName: platform?.name, platformSlug: platform?.slug },
        });
      }

      await invalidateConnectedData();
      await fetchPlatforms();
      return true;
    } catch (error) {
      toast.error(`ยกเลิกการเชื่อมต่อล้มเหลว: ${getErrorMessage(error)}`);
      return false;
    }
  };

  // Update token
  const updatePlatformToken = async (id: string, token: string): Promise<boolean> => {
    if (!teamId) return false;

    try {
      const platform = platforms.find(p => p.id === id);

      const { error } = await supabase
        .from('workspace_api_keys')
        .update({
          access_token: token,
          last_synced_at: new Date().toISOString(),
          error_message: null,
        })
        .eq('team_id', teamId)
        .eq('platform_id', id);

      if (error) throw error;

      setPlatforms((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
              ...p,
              accessToken: token,
              lastSync: new Date().toLocaleString(),
              status: "connected" as PlatformStatus,
              error: undefined,
            }
            : p
        )
      );

      toast.success(`${platform?.name} API key อัปเดตสำเร็จ`);
      return true;
    } catch (error) {
      toast.error(`อัปเดต API key ล้มเหลว: ${getErrorMessage(error)}`);
      return false;
    }
  };

  const refreshPlatformStatus = async (id: string) => {
    if (!teamId) return;
    const platform = platforms.find(p => p.id === id);
    toast.info(`กำลังตรวจสอบ ${platform?.name}...`);

    // Simulate refresh
    await new Promise(resolve => setTimeout(resolve, 1000));

    await supabase
      .from('workspace_api_keys')
      .update({
        last_synced_at: new Date().toISOString(),
        sync_status: 'connected',
      })
      .eq('team_id', teamId)
      .eq('platform_id', id);

    // Simply update local lastSync
    setPlatforms((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
            ...p,
            lastSync: new Date().toLocaleString(),
            status: p.accessToken ? "connected" as PlatformStatus : "disconnected" as PlatformStatus,
          }
          : p
      )
    );
    toast.success(`${platform?.name} การเชื่อมต่อปกติ`);
  };

  const getPlatformById = (id: string) => {
    return platforms.find((p) => p.id === id);
  };

  return (
    <PlatformConnectionsContext.Provider
      value={{
        platforms,
        connectedPlatforms,
        loading,
        connectPlatform,
        disconnectPlatform,
        updatePlatformToken,
        refreshPlatformStatus,
        getPlatformById,
        refetch: fetchPlatforms,
      }}
    >
      {children}
    </PlatformConnectionsContext.Provider>
  );
}

export function usePlatformConnections() {
  const context = useContext(PlatformConnectionsContext);
  if (context === undefined) {
    throw new Error("usePlatformConnections must be used within a PlatformConnectionsProvider");
  }
  return context;
}

