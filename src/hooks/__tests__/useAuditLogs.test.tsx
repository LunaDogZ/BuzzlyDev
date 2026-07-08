import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuditLogs, useAuditLogStats } from '../useAuditLogs';
import { supabase } from '@/integrations/supabase/client';
import type { ReactNode } from 'react';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
    supabase: {
        from: vi.fn(),
    },
}));

describe('useAuditLogs', () => {
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

    describe('useAuditLogs Data Fetching', () => {
        it('should fetch audit logs with user details from the unified view', async () => {
            // The audit_logs_view already joins user_email/user_role for employees and customers
            const mockLogs = [
                {
                    id: '1',
                    user_id: 'user1',
                    action_type_id: 'action1',
                    description: 'User logged in',
                    category: 'authentication',
                    status: 'success',
                    ip_address: null,
                    metadata: {},
                    created_at: '2024-01-01',
                    user_email: 'employee@example.com',
                    user_role: 'Admin',
                    display_action_name: 'Login',
                },
                {
                    id: '2',
                    user_id: 'customer1',
                    action_type_id: 'action2',
                    description: 'Customer action',
                    category: 'data',
                    status: 'success',
                    ip_address: null,
                    metadata: {},
                    created_at: '2024-01-02',
                    user_email: 'customer@example.com',
                    user_role: 'Customer',
                    display_action_name: 'Export',
                },
            ];

            const mockQueryBuilder = {
                select: vi.fn().mockReturnThis(),
                in: vi.fn().mockReturnThis(),
                or: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                ilike: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                range: vi.fn().mockResolvedValue({ data: mockLogs, error: null, count: 2 }),
            };

            vi.mocked(supabase.from).mockImplementation((table) => {
                if (table === 'audit_logs_view') {
                    return mockQueryBuilder as any;
                }
                return { select: vi.fn().mockReturnThis() } as any;
            });

            const { result } = renderHook(() => useAuditLogs(), { wrapper });

            await waitFor(() => {
                expect(result.current.isSuccess).toBe(true);
            });

            const data = result.current.data!;
            expect(data.logs).toHaveLength(2);

            // Employee
            expect(data.logs[0].user_email).toBe('employee@example.com');
            expect(data.logs[0].user_role).toBe('Admin');
            expect(data.logs[0].action_name).toBe('Login');

            // Customer
            expect(data.logs[1].user_email).toBe('customer@example.com');
            expect(data.logs[1].user_role).toBe('Customer');

            expect(data.totalCount).toBe(2);
            expect(data.totalPages).toBe(1);
        });

        it('should use correct query key and mapping for category', async () => {
            const mockLogs = [
                { category: 'auth', status: 'success', display_action_name: 'Login' },
            ];

            const mockQueryBuilder = {
                select: vi.fn().mockReturnThis(),
                in: vi.fn().mockReturnThis(),
                or: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                ilike: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                range: vi.fn().mockResolvedValue({ data: mockLogs, error: null, count: 1 }),
            };

            vi.mocked(supabase.from).mockReturnValue(mockQueryBuilder as any);

            const { result } = renderHook(() => useAuditLogs('authentication'), { wrapper });

            await waitFor(() => {
                expect(result.current.isSuccess).toBe(true);
            });

            // Verify .in was called with mapped categories
            expect(mockQueryBuilder.in).toHaveBeenCalledWith('category', expect.arrayContaining(['authentication', 'auth', 'login']));
            expect(result.current.data!.logs).toHaveLength(1);
        });
    });

    describe('useAuditLogStats', () => {
        // useAuditLogStats runs six parallel head-count queries filtered by category/status.
        // This builder is thenable and resolves a count based on the filters it saw.
        const makeCountBuilder = (countsByCategory: Record<string, number>, failedCount: number) => {
            const filters: Array<[string, unknown]> = [];
            const builder: Record<string, unknown> = {
                select: vi.fn(() => builder),
                in: vi.fn((col: string, vals: unknown) => {
                    filters.push([col, vals]);
                    return builder;
                }),
                eq: vi.fn((col: string, val: unknown) => {
                    filters.push([col, [val]]);
                    return builder;
                }),
                then: (onfulfilled: (value: { count: number; error: null }) => unknown) => {
                    const categoryFilter = filters.find(([col]) => col === 'category');
                    const statusFilter = filters.find(([col]) => col === 'status');
                    const categories = (categoryFilter?.[1] ?? []) as string[];
                    let count = 0;
                    for (const cat of categories) {
                        if (countsByCategory[cat] !== undefined) {
                            count = statusFilter ? failedCount : countsByCategory[cat];
                            break;
                        }
                    }
                    return Promise.resolve({ count, error: null }).then(onfulfilled);
                },
            };
            return builder;
        };

        it('should calculate stats correctly', async () => {
            vi.mocked(supabase.from).mockImplementation((table: string) => {
                if (table === 'audit_logs_enhanced') {
                    return makeCountBuilder(
                        { authentication: 3, data: 1, security: 1, settings: 1, feature: 2 },
                        1,
                    ) as any;
                }
                return {} as any;
            });

            const { result } = renderHook(() => useAuditLogStats(), { wrapper });

            await waitFor(() => {
                expect(result.current.isSuccess).toBe(true);
            });

            expect(result.current.data).toEqual({
                totalLogins: 3,
                failedLogins: 1,
                dataExports: 1,
                securityActions: 1,
                settingsChanges: 1,
                featureViews: 2,
            });
        });

        it('should handle empty logs', async () => {
            vi.mocked(supabase.from).mockImplementation((table: string) => {
                if (table === 'audit_logs_enhanced') {
                    return makeCountBuilder({}, 0) as any;
                }
                return {} as any;
            });

            const { result } = renderHook(() => useAuditLogStats(), { wrapper });

            await waitFor(() => {
                expect(result.current.isSuccess).toBe(true);
            });

            expect(result.current.data).toEqual({
                totalLogins: 0,
                failedLogins: 0,
                dataExports: 0,
                securityActions: 0,
                settingsChanges: 0,
                featureViews: 0,
            });
        });
    });
});
