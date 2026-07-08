import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProductUsage from '../ProductUsage';
import { BrowserRouter } from 'react-router-dom';
import * as OwnerMetricsHooks from '@/hooks/useOwnerMetrics';

// Mock the hooks
vi.mock('@/hooks/useOwnerMetrics', async (importOriginal) => {
    const actual = await importOriginal() as object;
    return {
        ...actual,
        useProductUsageMetrics: vi.fn(),
        useUserSegments: vi.fn(),
        useAARRRMetrics: vi.fn(),
        useFeatureUsageMetrics: vi.fn(),
        useOwnerAARRRTimeSeriesData: vi.fn(),
        usePlatformUserProfile: vi.fn(),
        useCustomerProfileAggregates: vi.fn(),
        useOwnerCustomerPersonas: vi.fn(),
        useOwnerPersonaTimeSeries: vi.fn(),
        useUserArchetypes: vi.fn(),
        useFeatureUsageByPersona: vi.fn(),
        useFrictionByPersona: vi.fn(),
    };
});

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

// Mock icon components
vi.mock('lucide-react', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...(actual as any),
    };
});

// Mock UI Components that use Radix primitives
vi.mock('@/components/ui/tabs', () => ({
    Tabs: ({ children, defaultValue }: any) => <div data-testid="tabs" data-default={defaultValue}>{children}</div>,
    TabsList: ({ children }: any) => <div data-testid="tabs-list">{children}</div>,
    TabsTrigger: ({ children, value, onClick }: any) => (
        <button data-testid={`tab-trigger-${value}`} onClick={onClick}>
            {children}
        </button>
    ),
    TabsContent: ({ children, value }: any) => <div data-testid={`tab-content-${value}`}>{children}</div>,
}));

describe('ProductUsage Page', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const defaultOwnerMocks = () => {
        vi.mocked(OwnerMetricsHooks.useAARRRMetrics).mockReturnValue({ isLoading: false, data: [], isError: false } as any);
        vi.mocked(OwnerMetricsHooks.useFeatureUsageMetrics).mockReturnValue({ isLoading: false, data: undefined, isError: false } as any);
        vi.mocked(OwnerMetricsHooks.useOwnerAARRRTimeSeriesData).mockReturnValue({ isLoading: false, data: [] } as any);
        vi.mocked(OwnerMetricsHooks.usePlatformUserProfile).mockReturnValue({ isLoading: false, data: [] } as any);
        vi.mocked(OwnerMetricsHooks.useCustomerProfileAggregates).mockReturnValue({ isLoading: false, data: { totalCustomers: 0, byGender: [], byTier: [] } } as any);
        vi.mocked(OwnerMetricsHooks.useOwnerCustomerPersonas).mockReturnValue({ isLoading: false, data: [] } as any);
        vi.mocked(OwnerMetricsHooks.useUserArchetypes).mockReturnValue({
            isLoading: false,
            data: [],
        } as any);
        vi.mocked(OwnerMetricsHooks.useOwnerPersonaTimeSeries).mockReturnValue({
            isLoading: false,
            data: undefined,
        } as any);
        vi.mocked(OwnerMetricsHooks.useFeatureUsageByPersona).mockReturnValue({
            isLoading: false,
            data: [],
        } as any);
        vi.mocked(OwnerMetricsHooks.useFrictionByPersona).mockReturnValue({
            isLoading: false,
            data: [],
        } as any);
    };

    it('renders loading state when any hook is loading', () => {
        vi.mocked(OwnerMetricsHooks.useProductUsageMetrics).mockReturnValue({
            isLoading: true, data: undefined, isError: false
        } as any);
        vi.mocked(OwnerMetricsHooks.useUserSegments).mockReturnValue({
            isLoading: false, data: [], isError: false
        } as any);
        defaultOwnerMocks();

        render(
            <BrowserRouter>
                <div id="root">
                    <ProductUsage />
                </div>
            </BrowserRouter>
        );

        expect(screen.getByText(/Initializing Analytics Core.../i)).toBeInTheDocument();
    });

    it('renders empty state when no data is available', () => {
        vi.mocked(OwnerMetricsHooks.useProductUsageMetrics).mockReturnValue({
            isLoading: false, data: { totalUsers: 0 } as any, isError: false
        } as any);
        vi.mocked(OwnerMetricsHooks.useUserSegments).mockReturnValue({
            isLoading: false, data: [], isError: false
        } as any);
        defaultOwnerMocks();

        render(
            <BrowserRouter>
                <div id="root">
                    <ProductUsage />
                </div>
            </BrowserRouter>
        );

        expect(screen.getByText(/No Usage Data Detected/i)).toBeInTheDocument();
    });

    it('renders dashboard with data correctly', () => {
        vi.mocked(OwnerMetricsHooks.useProductUsageMetrics).mockReturnValue({
            isLoading: false,
            data: {
                totalUsers: 1250,
                mau: 800,
                dau: 200,
                dauMauRatio: 25
            } as any,
            isError: false
        } as any);

        vi.mocked(OwnerMetricsHooks.useAARRRMetrics).mockReturnValue({
            isLoading: false,
            data: [
                { name: 'Acquisition', value: 1000, percentage: 100 },
                { name: 'Activation', value: 500, percentage: 50 }
            ],
            isError: false
        } as any);

        vi.mocked(OwnerMetricsHooks.useUserSegments).mockReturnValue({
            isLoading: false,
            data: [{ type: 'Enterprise', count: 50, percentage: 10 }],
            isError: false
        } as any);

        defaultOwnerMocks();

        render(
            <BrowserRouter>
                <div id="root">
                    <ProductUsage />
                </div>
            </BrowserRouter>
        );

        // Header
        expect(screen.getByText('Product Usage')).toBeInTheDocument();

        // Quick Stats (always visible)
        expect(screen.getByText('1,250')).toBeInTheDocument();
    });

    it('can see Persona tab content', () => {
        vi.mocked(OwnerMetricsHooks.useProductUsageMetrics).mockReturnValue({
            isLoading: false,
            data: { totalUsers: 100 } as any,
            isError: false
        } as any);

        vi.mocked(OwnerMetricsHooks.useAARRRMetrics).mockReturnValue({
            isLoading: false,
            data: [{ name: 'Acquisition', value: 100, percentage: 100 }],
            isError: false
        } as any);

        vi.mocked(OwnerMetricsHooks.useUserSegments).mockReturnValue({
            isLoading: false,
            data: [{ type: 'Small Business', count: 10, percentage: 50 }],
            isError: false
        } as any);

        defaultOwnerMocks();

        render(
            <BrowserRouter>
                <div id="root">
                    <ProductUsage />
                </div>
            </BrowserRouter>
        );

        expect(screen.getByText(/Most Active Segment/i)).toBeInTheDocument();
        expect(screen.getByTestId('tab-trigger-persona')).toBeInTheDocument();
    });
});
