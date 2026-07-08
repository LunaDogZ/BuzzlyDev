import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useServerHealth, useDataPipelines, useExternalAPIStatus, useErrorLogStats, usePerformanceMetrics } from '../useAdminMonitor';
import { supabase } from '@/integrations/supabase/client';
import type { ReactNode } from 'react';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
    supabase: {
        from: vi.fn(),
        auth: {
            getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
        },
        channel: vi.fn(() => ({
            on: vi.fn().mockReturnThis(),
            subscribe: vi.fn().mockReturnThis(),
        })),
        removeChannel: vi.fn(),
    },
}));

describe('useAdminMonitor', () => {
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
    });

    describe('useServerHealth', () => {
        it('should fetch server health data successfully', async () => {
            const mockServers = [
                { id: '1', hostname: 'server-1', status: 'healthy', cpu_usage_percent: 45, used_memory: 4000, total_memory: 8000, ip_address: '192.168.1.1' },
                { id: '2', hostname: 'server-2', status: 'warning', cpu_usage_percent: 85, used_memory: 7000, total_memory: 8000, ip_address: '192.168.1.2' },
            ];

            vi.mocked(supabase.from).mockImplementation((table: string) => {
                if (table === 'server') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        order: vi.fn().mockResolvedValue({ data: mockServers, error: null }),
                    } as any;
                }
                return {} as any;
            });

            const { result } = renderHook(() => useServerHealth(), { wrapper });

            await waitFor(() => {
                expect(result.current.isSuccess).toBe(true);
            });

            expect(result.current.data).toHaveLength(2);
            expect(result.current.data).toEqual(mockServers);
        });

        it('should handle empty server list', async () => {
            vi.mocked(supabase.from).mockImplementation((table: string) => {
                if (table === 'server') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        order: vi.fn().mockResolvedValue({ data: [], error: null }),
                    } as any;
                }
                return {} as any;
            });

            const { result } = renderHook(() => useServerHealth(), { wrapper });

            await waitFor(() => {
                expect(result.current.isSuccess).toBe(true);
            });

            expect(result.current.data).toEqual([]);
        });
    });

    describe('useDataPipelines', () => {
        it('should fetch pipelines data successfully', async () => {
            const mockPipelines = [
                { id: '1', name: 'ETL Pipeline', status: 'success', schedule_cron: '0 0 * * *', last_run_at: '2024-01-01', next_run_at: '2024-01-02' },
            ];

            vi.mocked(supabase.from).mockImplementation((table: string) => {
                if (table === 'data_pipeline') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        order: vi.fn().mockResolvedValue({ data: mockPipelines, error: null }),
                    } as any;
                }
                return {} as any;
            });

            const { result } = renderHook(() => useDataPipelines(), { wrapper });

            await waitFor(() => {
                expect(result.current.isSuccess).toBe(true);
            });

            expect(result.current.data).toEqual(mockPipelines);
        });
    });

    describe('useExternalAPIStatus', () => {
        it('should fetch external API status and map platform names', async () => {
            const mockApiStatus = [
                {
                    id: '1',
                    platform_id: 'p1',
                    last_status_code: 200,
                    latency_ms: 150,
                    color_code: 'green',
                    platforms: { name: 'Google Ads' }
                },
            ];

            const expectedResult = [
                {
                    ...mockApiStatus[0],
                    platform_name: 'Google Ads',
                },
            ];

            vi.mocked(supabase.from).mockImplementation((table: string) => {
                if (table === 'external_api_status') {
                    return {
                        select: vi.fn().mockResolvedValue({ data: mockApiStatus, error: null }),
                    } as any;
                }
                return {} as any;
            });

            const { result } = renderHook(() => useExternalAPIStatus(), { wrapper });

            await waitFor(() => {
                expect(result.current.isSuccess).toBe(true);
            });

            expect(result.current.data).toEqual(expectedResult);
        });
    });

    describe('useErrorLogStats', () => {
        it('should calculate error statistics correctly', async () => {
            const mockLogs = [
                { level: 'error', created_at: '2024-01-01' },
                { level: 'ERROR', created_at: '2024-01-01' },
                { level: 'warning', created_at: '2024-01-01' },
                { level: 'info', created_at: '2024-01-01' },
                { level: 'debug', created_at: '2024-01-01' },
            ];

            // Mock auth user
            vi.mocked(supabase.auth.getUser).mockResolvedValue({
                data: { user: { id: 'user1', email: 'test@test.com' } },
                error: null
            } as any);

            // Mock employee verification (optional but good to mock to match implementation)
            vi.mocked(supabase.from).mockImplementation((table: string) => {
                if (table === 'employees') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
                    } as any;
                }
                if (table === 'error_logs') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        order: vi.fn().mockReturnThis(),
                        limit: vi.fn().mockResolvedValue({ data: mockLogs, error: null }),
                    } as any;
                }
                return {} as any;
            });

            const { result } = renderHook(() => useErrorLogStats(), { wrapper });

            await waitFor(() => {
                expect(result.current.isSuccess).toBe(true);
            });

            // Hook returns the raw logs; aggregation now happens in the consuming component
            expect(result.current.data).toEqual(mockLogs);
        });
    });

    describe('usePerformanceMetrics', () => {
        it('should calculate performance metrics correctly', async () => {
            const mockServers = [
                { cpu_usage_percent: 50, used_memory: 4000, total_memory: 8000, status: 'healthy' }, // 50% mem
                { cpu_usage_percent: 30, used_memory: 2000, total_memory: 8000, status: 'healthy' }, // 25% mem
                { cpu_usage_percent: 90, used_memory: 7000, total_memory: 8000, status: 'warning' },
                { cpu_usage_percent: 0, used_memory: 0, total_memory: 8000, status: 'critical' },
            ];

            // Healthy servers:
            // CPU: (50 + 30) / 2 = 40%
            // Memory: (6000 / 16000) * 100 = 37.5 -> 38%

            vi.mocked(supabase.from).mockImplementation((table: string) => {
                if (table === 'server') {
                    return {
                        select: vi.fn().mockResolvedValue({ data: mockServers, error: null }),
                    } as any;
                }
                return {} as any;
            });

            const { result } = renderHook(() => usePerformanceMetrics(), { wrapper });

            await waitFor(() => {
                expect(result.current.isSuccess).toBe(true);
            });

            expect(result.current.data).toEqual({
                avgCpuUsage: 40,
                avgMemoryUsage: 38,
                avgDiskUsage: 0,
                totalServers: 4,
                healthyServers: 2,
                warningServers: 1,
                criticalServers: 1,
            });
        });

        it('should handle zero active servers', async () => {
            const mockServers = [
                { cpu_usage_percent: 0, used_memory: 0, total_memory: 8000, status: 'critical' },
            ];

            vi.mocked(supabase.from).mockImplementation((table: string) => {
                if (table === 'server') {
                    return {
                        select: vi.fn().mockResolvedValue({ data: mockServers, error: null }),
                    } as any;
                }
                return {} as any;
            });

            const { result } = renderHook(() => usePerformanceMetrics(), { wrapper });

            await waitFor(() => {
                expect(result.current.isSuccess).toBe(true);
            });

            expect(result.current.data).toEqual({
                avgCpuUsage: 0,
                avgMemoryUsage: 0,
                avgDiskUsage: 0,
                totalServers: 1,
                healthyServers: 0,
                warningServers: 0,
                criticalServers: 1,
            });
        });
    });
});
