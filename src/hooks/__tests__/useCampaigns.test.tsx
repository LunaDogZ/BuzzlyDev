import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCampaigns } from '../useCampaigns';
import { supabase } from '@/integrations/supabase/client';
import type { ReactNode } from 'react';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
    supabase: {
        from: vi.fn(),
        rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
        auth: {
            getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
            getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
            onAuthStateChange: vi.fn(() => ({
                data: { subscription: { unsubscribe: vi.fn() } },
            })),
        },
    },
}));

// Mock sonner toast
vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

// useCampaigns depends on useWorkspace (for workspaceId) and useLoyaltyTier (for refetch);
// mock both so tests exercise only the campaigns logic
vi.mock('@/hooks/useWorkspace', () => ({
    useWorkspace: () => ({
        workspace: { id: 'ws1', name: 'Test Workspace' },
        loading: false,
    }),
}));

vi.mock('@/hooks/useLoyaltyTier', () => ({
    useLoyaltyTier: () => ({
        refetch: vi.fn(),
    }),
}));

describe('useCampaigns', () => {
    let queryClient: QueryClient;

    // Wrapper component for React Query
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    beforeEach(() => {
        queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        });
        vi.clearAllMocks();
    });

    describe('Fetching Campaigns', () => {
        it('should fetch campaigns with insights successfully', async () => {
            const mockCampaigns = [
                {
                    id: '1',
                    name: 'Test Campaign 1',
                    status: 'active',
                    created_at: '2024-01-01',
                },
                {
                    id: '2',
                    name: 'Test Campaign 2',
                    status: 'paused',
                    created_at: '2024-01-02',
                },
            ];

            const mockInsights = [
                {
                    campaign_id: '1',
                    impressions: 1000,
                    reach: 800,
                    clicks: 50,
                    conversions: 5,
                    spend: 100,
                },
                {
                    campaign_id: '1',
                    impressions: 500,
                    reach: 400,
                    clicks: 25,
                    conversions: 2,
                    spend: 50,
                },
            ];

            vi.mocked(supabase.from).mockImplementation((table: string) => {
                if (table === 'campaigns') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        or: vi.fn().mockReturnThis(),
                        order: vi.fn().mockResolvedValue({
                            data: mockCampaigns,
                            error: null,
                        }),
                    } as any;
                }
                if (table === 'campaign_ads') {
                    return {
                        select: vi.fn().mockResolvedValue({ data: [], error: null }),
                    } as any;
                }
                if (table === 'ad_insights') {
                    return {
                        select: vi.fn().mockResolvedValue({
                            data: mockInsights,
                            error: null,
                        }),
                    } as any;
                }
                return {} as any;
            });

            const { result } = renderHook(() => useCampaigns(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(result.current.campaigns).toHaveLength(2);
            expect(result.current.campaigns[0]).toMatchObject({
                id: '1',
                name: 'Test Campaign 1',
                impressions: 1500, // Aggregated
                reach: 1200,
                clicks: 75,
                conversions: 7,
                spend: 150,
            });
        });

        it('should return empty array when no campaigns exist', async () => {
            vi.mocked(supabase.from).mockImplementation((table: string) => {
                if (table === 'campaigns') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        order: vi.fn().mockResolvedValue({
                            data: [],
                            error: null,
                        }),
                    } as any;
                }
                if (table === 'ad_insights') {
                    return {
                        select: vi.fn().mockResolvedValue({
                            data: [],
                            error: null,
                        }),
                    } as any;
                }
                return {} as any;
            });

            const { result } = renderHook(() => useCampaigns(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(result.current.campaigns).toEqual([]);
        });

        it('should handle fetch error gracefully', async () => {
            vi.mocked(supabase.from).mockImplementation(() => {
                return {
                    select: vi.fn().mockReturnThis(),
                    order: vi.fn().mockResolvedValue({
                        data: null,
                        error: { message: 'Database error' },
                    }),
                } as any;
            });

            const { result } = renderHook(() => useCampaigns(), { wrapper });

            await waitFor(() => {
                expect(result.current.error).toBeTruthy();
            });
        });

        it('should handle campaigns without insights', async () => {
            const mockCampaigns = [
                {
                    id: '1',
                    name: 'Campaign Without Insights',
                    status: 'active',
                    created_at: '2024-01-01',
                },
            ];

            vi.mocked(supabase.from).mockImplementation((table: string) => {
                if (table === 'campaigns') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        or: vi.fn().mockReturnThis(),
                        order: vi.fn().mockResolvedValue({
                            data: mockCampaigns,
                            error: null,
                        }),
                    } as any;
                }
                if (table === 'campaign_ads') {
                    return {
                        select: vi.fn().mockResolvedValue({ data: [], error: null }),
                    } as any;
                }
                if (table === 'ad_insights') {
                    return {
                        select: vi.fn().mockResolvedValue({
                            data: [],
                            error: null,
                        }),
                    } as any;
                }
                return {} as any;
            });

            const { result } = renderHook(() => useCampaigns(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(result.current.campaigns[0]).toMatchObject({
                id: '1',
                impressions: 0,
                reach: 0,
                clicks: 0,
                conversions: 0,
                spend: 0,
            });
        });
    });

    describe('Creating Campaign', () => {
        it('should create campaign successfully', async () => {
            const newCampaign = {
                name: 'New Campaign',
                status: 'active' as const,
            };

            const mockCreatedCampaign = {
                id: '123',
                ...newCampaign,
                created_at: '2024-01-01',
            };

            vi.mocked(supabase.from).mockImplementation(() => {
                return {
                    insert: vi.fn().mockReturnThis(),
                    select: vi.fn().mockResolvedValue({
                        data: [mockCreatedCampaign],
                        error: null,
                    }),
                } as any;
            });

            const { result } = renderHook(() => useCampaigns(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            result.current.createCampaign.mutate(newCampaign);

            await waitFor(() => {
                expect(result.current.createCampaign.isSuccess).toBe(true);
            });
        });

        it('should handle create error', async () => {
            const newCampaign = {
                name: 'New Campaign',
                status: 'active' as const,
            };

            vi.mocked(supabase.from).mockImplementation(() => {
                return {
                    insert: vi.fn().mockReturnThis(),
                    select: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({
                        data: null,
                        error: { message: 'Create failed' },
                    }),
                } as any;
            });

            const { result } = renderHook(() => useCampaigns(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            result.current.createCampaign.mutate(newCampaign);

            await waitFor(() => {
                expect(result.current.createCampaign.isError).toBe(true);
            });
        });
    });

    describe('Updating Campaign', () => {
        it('should update campaign successfully', async () => {
            const campaignId = '123';
            const updates = {
                name: 'Updated Campaign Name',
                status: 'paused' as const,
            };

            vi.mocked(supabase.from).mockImplementation(() => {
                return {
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    select: vi.fn().mockResolvedValue({
                        data: [{ id: campaignId, ...updates }],
                        error: null,
                    }),
                } as any;
            });

            const { result } = renderHook(() => useCampaigns(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            result.current.updateCampaign.mutate({ id: campaignId, updates });

            await waitFor(() => {
                expect(result.current.updateCampaign.isSuccess).toBe(true);
            });
        });

        it('should handle update error', async () => {
            vi.mocked(supabase.from).mockImplementation(() => {
                return {
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    select: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({
                        data: null,
                        error: { message: 'Update failed' },
                    }),
                } as any;
            });

            const { result } = renderHook(() => useCampaigns(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            result.current.updateCampaign.mutate({
                id: '123',
                updates: { name: 'Updated' },
            });

            await waitFor(() => {
                expect(result.current.updateCampaign.isError).toBe(true);
            });
        });
    });

    describe('Deleting Campaign', () => {
        it('should delete campaign successfully', async () => {
            const campaignId = '123';

            // deleteCampaign first fetches the campaign name (select→eq→single), then deletes (delete→eq)
            vi.mocked(supabase.from).mockImplementation(() => {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({
                        data: { id: campaignId, name: 'Test Campaign' },
                        error: null,
                    }),
                    delete: vi.fn(() => ({
                        eq: vi.fn().mockResolvedValue({ error: null }),
                    })),
                } as any;
            });

            const { result } = renderHook(() => useCampaigns(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            result.current.deleteCampaign.mutate(campaignId);

            await waitFor(() => {
                expect(result.current.deleteCampaign.isSuccess).toBe(true);
            });
        });

        it('should handle delete error', async () => {
            vi.mocked(supabase.from).mockImplementation(() => {
                return {
                    delete: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockResolvedValue({
                        error: { message: 'Delete failed' },
                    }),
                } as any;
            });

            const { result } = renderHook(() => useCampaigns(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            result.current.deleteCampaign.mutate('123');

            await waitFor(() => {
                expect(result.current.deleteCampaign.isError).toBe(true);
            });
        });
    });

    describe('Edge Cases', () => {
        it('should handle null insights fields', async () => {
            const mockCampaigns = [{ id: '1', name: 'Test', created_at: '2024-01-01' }];
            const mockInsights = [
                {
                    campaign_id: '1',
                    impressions: null,
                    reach: null,
                    clicks: null,
                    conversions: null,
                    spend: null,
                },
            ];

            vi.mocked(supabase.from).mockImplementation((table: string) => {
                if (table === 'campaigns') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        or: vi.fn().mockReturnThis(),
                        order: vi.fn().mockResolvedValue({ data: mockCampaigns, error: null }),
                    } as any;
                }
                if (table === 'campaign_ads') {
                    return {
                        select: vi.fn().mockResolvedValue({ data: [], error: null }),
                    } as any;
                }
                if (table === 'ad_insights') {
                    return {
                        select: vi.fn().mockResolvedValue({ data: mockInsights, error: null }),
                    } as any;
                }
                return {} as any;
            });

            const { result } = renderHook(() => useCampaigns(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(result.current.campaigns[0].impressions).toBe(0);
        });

        it('should aggregate multiple insights for same campaign', async () => {
            const mockCampaigns = [{ id: '1', name: 'Test', created_at: '2024-01-01' }];
            const mockInsights = [
                { campaign_id: '1', impressions: 100, reach: 80, clicks: 10, conversions: 1, spend: 10 },
                { campaign_id: '1', impressions: 200, reach: 160, clicks: 20, conversions: 2, spend: 20 },
                { campaign_id: '1', impressions: 300, reach: 240, clicks: 30, conversions: 3, spend: 30 },
            ];

            vi.mocked(supabase.from).mockImplementation((table: string) => {
                if (table === 'campaigns') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        or: vi.fn().mockReturnThis(),
                        order: vi.fn().mockResolvedValue({ data: mockCampaigns, error: null }),
                    } as any;
                }
                if (table === 'campaign_ads') {
                    return {
                        select: vi.fn().mockResolvedValue({ data: [], error: null }),
                    } as any;
                }
                if (table === 'ad_insights') {
                    return {
                        select: vi.fn().mockResolvedValue({ data: mockInsights, error: null }),
                    } as any;
                }
                return {} as any;
            });

            const { result } = renderHook(() => useCampaigns(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(result.current.campaigns[0]).toMatchObject({
                impressions: 600,
                reach: 480,
                clicks: 60,
                conversions: 6,
                spend: 60,
            });
        });
    });
});
