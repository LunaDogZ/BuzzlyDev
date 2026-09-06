import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
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
import { isConnectablePlatform, IMPORT_ONLY_ROUTE_TH } from "@/constants/platformSupport";
import {
  describeReturn,
  disconnectMetaOAuth,
  startMetaOAuth,
  syncMetaLive,
  type MetaOAuthReturn,
} from "@/lib/metaOAuth";

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
  /** Which account on the platform this workspace is connected to (e.g. an
   *  `act_…` ad account id). Not a secret — it is what an OAuth connection has
   *  instead of a token to show. */
  accountId?: string;
  /** When an OAuth token lapses. Facebook user tokens last ~60 days and cannot
   *  be refreshed, so the merchant has to reconnect. */
  tokenExpiresAt?: string;
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
  /** Real OAuth. Leaves the page — the promise only rejects, never resolves
   *  with the browser still here. */
  connectPlatformOAuth: (id: string) => Promise<void>;
  /** Finish the return leg from Meta and pull the first window of data. */
  completeMetaOAuth: (ret: MetaOAuthReturn) => Promise<void>;
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
  // A ref, not state: this guards a side effect, and re-rendering on it would
  // only make the check race the render it triggered. See `runMetaSync`.
  const metaSyncInFlight = useRef(false);
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
          } else if (
            connection.is_active &&
            // `account_id_on_platform` is what an OAuth connection leaves here.
            // The token itself is deliberately NOT in this table — it lives in
            // `platform_oauth_tokens`, which the browser cannot read — so keying
            // "connected" off `access_token` alone reported every real Meta
            // connection as disconnected.
            (connection.access_token || connection.api_key_encrypted || connection.account_id_on_platform)
          ) {
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
          accountId: connection?.account_id_on_platform ?? undefined,
          tokenExpiresAt: connection?.token_expires_at ?? undefined,
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

      // Connecting with nothing at all is refused, for every platform.
      //
      // What used to happen: an empty field waited 800ms and wrote
      // `oauth_<slug>_<random>` into workspace_api_keys as if it were an access
      // token. The card turned Active, a success toast fired, and no credential
      // of any kind existed. Nobody looking at the screen could tell — the
      // founder could not, on Facebook, for twenty minutes.
      //
      // A placeholder that presents as a live connection is worse than an error,
      // because the failure surfaces later and to someone else. Each platform now
      // says what its actual route in is.
      // A platform with no connector is refused before the key is looked at, not
      // after. The old order only reached this message when the field was empty,
      // so typing anything into a TikTok card sent the request onward to key
      // validation — a route that exists for Meta and has no destination here.
      // Whether a platform is connectable does not depend on what was typed.
      if (!isConnectablePlatform(platform?.slug)) {
        toast.error(`${platform?.name ?? 'แพลตฟอร์มนี้'} ยังไม่รองรับการเชื่อมต่อโดยตรง`, {
          description: IMPORT_ONLY_ROUTE_TH,
        });
        return false;
      }

      if (!apiKey?.trim()) {
        toast.error('กรุณาใช้ปุ่ม "เชื่อมต่อด้วยบัญชี Facebook"', {
          description: 'การเชื่อมต่อ Facebook ต้องขออนุญาตผ่าน Meta — ช่อง API Key ใช้สำหรับนักพัฒนาเท่านั้น',
        });
        return false;
      }

      // Past the guard `apiKey` is always a non-empty string. It is narrowed once
      // here rather than re-tested at each use, so no later branch can quietly
      // fall back to a generated value again.
      const key = apiKey.trim();

      let tenant: string | null = null;
      // Decided by the server, never inferred here: a live Meta connection and
      // a Facebook fixture connection share the slug `facebook`, so the slug
      // cannot tell them apart. Only the server knows whether a key selects a
      // real connector, and the two are ingested by different endpoints.
      let isLiveConnection = false;
      const accessToken = key;

      // ── Step 1: Validate the API key against the backend ──────────
      {
        toast.info('กำลังตรวจสอบ API Key...');
        const validated = await postValidateMockApiKey(key, platform?.slug);
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
        if (isLiveConnection) {
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
        } else if (tenant) {
          // Delegate to backend ingestion endpoint.
          // The server fetches from EXTERNAL_API_BASE_URL and writes to DB.
          // Raw external API data is never forwarded to the browser.
          toast.info('กำลังซิงค์ข้อมูลจาก API...');
          const ingestRes = await fetch(backendUrl('/api/connect'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              apiKey: key,
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

      // Revoke first, and abort the whole disconnect if it fails. The rows below
      // are only what the UI reads; the credential itself lives in
      // `platform_oauth_tokens`, which the browser cannot reach. Clearing the
      // display first and failing here would leave the merchant looking at
      // "ยกเลิกแล้ว" while the server still holds working Graph access.
      if (platform?.slug === 'facebook') {
        const { revoked } = await disconnectMetaOAuth(teamId);
        if (revoked) toast.info('เพิกถอนสิทธิ์ที่ Meta เรียบร้อย');
      }

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

  const getPlatformById = (id: string) => {
    return platforms.find((p) => p.id === id);
  };

  // ── Real OAuth ───────────────────────────────────────────────────────────
  //
  // Deliberately separate from `connectPlatform` rather than another branch
  // inside it. That function's contract is "returns whether the connection
  // succeeded"; this one hands the browser to Meta and never returns at all, and
  // folding a navigation into a boolean-returning call is how callers end up
  // writing code after it that silently never runs.
  const connectPlatformOAuth = async (id: string): Promise<void> => {
    if (!teamId) {
      toast.error('ยังไม่มี Workspace — กรุณาสร้าง Workspace ก่อนเชื่อมต่อ');
      return;
    }
    try {
      // Come back to the page they left, not a hardcoded one.
      await startMetaOAuth(teamId, window.location.href);
    } catch (error) {
      const message = getErrorMessage(error);
      toast.error(`เริ่มการเชื่อมต่อ Meta ไม่สำเร็จ: ${message}`);
      void logError('usePlatformConnections.connectPlatformOAuth', error);
    }
  };

  /**
   * Pull the workspace's real Meta spend and report what actually arrived.
   *
   * Shared by the two paths that have a reason to fetch: the return leg from
   * OAuth, and the refresh button. Neither writes connection state itself —
   * `meta-sync` sets `sync_status` / `last_synced_at` / `error_message` inside
   * the same request that did or did not get the data, so the only honest thing
   * the browser can do afterwards is re-read the row.
   *
   * `expectedAccount` is set only on the OAuth return leg, where the callback
   * has just named the account it connected. Matching on it is how that path
   * notices a callback that stored a token but never created the `ad_accounts`
   * row. A refresh has no such expectation and must not invent one: the
   * workspace has exactly one Facebook account by construction (`ad_accounts`
   * is UNIQUE (team_id, platform_id)), so it takes whichever row is there.
   */
  const runMetaSync = async (
    source: string,
    expectedAccount?: string,
  ): Promise<void> => {
    if (!teamId) return;

    // One at a time. Each call is now a real 30-day Graph fetch — three paged
    // Meta requests and a six-table write — where the refresh button it replaced
    // was a one-second no-op that cost nothing to press twice. The button has no
    // disabled state, so without this a double-click fires two concurrent syncs
    // of the same window against a rate-limited API.
    if (metaSyncInFlight.current) {
      toast.info('กำลังซิงค์ข้อมูล Meta อยู่แล้ว — รอสักครู่');
      return;
    }
    metaSyncInFlight.current = true;

    // Said before the two lookups below rather than after them, because those
    // are round trips: a merchant who presses refresh and sees nothing for a
    // second presses it again.
    toast.info('กำลังดึงข้อมูลจริงจาก Meta Ads...');

    try {
      // Read the platform from the database, not from `platforms` state. On the
      // OAuth return leg this runs from an effect on a page Meta's redirect has
      // just loaded fresh, so the state captured in this closure is still the
      // initial empty array — `.find` returned undefined and the sync was
      // skipped in silence.
      const { data: facebook } = await supabase
        .from('platforms')
        .select('id')
        .eq('slug', 'facebook')
        .maybeSingle();
      if (!facebook) {
        toast.error('ระบบยังไม่ได้ตั้งค่าแพลตฟอร์ม Facebook');
        return;
      }

      // One query, no conditional `.eq` appended to a reassigned builder:
      // `ad_accounts` is UNIQUE (team_id, platform_id) so this can only match
      // one row, and `expectedAccount` is checked against what comes back.
      // Reassigning a Supabase query builder to add a filter is what defeats its
      // type inference (TS2589) — see the note in `constants/adDataSource.ts`.
      const { data: adAccount } = await supabase
        .from('ad_accounts')
        .select('id, platform_account_id')
        .eq('team_id', teamId)
        .eq('platform_id', facebook.id)
        .maybeSingle();

      if (!adAccount?.id) {
        // meta-oauth creates this row during the callback, so its absence means
        // the callback did not finish — worth saying rather than silently not
        // syncing.
        toast.warning('ยังไม่พบบัญชีโฆษณาของ workspace นี้ — กรุณาเชื่อมต่อ Meta ใหม่อีกครั้ง');
        return;
      }
      // Only the OAuth return leg has an expectation to check: the callback has
      // just named the account it connected, and this row is the one it wrote,
      // so a mismatch means the two disagree and syncing would pull the wrong
      // account's spend. A refresh has no such expectation and must not invent
      // one.
      if (expectedAccount && adAccount.platform_account_id !== expectedAccount) {
        toast.warning('บัญชีโฆษณาที่บันทึกไว้ไม่ตรงกับที่เพิ่งเชื่อมต่อ — กรุณาเชื่อมต่อ Meta ใหม่อีกครั้ง');
        return;
      }

      const result = await syncMetaLive(teamId, adAccount.id);
      // `activeDays`, not `days` and certainly not the window's length: Meta
      // omits most quiet days and returns a few as explicit zero rows, so "days
      // you advertised" is the only count that means money was spent.
      toast.success(
        `Meta Ads: ${result.written.insights} แถว · ${result.activeDays} วันที่มีการยิงแอด · ` +
        `฿${result.spend} · ${result.window.since} → ${result.window.until}`
      );
      // The whole set, not just `ad_insights`: a sync moves the dashboard
      // totals, the funnel and the sync history too, and invalidating one key
      // left the merchant looking at a dashboard that still said zero after
      // their first successful connection.
      await invalidateConnectedData();
    } catch (error) {
      const message = getErrorMessage(error);
      toast.error(`ซิงค์ข้อมูล Meta ไม่สำเร็จ: ${message}`);
      void logError(`usePlatformConnections.${source}.sync`, error);
    } finally {
      metaSyncInFlight.current = false;
      // Whatever happened — `meta-sync` records a failure against the connection
      // as well as a success, so the card must be re-read after a failed run
      // too, not only after a good one.
      await fetchPlatforms();
    }
  };

  // Called by whichever page the merchant was returned to. The token is already
  // stored server-side by then; what is left is to pull the first window so the
  // dashboard is not empty on arrival.
  const completeMetaOAuth = async (ret: MetaOAuthReturn): Promise<void> => {
    if (ret.status !== 'connected') {
      if (ret.status === 'cancelled') toast.info(describeReturn(ret));
      else toast.error(describeReturn(ret));
      return;
    }
    toast.success(describeReturn(ret));
    await fetchPlatforms();
    await runMetaSync('completeMetaOAuth', ret.account ?? undefined);
  };

  /**
   * The refresh button on a connected platform card.
   *
   * For Meta this is the *only* way to get data after the first connection:
   * `syncMetaLive` had exactly one caller — the OAuth return leg — so a
   * workspace fetched a rolling 30 days once and then never again. Yesterday's
   * spend simply never arrived, and the button that looked like it would fetch
   * it did this instead:
   *
   *     await new Promise(resolve => setTimeout(resolve, 1000));
   *     await supabase.from('workspace_api_keys').update({
   *       last_synced_at: new Date().toISOString(), sync_status: 'connected',
   *     })…
   *     toast.success(`${platform?.name} การเชื่อมต่อปกติ`);
   *
   * It never contacted Meta. It slept a second, stamped "synced just now" onto
   * the row and turned the card green — the same fabricated connection state
   * removed from `connectPlatform` in 2cc696a and 1c063ba, one layer down.
   *
   * Every other platform is told the truth instead of given a fake success:
   * none of them has a connector, so there is nothing here that could check
   * them, and saying so points at the route that does work.
   */
  const refreshPlatformStatus = async (id: string) => {
    if (!teamId) return;
    const platform = platforms.find(p => p.id === id);

    if (platform?.slug === 'facebook') {
      await runMetaSync('refreshPlatformStatus');
      return;
    }

    toast.info(`${platform?.name ?? 'แพลตฟอร์มนี้'} ยังไม่รองรับการซิงค์ข้อมูล`, {
      description: 'ตอนนี้มีเฉพาะ Meta ที่เชื่อมต่อผ่าน OAuth และดึงข้อมูลจริงได้ — แพลตฟอร์มอื่นนำข้อมูลเข้าที่หน้า Imports โดยอัปโหลดไฟล์รายงาน',
    });
    // A real re-read of the row, which is the only thing this can honestly do
    // for a platform it cannot contact.
    await fetchPlatforms();
  };

  return (
    <PlatformConnectionsContext.Provider
      value={{
        platforms,
        connectedPlatforms,
        loading,
        connectPlatform,
        connectPlatformOAuth,
        completeMetaOAuth,
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

