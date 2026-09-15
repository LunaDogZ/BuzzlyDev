import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PlatformConnectionsProvider, usePlatformConnections } from '../usePlatformConnections';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { syncMetaLive } from '@/lib/metaOAuth';

// The provider wraps the whole router, so its only mount happens on the public
// landing page — signed out. Everything here turns on what it does afterwards.
vi.mock('@/integrations/supabase/client', () => ({
    supabase: {
        from: vi.fn(),
        auth: {
            getUser: vi.fn(),
            // Nothing stored → getCurrentUser falls through to getUser, which each
            // test re-stubs (including the signed-out cases this suite exists for).
            getSession: async () => ({ data: { session: null }, error: null }),
            onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        },
    },
}));

vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('sonner', () => ({
    toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

// Only the network call is replaced. `DEFAULT_SYNC_DAYS` and the preset list
// stay real, so a test asserting "30" is asserting the shipped default rather
// than a number copied into the fixture.
vi.mock('@/lib/metaOAuth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/metaOAuth')>()),
    syncMetaLive: vi.fn(),
}));

const TEAM = '22222222-2222-2222-2222-222222222222';
const FACEBOOK = '40000000-0000-0000-0000-000000000001';
const TIKTOK = '40000000-0000-0000-0000-000000000003';

/** Chainable, thenable stub — any chain resolves to `result`. */
const makeQuery = (result: { data: unknown; error?: unknown }) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'not', 'or']) q[m] = vi.fn(() => q);
    q.single = vi.fn(() => Promise.resolve({ error: null, ...result }));
    q.maybeSingle = vi.fn(() => Promise.resolve({ error: null, ...result }));
    q.then = (f: (v: unknown) => unknown) => Promise.resolve({ error: null, ...result }).then(f);
    return q;
};

/** A workspace that owns one live, healthy Facebook connection. */
function connectedWorkspace() {
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
        if (table === 'workspaces') return makeQuery({ data: { id: TEAM } });
        if (table === 'platforms') {
            return makeQuery({
                data: [{ id: FACEBOOK, slug: 'facebook', name: 'Facebook', platform_categories: null }],
            });
        }
        if (table === 'workspace_api_keys') {
            return makeQuery({
                data: [{
                    platform_id: FACEBOOK, team_id: TEAM, access_token: 'FB_TEST_KEY_SHOP_A',
                    is_active: true, error_message: null,
                }],
            });
        }
        return makeQuery({ data: [] });
    });
}

/**
 * Like `makeQuery`, but answers a list read and a single-row read differently.
 *
 * `fetchPlatforms` reads the whole `platforms` table while `runMetaSync` reads
 * one row from it by slug. A stub that returns the same shape to both makes
 * `facebook.id` undefined and quietly sends the sync down the "no ad account"
 * branch — where it would never reach `syncMetaLive` at all, and these tests
 * would pass for the wrong reason.
 */
const makeSplitQuery = (list: unknown, single: unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'not', 'or']) q[m] = vi.fn(() => q);
    q.single = vi.fn(() => Promise.resolve({ data: single, error: null }));
    q.maybeSingle = vi.fn(() => Promise.resolve({ data: single, error: null }));
    q.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: list, error: null }).then(f);
    return q;
};

const wrapper = ({ children }: { children: ReactNode }) => (
    <PlatformConnectionsProvider>{children}</PlatformConnectionsProvider>
);

describe('PlatformConnectionsProvider — surviving a mount that predates the session', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (supabase.auth.onAuthStateChange as ReturnType<typeof vi.fn>).mockReturnValue({
            data: { subscription: { unsubscribe: vi.fn() } },
        });
    });

    it('subscribes to auth changes, so a later sign-in is not missed', async () => {
        (supabase.auth.getUser as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { user: null } });
        connectedWorkspace();

        renderHook(() => usePlatformConnections(), { wrapper });

        await waitFor(() => expect(supabase.auth.onAuthStateChange).toHaveBeenCalled());
    });

    it('loads the platforms once the user signs in after mount', async () => {
        // Mount signed out — this is the state that used to be terminal.
        (supabase.auth.getUser as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { user: null } });
        connectedWorkspace();

        let fireAuthChange: (() => void) | undefined;
        (supabase.auth.onAuthStateChange as ReturnType<typeof vi.fn>).mockImplementation((cb: () => void) => {
            fireAuthChange = cb;
            return { data: { subscription: { unsubscribe: vi.fn() } } };
        });

        const { result } = renderHook(() => usePlatformConnections(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.connectedPlatforms).toHaveLength(0);

        // The user logs in. Without the listener nothing below ever happens, and
        // useOnboardingGuard answers "no_platform" for the rest of the session —
        // the dashboard replaced by "Connect an Ad Platform".
        (supabase.auth.getUser as ReturnType<typeof vi.fn>).mockResolvedValue({
            data: { user: { id: 'user-1' } },
        });
        await act(async () => { fireAuthChange?.(); });

        await waitFor(() => expect(result.current.connectedPlatforms).toHaveLength(1));
        expect(result.current.connectedPlatforms[0].slug).toBe('facebook');
    });

    it('drops the previous user\'s platforms on sign-out', async () => {
        (supabase.auth.getUser as ReturnType<typeof vi.fn>).mockResolvedValue({
            data: { user: { id: 'user-1' } },
        });
        connectedWorkspace();

        let fireAuthChange: (() => void) | undefined;
        (supabase.auth.onAuthStateChange as ReturnType<typeof vi.fn>).mockImplementation((cb: () => void) => {
            fireAuthChange = cb;
            return { data: { subscription: { unsubscribe: vi.fn() } } };
        });

        const { result } = renderHook(() => usePlatformConnections(), { wrapper });
        await waitFor(() => expect(result.current.connectedPlatforms).toHaveLength(1));

        (supabase.auth.getUser as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { user: null } });
        await act(async () => { fireAuthChange?.(); });

        await waitFor(() => expect(result.current.connectedPlatforms).toHaveLength(0));
    });

    it('unsubscribes on unmount', async () => {
        const unsubscribe = vi.fn();
        (supabase.auth.getUser as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { user: null } });
        (supabase.auth.onAuthStateChange as ReturnType<typeof vi.fn>).mockReturnValue({
            data: { subscription: { unsubscribe } },
        });
        connectedWorkspace();

        const { unmount } = renderHook(() => usePlatformConnections(), { wrapper });
        await waitFor(() => expect(supabase.auth.onAuthStateChange).toHaveBeenCalled());
        unmount();
        expect(unsubscribe).toHaveBeenCalled();
    });
});

