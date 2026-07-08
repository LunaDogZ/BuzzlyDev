import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MonitorDashboard from '@/pages/dev/MonitorDashboard';
import * as useAdminMonitor from '@/hooks/useAdminMonitor';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the hooks
vi.mock('@/hooks/useAdminMonitor', () => ({
    useServerHealth: vi.fn(),
    useDataPipelines: vi.fn(),
    useExternalAPIStatus: vi.fn(),
    useErrorLogStats: vi.fn(),
    usePerformanceMetrics: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
    useNavigate: () => vi.fn()
}));

describe('MonitorDashboard', () => {
    let queryClient: QueryClient;

    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    beforeEach(() => {
        queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
            },
        });
        vi.clearAllMocks();

        // Default mock implementations
        vi.mocked(useAdminMonitor.useServerHealth).mockReturnValue({
            data: [],
            isLoading: false,
            refetch: vi.fn(),
        } as any);
        vi.mocked(useAdminMonitor.useDataPipelines).mockReturnValue({
            data: [],
            isLoading: false,
            refetch: vi.fn(),
        } as any);
        vi.mocked(useAdminMonitor.useExternalAPIStatus).mockReturnValue({
            data: [],
            isLoading: false,
            refetch: vi.fn(),
        } as any);
        // useErrorLogStats returns raw logs; the page aggregates them client-side
        vi.mocked(useAdminMonitor.useErrorLogStats).mockReturnValue({
            data: [],
            isLoading: false,
            refetch: vi.fn(),
        } as any);
        vi.mocked(useAdminMonitor.usePerformanceMetrics).mockReturnValue({
            data: {
                avgCpuUsage: 0,
                avgMemoryUsage: 0,
                totalServers: 0,
                healthyServers: 0,
                warningServers: 0,
                criticalServers: 0,
            },
            isLoading: false,
            refetch: vi.fn(),
        } as any);
    });

    it('should render the dashboard header and system status', () => {
        render(<MonitorDashboard />, { wrapper });

        expect(screen.getByText('Monitor Dashboard')).toBeInTheDocument();
        expect(screen.getByText('System Status')).toBeInTheDocument();
        expect(screen.getByText('CPU Usage')).toBeInTheDocument();
        expect(screen.getByText('Memory Usage')).toBeInTheDocument();
        expect(screen.getByText('Errors (Total)')).toBeInTheDocument();
    });

    it('should display loading states', () => {
        vi.mocked(useAdminMonitor.useServerHealth).mockReturnValue({
            data: [],
            isLoading: true,
            refetch: vi.fn(),
        } as any);

        render(<MonitorDashboard />, { wrapper });

        // Check for specific loading text in the Servers tab content
        expect(screen.getByText('Loading server infrastructure details...')).toBeInTheDocument();
    });

    it('should display server data correctly', async () => {
        const mockServers = [
            { id: '1', hostname: 'server-1', status: 'healthy', cpu_usage_percent: 45, used_memory: 4000, total_memory: 8000, ip_address: '192.168.1.1' },
        ];

        vi.mocked(useAdminMonitor.useServerHealth).mockReturnValue({
            data: mockServers,
            isLoading: false,
            refetch: vi.fn(),
        } as any);

        render(<MonitorDashboard />, { wrapper });

        expect(screen.getByText('server-1')).toBeInTheDocument();
        expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
        expect(screen.getByText('45%')).toBeInTheDocument();
    });

    it('should display critical system status when critical servers exist', () => {
        vi.mocked(useAdminMonitor.usePerformanceMetrics).mockReturnValue({
            data: {
                avgCpuUsage: 0,
                avgMemoryUsage: 0,
                totalServers: 1,
                healthyServers: 0,
                warningServers: 0,
                criticalServers: 1,
            },
            isLoading: false,
            refetch: vi.fn(),
        } as any);

        render(<MonitorDashboard />, { wrapper });

        // Iterate over all elements with text "Critical"
        const criticalElements = screen.getAllByText('Critical');
        // We expect at least one of them to be the system status indicator
        expect(criticalElements.length).toBeGreaterThan(0);
        // Ideally we'd target more specifically, but given the component structure, this verifies the text is present.
        // The first card is System Status, so it should be there.
    });

    it('should display critical errors card when critical logs exist', async () => {
        // Raw logs within the last 24h: 2 critical, 1 error, 1 warning, 1 info
        const now = new Date().toISOString();
        vi.mocked(useAdminMonitor.useErrorLogStats).mockReturnValue({
            data: [
                { level: 'critical', message: 'Crash A', created_at: now },
                { level: 'critical', message: 'Crash B', created_at: now },
                { level: 'error', message: 'Error A', created_at: now },
                { level: 'warning', message: 'Warn A', created_at: now },
                { level: 'info', message: 'Info A', created_at: now },
            ],
            isLoading: false,
            refetch: vi.fn(),
        } as any);

        const user = userEvent.setup();
        render(<MonitorDashboard />, { wrapper });

        // Switch to Errors tab
        const errorsTab = screen.getByRole('tab', { name: /Errors/i });
        await user.click(errorsTab);

        await waitFor(() => {
            expect(screen.getByText('System Error Analytics')).toBeInTheDocument();
        });

        // The Critical summary card shows the aggregated count of 2 in red
        const criticalCount = screen.getByText('2');
        expect(criticalCount).toBeInTheDocument();
        expect(criticalCount.className).toContain('text-red-400');
    });

    it('should call refetch on all hooks when refresh button is clicked', async () => {
        const user = userEvent.setup();
        const refetchServers = vi.fn();
        const refetchPipelines = vi.fn();
        const refetchApis = vi.fn();
        const refetchErrors = vi.fn();
        const refetchPerf = vi.fn();

        vi.mocked(useAdminMonitor.useServerHealth).mockReturnValue({ data: [], isLoading: false, refetch: refetchServers } as any);
        vi.mocked(useAdminMonitor.useDataPipelines).mockReturnValue({ data: [], isLoading: false, refetch: refetchPipelines } as any);
        vi.mocked(useAdminMonitor.useExternalAPIStatus).mockReturnValue({ data: [], isLoading: false, refetch: refetchApis } as any);
        vi.mocked(useAdminMonitor.useErrorLogStats).mockReturnValue({ data: [], isLoading: false, refetch: refetchErrors } as any);
        vi.mocked(useAdminMonitor.usePerformanceMetrics).mockReturnValue({ data: {}, isLoading: false, refetch: refetchPerf } as any);

        render(<MonitorDashboard />, { wrapper });

        const refreshButton = screen.getByText('Refresh');
        await user.click(refreshButton);

        await waitFor(() => {
            expect(refetchServers).toHaveBeenCalled();
            expect(refetchPipelines).toHaveBeenCalled();
            expect(refetchApis).toHaveBeenCalled();
            expect(refetchErrors).toHaveBeenCalled();
            expect(refetchPerf).toHaveBeenCalled();
        });
    });

    it('should switch tabs correctly', async () => {
        const user = userEvent.setup();
        render(<MonitorDashboard />, { wrapper });

        const pipelinesTab = screen.getByRole('tab', { name: /Data Pipelines/i });
        await user.click(pipelinesTab);

        await waitFor(() => {
            expect(screen.getByPlaceholderText('Search pipelines...')).toBeInTheDocument();
        });

        const errorsTab = screen.getByRole('tab', { name: /Errors/i });
        await user.click(errorsTab);

        await waitFor(() => {
            expect(screen.getByText('System Error Analytics')).toBeInTheDocument();
        });
    });
});
