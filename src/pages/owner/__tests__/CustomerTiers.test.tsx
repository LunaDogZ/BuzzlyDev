import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import CustomerTiers from '../CustomerTiers';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
    supabase: {
        from: vi.fn(),
    },
}));

// Mock Recharts
vi.mock('recharts', async (importOriginal) => {
    const original = await importOriginal();
    return {
        ...(original as any),
        ResponsiveContainer: ({ children }: any) => <div className="recharts-responsive-container">{children}</div>,
    };
});

describe('CustomerTiers Page', () => {
    // Page data comes from useCustomerTiers/useDiscounts (React Query)
    const renderPage = () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        return render(
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    <CustomerTiers />
                </BrowserRouter>
            </QueryClientProvider>
        );
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders loading state initially', () => {
        // Prevent useEffect from resolving immediately by returning a pending promise or just checking initial render
        vi.mocked(supabase.from).mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnValue(new Promise(() => { })) // Never resolves
        } as any);

        renderPage();

        expect(screen.getByText(/Loading tier analytics.../i)).toBeInTheDocument();
    });

    it('fetch and renders data correctly', async () => {
        // Mock Tiers
        const mockTiers = [
            { name: 'Bronze', min_points: 0, min_spend_amount: 0 },
            { name: 'Silver', min_points: 1000, min_spend_amount: 1000 },
            { name: 'Gold', min_points: 5000, min_spend_amount: 5000 },
            { name: 'Platinum', min_points: 10000, min_spend_amount: 10000 }
        ];

        // Mock Customers
        const mockCustomers = [
            {
                user_id: '1', first_name: 'John', last_name: 'Doe',
                loyalty_points: {
                    total_points_earned: 500,
                    status: 'active',
                    loyalty_tiers: { name: 'Bronze', badge_color: '#A85823' }
                }
            },
            {
                user_id: '2', first_name: 'Jane', last_name: 'Smith',
                loyalty_points: {
                    total_points_earned: 12000,
                    status: 'active',
                    loyalty_tiers: { name: 'Platinum', badge_color: '#6366F1' }
                }
            }
        ];

        // Mock Transactions
        const mockTxs = [
            { amount: 500, user_id: '1', created_at: new Date().toISOString() },
            { amount: 15000, user_id: '2', created_at: new Date().toISOString() }
        ];

        vi.mocked(supabase.from).mockImplementation((table: string) => {
            if (table === 'loyalty_tiers') {
                return {
                    select: vi.fn().mockReturnThis(),
                    order: vi.fn().mockResolvedValue({ data: mockTiers, error: null })
                } as any;
            }
            if (table === 'profile_customers') {
                return {
                    select: vi.fn().mockResolvedValue({ data: mockCustomers, error: null })
                } as any;
            }
            if (table === 'payment_transactions') {
                return {
                    select: vi.fn().mockReturnThis(),
                    order: vi.fn().mockResolvedValue({ data: mockTxs, error: null })
                } as any;
            }
            if (table === 'tier_history') {
                return {
                    select: vi.fn().mockReturnThis(),
                    order: vi.fn().mockResolvedValue({ data: [], error: null })
                } as any;
            }
            // discounts (useDiscounts) and anything else: resolve empty
            return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                order: vi.fn().mockResolvedValue({ data: [], error: null })
            } as any;
        });

        renderPage();

        // Wait for Loading to disappear
        await waitFor(() => {
            expect(screen.queryByText(/Loading tier analytics.../i)).not.toBeInTheDocument();
        });

        expect(screen.getByText('Customer Tiers')).toBeInTheDocument();
        // Check Summary Cards
        // Total Revenue: 15500 => ฿16K (page formats as ฿{revenue/1000 toFixed(0)}K)
        expect(screen.getByText('฿16K')).toBeInTheDocument();

        // Total Customers: 2 (shown in the summary card)
        expect(screen.getAllByText('2', { selector: '.text-4xl' }).length).toBeGreaterThan(0);

        // Check List of Top Performers
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
        expect(screen.getByText('John Doe')).toBeInTheDocument();

        // Check Tiers
        expect(screen.getAllByText(/Bronze/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Platinum/).length).toBeGreaterThan(0);
    });
});