/**
 * Only Meta has a connector. The other four rows in `platforms` are a catalogue,
 * and `connectPlatform` has to say so *before* it looks at what was typed.
 *
 * The bug these pin: the refusal used to live inside the `if (!apiKey)` branch,
 * so an empty TikTok card was turned away but a TikTok card with any text in it
 * went on to key validation — a path built for Meta with nothing behind it for
 * the others. In production that fails closed on a missing backend URL, which
 * hid the ordering mistake rather than fixing it.
 */
describe('connectPlatform — a platform without a connector is refused first', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (supabase.auth.getUser as ReturnType<typeof vi.fn>).mockResolvedValue({
            data: { user: { id: 'user-1' } },
        });
        (supabase.auth.onAuthStateChange as ReturnType<typeof vi.fn>).mockReturnValue({
            data: { subscription: { unsubscribe: vi.fn() } },
        });
    });

    /** A workspace whose platform list holds Meta plus one that has no connector. */
    function workspaceWithTikTok() {
        (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
            if (table === 'workspaces') return makeQuery({ data: { id: TEAM } });
            if (table === 'platforms') {
                return makeQuery({
                    data: [
                        { id: FACEBOOK, slug: 'facebook', name: 'Facebook', platform_categories: null },
                        { id: TIKTOK, slug: 'tiktok', name: 'TikTok', platform_categories: null },
                    ],
                });
            }
            return makeQuery({ data: [] });
        });
    }

    it('refuses TikTok even when an API key is supplied', async () => {
        workspaceWithTikTok();
        const { result } = renderHook(() => usePlatformConnections(), { wrapper });
        await waitFor(() => expect(result.current.platforms).toHaveLength(2));

        let outcome: boolean | undefined;
        await act(async () => {
            outcome = await result.current.connectPlatform(TIKTOK, 'ANY_KEY_AT_ALL');
        });

        expect(outcome).toBe(false);
        expect(toast.error).toHaveBeenCalledWith(
            expect.stringContaining('ยังไม่รองรับ'),
            expect.objectContaining({ description: expect.stringContaining('นำเข้าข้อมูล') }),
        );
    });

    it('refuses TikTok with no key too, and never writes a connection row', async () => {
        workspaceWithTikTok();
        const { result } = renderHook(() => usePlatformConnections(), { wrapper });
        await waitFor(() => expect(result.current.platforms).toHaveLength(2));

        (supabase.from as ReturnType<typeof vi.fn>).mockClear();

        let outcome: boolean | undefined;
        await act(async () => { outcome = await result.current.connectPlatform(TIKTOK); });

        expect(outcome).toBe(false);
        // A refusal that still touched the credential table would be the same bug
        // wearing a toast, so assert the write never started.
        expect(supabase.from).not.toHaveBeenCalledWith('workspace_api_keys');
    });

    it('still sends Meta down its own path — the guard is not refusing everything', async () => {
        workspaceWithTikTok();
        const { result } = renderHook(() => usePlatformConnections(), { wrapper });
        await waitFor(() => expect(result.current.platforms).toHaveLength(2));

        await act(async () => { await result.current.connectPlatform(FACEBOOK); });

        // Meta with no key is told to use the OAuth button — a different message
        // from "not supported". Without this case the two tests above would pass
        // just as well if the guard rejected every platform on the page.
        expect(toast.error).toHaveBeenCalledWith(
            expect.stringContaining('เชื่อมต่อด้วยบัญชี Facebook'),
            expect.anything(),
        );
        expect(toast.error).not.toHaveBeenCalledWith(
            expect.stringContaining('ยังไม่รองรับ'),
            expect.anything(),
        );
    });
});

