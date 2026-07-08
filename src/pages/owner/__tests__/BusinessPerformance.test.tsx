import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import BusinessPerformance from '../BusinessPerformance';
import { BrowserRouter } from 'react-router-dom';
import * as OwnerMetricsHooks from '@/hooks/useOwnerMetrics';

// Mock the hooks
vi.mock('@/hooks/useOwnerMetrics', () => ({
    useSubscriptionMetrics: vi.fn(),
    useCohortAnalysis: vi.fn(),
    useSurvivalAnalysis: vi.fn(),
}));

// Mock Recharts
// Recharts renders SVGs which are hard to test in JSDOM without proper mocking/polyfilling.
// Often mocking ResponsiveContainer to render children is enough, or mocking modules entirely if we just want to ensure presence.
vi.mock('recharts', async (importOriginal) => {
    const original = await importOriginal();
    return {
        ...(original as any),
        ResponsiveContainer: ({ children }: any) => <div className="recharts-responsive-container">{children}</div>,
    };
});

describe('BusinessPerformance Page', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders loading state correctly', () => {
        vi.mocked(OwnerMetricsHooks.useSubscriptionMetrics).mockReturnValue({ isLoading: true } as any);
        vi.mocked(OwnerMetricsHooks.useCohortAnalysis).mockReturnValue({ isLoading: false } as any);
        vi.mocked(OwnerMetricsHooks.useSurvivalAnalysis).mockReturnValue({ isLoading: false } as any);

        render(
            <BrowserRouter>
                <BusinessPerformance />
            </BrowserRouter>
        );

        expect(screen.getByText(/Analyzing Revenue Streams.../i)).toBeInTheDocument();
    });

    it('renders empty state correctly', () => {
        vi.mocked(OwnerMetricsHooks.useSubscriptionMetrics).mockReturnValue({
            isLoading: false,
            data: { currentMrr: 0, activeSubscriptions: 0, arr: 0, mrrGrowth: 0, monthlyData: [], breakdown: { newMrr: 0, expansion: 0, churn: 0 } },
            refetch: vi.fn()
        } as any);
        vi.mocked(OwnerMetricsHooks.useCohortAnalysis).mockReturnValue({
            isLoading: false,
            data: [],
            refetch: vi.fn()
        } as any);
        vi.mocked(OwnerMetricsHooks.useSurvivalAnalysis).mockReturnValue({
            isLoading: false,
            data: [],
            refetch: vi.fn()
        } as any);

        render(
            <BrowserRouter>
                <BusinessPerformance />
            </BrowserRouter>
        );

        expect(screen.getByText(/No Performance Data/i)).toBeInTheDocument();
    });

    it('renders populated data correctly', () => {
        // Page reads MRR figures from timeRangeData keyed by the selected range (default '1m')
        vi.mocked(OwnerMetricsHooks.useSubscriptionMetrics).mockReturnValue({
            isLoading: false,
            data: {
                activeSubscriptions: 100,
                monthlyData: [{ month: 'Jan', mrr: 48000, growth: 5 }],
                timeRangeData: {
                    '1m': {
                        currentMrr: 50000,
                        arr: 600000,
                        mrrGrowth: 5.5,
                        breakdown: { newMrr: 5000, expansion: 1000, churn: 500 },
                    },
                },
            },
            refetch: vi.fn()
        } as any);

        vi.mocked(OwnerMetricsHooks.useCohortAnalysis).mockReturnValue({
            isLoading: false,
            data: [{ cohort: 'Jan 2024', cohortSize: 50, retentionData: [100, 90, 80] }],
            refetch: vi.fn()
        } as any);

        vi.mocked(OwnerMetricsHooks.useSurvivalAnalysis).mockReturnValue({
            isLoading: false,
            data: [{ day: 1, survivalRate: 98, totalUsers: 1000, activeUsers: 980, churnedUsers: 20 }],
            refetch: vi.fn()
        } as any);

        render(
            <BrowserRouter>
                <BusinessPerformance />
            </BrowserRouter>
        );

        expect(screen.getByText('Business Performance')).toBeInTheDocument();
        expect(screen.getAllByText('฿50,000').length).toBeGreaterThan(0); // MRR (stat card + summary)
        expect(screen.getByText('100')).toBeInTheDocument();   // Active Subs (found in card)

        // Check for tab content (Revenue is default)
        expect(screen.getAllByText('Monthly Recurring Revenue').length).toBeGreaterThan(0);
    });
});
