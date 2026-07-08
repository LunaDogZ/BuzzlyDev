import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEmployees } from '../useEmployees';
import { supabase } from '@/integrations/supabase/client';
import type { ReactNode } from 'react';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
    supabase: {
        from: vi.fn(),
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

describe('useEmployees', () => {
    let queryClient: QueryClient;

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

    describe('Fetching Employees', () => {
        it('should fetch employees with profiles and roles successfully', async () => {
            // Hook uses a single joined select (profile:employees_profile, role:role_employees),
            // so profile/role come embedded on the employee row
            const mockEmployees = [
                {
                    id: '1',
                    email: 'john@example.com',
                    user_id: 'user1',
                    role_employees_id: 'role1',
                    status: 'active',
                    approval_status: 'approved',
                    is_locked: false,
                    created_at: '2024-01-01',
                    updated_at: '2024-01-01',
                    profile: {
                        id: 'profile1',
                        first_name: 'John',
                        last_name: 'Doe',
                        profile_img: null,
                        aptitude: 'Developer',
                        last_active: '2024-01-01',
                    },
                    role: {
                        id: 'role1',
                        role_name: 'Developer',
                        description: 'Software Developer',
                    },
                },
            ];

            const mockProfiles = [
                {
                    id: 'profile1',
                    employees_id: '1',
                    first_name: 'John',
                    last_name: 'Doe',
                    profile_img: null,
                    aptitude: 'Developer',
                    last_active: '2024-01-01',
                },
            ];

            const mockRoles = [
                {
                    id: 'role1',
                    role_name: 'Developer',
                    description: 'Software Developer',
                },
            ];

            vi.mocked(supabase.from).mockImplementation((table: string) => {
                if (table === 'employees') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        order: vi.fn().mockResolvedValue({
                            data: mockEmployees,
                            error: null,
                        }),
                    } as any;
                }
                if (table === 'employees_profile') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        in: vi.fn().mockResolvedValue({
                            data: mockProfiles,
                            error: null,
                        }),
                    } as any;
                }
                if (table === 'role_employees') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        in: vi.fn().mockResolvedValue({
                            data: mockRoles,
                            error: null,
                        }),
                        order: vi.fn().mockResolvedValue({
                            data: mockRoles,
                            error: null,
                        }),
                    } as any;
                }
                return {} as any;
            });

            const { result } = renderHook(() => useEmployees(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(result.current.employees).toHaveLength(1);
            expect(result.current.employees[0]).toMatchObject({
                id: '1',
                email: 'john@example.com',
                profile: {
                    first_name: 'John',
                    last_name: 'Doe',
                    aptitude: 'Developer',
                },
                role: {
                    role_name: 'Developer',
                    description: 'Software Developer',
                },
            });
        });

        it('should handle employees without profile or role', async () => {
            const mockEmployees = [
                {
                    id: '1',
                    email: 'john@example.com',
                    user_id: null,
                    role_employees_id: null,
                    status: 'pending',
                    approval_status: 'pending',
                    is_locked: false,
                    created_at: '2024-01-01',
                    updated_at: '2024-01-01',
                },
            ];

            vi.mocked(supabase.from).mockImplementation((table: string) => {
                if (table === 'employees') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        order: vi.fn().mockResolvedValue({
                            data: mockEmployees,
                            error: null,
                        }),
                    } as any;
                }
                if (table === 'employees_profile') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        in: vi.fn().mockResolvedValue({
                            data: [],
                            error: null,
                        }),
                    } as any;
                }
                if (table === 'role_employees') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        in: vi.fn().mockResolvedValue({
                            data: [],
                            error: null,
                        }),
                        order: vi.fn().mockResolvedValue({
                            data: [],
                            error: null,
                        }),
                    } as any;
                }
                return {} as any;
            });

            const { result } = renderHook(() => useEmployees(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(result.current.employees[0]).toMatchObject({
                id: '1',
                email: 'john@example.com',
                profile: undefined,
                role: undefined,
            });
        });

        it('should return empty array when no employees exist', async () => {
            vi.mocked(supabase.from).mockImplementation((table: string) => {
                return {
                    select: vi.fn().mockReturnThis(),
                    order: vi.fn().mockResolvedValue({
                        data: [],
                        error: null,
                    }),
                    in: vi.fn().mockResolvedValue({
                        data: [],
                        error: null,
                    }),
                } as any;
            });

            const { result } = renderHook(() => useEmployees(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(result.current.employees).toEqual([]);
        });
    });

    describe('Creating Employee', () => {
        it('should create employee with profile successfully', async () => {
            const newEmployee = {
                email: 'new@example.com',
                first_name: 'New',
                last_name: 'Employee',
                role_employees_id: 'role1',
                aptitude: 'Developer',
            };

            const mockCreatedEmployee = {
                id: '123',
                email: newEmployee.email,
                role_employees_id: newEmployee.role_employees_id,
                status: 'active',
                approval_status: 'pending',
                created_at: '2024-01-01',
            };

            vi.mocked(supabase.from).mockImplementation((table: string) => {
                if (table === 'employees') {
                    return {
                        insert: vi.fn().mockReturnThis(),
                        select: vi.fn().mockReturnThis(),
                        single: vi.fn().mockResolvedValue({
                            data: mockCreatedEmployee,
                            error: null,
                        }),
                    } as any;
                }
                if (table === 'employees_profile') {
                    return {
                        insert: vi.fn().mockResolvedValue({
                            error: null,
                        }),
                    } as any;
                }
                return {} as any;
            });

            const { result } = renderHook(() => useEmployees(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            result.current.createEmployee.mutate(newEmployee);

            await waitFor(() => {
                expect(result.current.createEmployee.isSuccess).toBe(true);
            });
        });

        it('should handle create error', async () => {
            vi.mocked(supabase.from).mockImplementation(() => {
                return {
                    insert: vi.fn().mockReturnThis(),
                    select: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({
                        data: null,
                        error: { message: 'Email already exists' },
                    }),
                } as any;
            });

            const { result } = renderHook(() => useEmployees(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            result.current.createEmployee.mutate({
                email: 'duplicate@example.com',
                first_name: 'Test',
                last_name: 'User',
            });

            await waitFor(() => {
                expect(result.current.createEmployee.isError).toBe(true);
            });
        });
    });

    describe('Updating Employee', () => {
        it('should update employee successfully', async () => {
            const updates = {
                id: '123',
                profileId: 'profile1',
                updates: {
                    first_name: 'Updated',
                    last_name: 'Name',
                    role_employees_id: 'role2',
                    status: 'active' as const,
                },
            };

            vi.mocked(supabase.from).mockImplementation(() => {
                return {
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockResolvedValue({
                        error: null,
                    }),
                } as any;
            });

            const { result } = renderHook(() => useEmployees(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            result.current.updateEmployee.mutate(updates);

            await waitFor(() => {
                expect(result.current.updateEmployee.isSuccess).toBe(true);
            });
        });

        it('should update employee role', async () => {
            const updates = {
                id: '123',
                updates: {
                    role_employees_id: 'new-role',
                },
            };

            vi.mocked(supabase.from).mockImplementation(() => {
                return {
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockResolvedValue({
                        error: null,
                    }),
                } as any;
            });

            const { result } = renderHook(() => useEmployees(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            result.current.updateEmployee.mutate(updates);

            await waitFor(() => {
                expect(result.current.updateEmployee.isSuccess).toBe(true);
            });
        });
    });

    describe('Deleting Employee', () => {
        it('should delete employee and profile successfully', async () => {
            const employeeId = '123';

            vi.mocked(supabase.from).mockImplementation(() => {
                return {
                    delete: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockResolvedValue({
                        error: null,
                    }),
                } as any;
            });

            const { result } = renderHook(() => useEmployees(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            result.current.deleteEmployee.mutate(employeeId);

            await waitFor(() => {
                expect(result.current.deleteEmployee.isSuccess).toBe(true);
            });
        });
    });

    describe('Employee Status Management', () => {
        it('should suspend employee successfully', async () => {
            const employeeId = '123';

            // suspendEmployee first looks up the employee (select→eq→single), then updates (update→eq)
            vi.mocked(supabase.from).mockImplementation(() => {
                return {
                    select: vi.fn().mockReturnThis(),
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    order: vi.fn().mockResolvedValue({ data: [], error: null }),
                    single: vi.fn().mockResolvedValue({
                        data: { email: 'john@example.com', user_id: null },
                        error: null,
                    }),
                } as any;
            });

            const { result } = renderHook(() => useEmployees(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            result.current.suspendEmployee.mutate(employeeId);

            await waitFor(() => {
                expect(result.current.suspendEmployee.isSuccess).toBe(true);
            });
        });

        it('should reactivate employee successfully', async () => {
            const employeeId = '123';

            // reactivateEmployee first looks up the employee (select→eq→single), then updates (update→eq)
            vi.mocked(supabase.from).mockImplementation(() => {
                return {
                    select: vi.fn().mockReturnThis(),
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    order: vi.fn().mockResolvedValue({ data: [], error: null }),
                    single: vi.fn().mockResolvedValue({
                        data: { email: 'john@example.com', user_id: null },
                        error: null,
                    }),
                } as any;
            });

            const { result } = renderHook(() => useEmployees(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            result.current.reactivateEmployee.mutate(employeeId);

            await waitFor(() => {
                expect(result.current.reactivateEmployee.isSuccess).toBe(true);
            });
        });

        it('should handle lock status in update', async () => {
            const updates = {
                id: '123',
                updates: {
                    is_locked: true,
                },
            };

            vi.mocked(supabase.from).mockImplementation(() => {
                return {
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockResolvedValue({
                        error: null,
                    }),
                } as any;
            });

            const { result } = renderHook(() => useEmployees(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            result.current.updateEmployee.mutate(updates);

            await waitFor(() => {
                expect(result.current.updateEmployee.isSuccess).toBe(true);
            });
        });
    });

    describe('Edge Cases', () => {
        it('should handle multiple employees with same role', async () => {
            const sharedRole = { id: 'role1', role_name: 'Developer', description: 'Dev Role' };

            const mockEmployees = [
                { id: '1', email: 'user1@test.com', role_employees_id: 'role1', status: 'active', approval_status: 'approved', is_locked: false, user_id: null, created_at: '2024-01-01', updated_at: '2024-01-01', profile: null, role: sharedRole },
                { id: '2', email: 'user2@test.com', role_employees_id: 'role1', status: 'active', approval_status: 'approved', is_locked: false, user_id: null, created_at: '2024-01-01', updated_at: '2024-01-01', profile: null, role: sharedRole },
            ];

            const mockRoles = [sharedRole];

            vi.mocked(supabase.from).mockImplementation((table: string) => {
                if (table === 'employees') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        order: vi.fn().mockResolvedValue({ data: mockEmployees, error: null }),
                    } as any;
                }
                if (table === 'employees_profile') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        in: vi.fn().mockResolvedValue({ data: [], error: null }),
                    } as any;
                }
                if (table === 'role_employees') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        in: vi.fn().mockResolvedValue({ data: mockRoles, error: null }),
                        order: vi.fn().mockResolvedValue({ data: mockRoles, error: null }),
                    } as any;
                }
                return {} as any;
            });

            const { result } = renderHook(() => useEmployees(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(result.current.employees).toHaveLength(2);
            expect(result.current.employees[0].role?.role_name).toBe('Developer');
            expect(result.current.employees[1].role?.role_name).toBe('Developer');
        });

        it('should handle employee update without profile', async () => {
            const updates = {
                id: '123',
                updates: {
                    status: 'suspended' as const,
                },
            };

            vi.mocked(supabase.from).mockImplementation(() => {
                return {
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockResolvedValue({
                        error: null,
                    }),
                } as any;
            });

            const { result } = renderHook(() => useEmployees(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            result.current.updateEmployee.mutate(updates);

            await waitFor(() => {
                expect(result.current.updateEmployee.isSuccess).toBe(true);
            });
        });
    });
});
