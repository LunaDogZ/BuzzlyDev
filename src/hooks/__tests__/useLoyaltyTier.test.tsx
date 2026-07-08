import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLoyaltyTier, LoyaltyProvider } from '../useLoyaltyTier';
import { supabase } from '@/integrations/supabase/client';
import type { ReactNode } from 'react';

// Mock Supabase client (useLoyaltyTier is a context hook backed by LoyaltyProvider,
// which fetches via rpc + several tables and subscribes to realtime changes)
vi.mock('@/integrations/supabase/client', () => ({
    supabase: {
        from: vi.fn(),
        rpc: vi.fn(),
        auth: {
            getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
            onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        },
        channel: vi.fn(() => ({
            on: vi.fn().mockReturnThis(),
            subscribe: vi.fn().mockReturnThis(),
        })),
        removeChannel: vi.fn(),
    },
}));

// Chainable, thenable query stub: any chain of select/eq/order/limit resolves `result`
const makeQuery = (result: { data: unknown; error: unknown }) => {
    const q: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'limit']) {
        q[method] = vi.fn(() => q);
    }
    q.single = vi.fn(() => Promise.resolve(result));
    q.maybeSingle = vi.fn(() => Promise.resolve(result));
    q.then = (onfulfilled: (v: unknown) => unknown) => Promise.resolve(result).then(onfulfilled);
    return q;
};

describe('useLoyaltyTier', () => {
    const mockTiers = [
        { id: '1', name: 'Bronze', priority_level: 1, min_points: 0 },
        { id: '2', name: 'Silver', priority_level: 2, min_points: 1000 },
        { id: '3', name: 'Gold', priority_level: 3, min_points: 5000 },
    ];

    const wrapper = ({ children }: { children: ReactNode }) => (
        <LoyaltyProvider>{children}</LoyaltyProvider>
    );

    const setupMocks = (tier: (typeof mockTiers)[number] | null, pointBalance = 0) => {
        vi.mocked(supabase.auth.getUser).mockResolvedValue({
            data: { user: { id: 'u1' } },
            error: null,
        } as never);

        // get_my_loyalty_tier RPC returns the user's tier + balance
        vi.mocked(supabase.rpc).mockResolvedValue({
            data: { tier, point_balance: pointBalance },
            error: null,
        } as never);

        vi.mocked(supabase.from).mockImplementation(((table: string) => {
            switch (table) {
                case 'loyalty_tiers':
                    return makeQuery({ data: mockTiers, error: null });
                case 'profile_customers':
                    return makeQuery({ data: { id: 'p1', created_at: '2024-01-01' }, error: null });
                case 'payment_transactions':
                    return makeQuery({ data: [{ amount: 1000 }], error: null });
                case 'loyalty_activity_codes':
                case 'loyalty_mission_completions':
                case 'points_transactions':
                    return makeQuery({ data: [], error: null });
                default:
                    return makeQuery({ data: null, error: null });
            }
        }) as never);
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return initial state correctly', async () => {
        setupMocks(mockTiers[0]);
        const { result } = renderHook(() => useLoyaltyTier(), { wrapper });

        expect(result.current.loading).toBe(true);

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
    });

    it('should fetch user loyalty info', async () => {
        setupMocks(mockTiers[0], 500); // Bronze, 500 points

        const { result } = renderHook(() => useLoyaltyTier(), { wrapper });

        await waitFor(() => {
            expect(result.current.userLoyalty?.points_balance).toBe(500);
            expect(result.current.userLoyalty?.tier?.name).toBe('Bronze');
        });

        expect(result.current.userLoyalty?.total_spend_amount).toBe(1000);
        expect(result.current.userLoyalty?.member_since).toBe('2024-01-01');
    });

    it('should calculate next tier correctly', async () => {
        setupMocks(mockTiers[0], 500); // Bronze

        const { result } = renderHook(() => useLoyaltyTier(), { wrapper });

        await waitFor(() => {
            expect(result.current.getNextTier()?.name).toBe('Silver');
        });
    });

    it('should calculate progress correctly', async () => {
        // Bronze (0 pts) -> Silver (1000 pts); user has 500 pts => 50%
        setupMocks(mockTiers[0], 500);

        const { result } = renderHook(() => useLoyaltyTier(), { wrapper });

        await waitFor(() => {
            expect(result.current.getProgressToNextTier()).toBe(50);
        });
    });

    it('should return 100% progress if at max tier', async () => {
        setupMocks(mockTiers[2], 6000); // Gold (max in mock)

        const { result } = renderHook(() => useLoyaltyTier(), { wrapper });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        // No tier > Gold (priority 3)
        expect(result.current.getNextTier()).toBeNull();
        expect(result.current.getProgressToNextTier()).toBe(100);
    });
});
