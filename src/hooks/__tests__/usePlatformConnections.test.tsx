import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PlatformConnectionsProvider, usePlatformConnections } from '../usePlatformConnections';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

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