/**
 * How far back a refresh reaches.
 *
 * `syncMetaLive` has always accepted a window; the single call site never sent
 * one, so every press asked Meta for the same rolling 30 days. A workspace that
 * connected after a campaign finished could not reach it — not by pressing
 * refresh, not by waiting, because tomorrow's 30 days excludes yesterday's.
 */
describe('refreshPlatformStatus — the window is the caller\'s choice', () => {
    const AD_ACCOUNT = '7ee69e28-2caf-4f9a-8aea-ded56d76b062';

    beforeEach(() => {
        vi.clearAllMocks();
        (supabase.auth.getUser as ReturnType<typeof vi.fn>).mockResolvedValue({
            data: { user: { id: 'user-1' } },
        });
        (supabase.auth.onAuthStateChange as ReturnType<typeof vi.fn>).mockReturnValue({
            data: { subscription: { unsubscribe: vi.fn() } },
        });
        (syncMetaLive as ReturnType<typeof vi.fn>).mockResolvedValue({
            written: { insights: 6 }, activeDays: 6, spend: '197.05',
            window: { since: '2026-06-14', until: '2026-09-11' },
        });

        (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
            if (table === 'workspaces') return makeSplitQuery([], { id: TEAM });
            if (table === 'platforms') {
                return makeSplitQuery(
                    [{ id: FACEBOOK, slug: 'facebook', name: 'Facebook', platform_categories: null }],
                    { id: FACEBOOK },
                );
            }
            if (table === 'ad_accounts') {
                return makeSplitQuery([], { id: AD_ACCOUNT, platform_account_id: 'act_1025260845170202' });
            }
            if (table === 'workspace_api_keys') {
                return makeSplitQuery(
                    [{
                        platform_id: FACEBOOK, team_id: TEAM, access_token: 'FB_TEST_KEY_SHOP_A',
                        is_active: true, error_message: null,
                    }],
                    null,
                );
            }
            return makeSplitQuery([], null);
        });
    });

    async function connectedHook() {
        const { result } = renderHook(() => usePlatformConnections(), { wrapper });
        await waitFor(() => expect(result.current.platforms).toHaveLength(1));
        return result;
    }

    it('asks for the routine 30 days when no window is named', async () => {
        const result = await connectedHook();
        await act(async () => { await result.current.refreshPlatformStatus(FACEBOOK); });

        expect(syncMetaLive).toHaveBeenCalledWith(TEAM, AD_ACCOUNT, { days: 30 });
    });

    it('sends the window it was given, so a backfill actually reaches back', async () => {
        const result = await connectedHook();
        await act(async () => { await result.current.refreshPlatformStatus(FACEBOOK, 366); });

        // The discriminating assertion: before this change the third argument
        // was never passed at all, and the server fell back to 30 days no
        // matter which window the merchant picked.
        expect(syncMetaLive).toHaveBeenCalledWith(TEAM, AD_ACCOUNT, { days: 366 });
    });

    it('says so when the deployed function served a shorter window than asked', async () => {
        const result = await connectedHook();
        // What an un-redeployed `meta-sync` returns: the request carried
        // days: 366, the response is the old fixed thirty.
        (syncMetaLive as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            written: { insights: 2 }, activeDays: 1, spend: '32.52',
            window: { since: '2026-08-13', until: '2026-09-11' },
        });

        await act(async () => { await result.current.refreshPlatformStatus(FACEBOOK, 366); });

        expect(toast.warning).toHaveBeenCalledWith(
            expect.stringContaining('30 วัน'),
            expect.objectContaining({ description: expect.stringContaining('deploy') }),
        );
    });

    it('stays quiet when the window came back as asked', async () => {
        const result = await connectedHook();
        // 14 Jun → 11 Sep inclusive is exactly 90 days. Without this case the
        // test above would pass just as well if the warning fired every time.
        (syncMetaLive as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            written: { insights: 6 }, activeDays: 6, spend: '197.05',
            window: { since: '2026-06-14', until: '2026-09-11' },
        });

        await act(async () => { await result.current.refreshPlatformStatus(FACEBOOK, 90); });

        expect(toast.warning).not.toHaveBeenCalled();
    });

    it('refuses a second press while one is still running', async () => {
        const result = await connectedHook();
        let release: (() => void) | undefined;
        (syncMetaLive as ReturnType<typeof vi.fn>).mockImplementationOnce(
            () => new Promise((resolve) => { release = () => resolve({
                written: { insights: 0 }, activeDays: 0, spend: '0',
                window: { since: '2026-08-13', until: '2026-09-11' },
            }); }),
        );

        await act(async () => {
            const first = result.current.refreshPlatformStatus(FACEBOOK, 366);
            // A year-long backfill is long enough for a merchant to press again.
            // Two concurrent runs of the same window against a rate-limited API
            // is what the in-flight guard exists to prevent.
            await result.current.refreshPlatformStatus(FACEBOOK, 366);
            release?.();
            await first;
        });

        expect(syncMetaLive).toHaveBeenCalledTimes(1);
    });
});
