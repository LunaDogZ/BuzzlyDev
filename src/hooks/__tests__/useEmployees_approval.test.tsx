import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useEmployees } from '../useEmployees';
import { supabase } from '@/integrations/supabase/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { auditSecurity } from '@/lib/auditLogger';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
    supabase: {
        from: vi.fn(),
        auth: {
            // The real client also exposes getSession, which getCurrentUser now asks first.
            // Answering "nothing stored" sends it down the getUser path these tests stub.
            getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
            getUser: vi.fn(),
        },
    },
}));

// Mock Audit Logger
vi.mock('@/lib/auditLogger', () => ({
    auditSecurity: {
        employeeApproved: vi.fn(),
        employeeRejected: vi.fn(),
    },
}));

// Mock Sonner (to avoid errors during mutation)
vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

describe('useEmployees Approval Logic', () => {
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

        // Default auth mock
        vi.mocked(supabase.auth.getUser).mockResolvedValue({
            data: { user: { id: 'admin-123' } },
            error: null,
        } as any);
    });

    it('should approve an employee and log audit', async () => {
        const mockEmployee = { user_id: 'user-1', email: 'test@example.com' };

        // Mock Supabase chain for approveEmployee
        // 1. select().eq().single() -> returns employee data
        // 2. update().eq() -> updates status
        vi.mocked(supabase.from).mockImplementation((table: string) => {
            if (table === 'employees') {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockImplementation((field, value) => {
                        if (field === 'id' && value === 'emp-1') {
                            return {
                                single: vi.fn().mockResolvedValue({ data: mockEmployee, error: null }),
                            };
                        }
                        return { single: vi.fn() };
                    }),
                    update: vi.fn().mockReturnThis(),
                } as any;
            }
            return {} as any;
        });

        // We need a more robust mock because the hook calls:
        // await supabase.from("employees").select(...).eq("id", id).single();
        // await supabase.from("employees").update(...).eq("id", id);

        // Refined mock:
        vi.mocked(supabase.from).mockImplementation((table: string) => {
            const chain = {
                select: vi.fn().mockReturnThis(),
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: mockEmployee, error: null }),
            };
            return chain as any;
        });

        const { result } = renderHook(() => useEmployees(), { wrapper });

        await result.current.approveEmployee.mutateAsync('emp-1');

        // Verify update was called
        expect(supabase.from).toHaveBeenCalledWith('employees');

        // Verify audit log
        expect(auditSecurity.employeeApproved).toHaveBeenCalledWith(
            'admin-123',
            'user-1',
            'test@example.com'
        );
    });

    it('should reject an employee and log audit', async () => {
        const mockEmployee = { user_id: 'user-1', email: 'test@example.com' };

        vi.mocked(supabase.from).mockImplementation((table: string) => {
            const chain = {
                select: vi.fn().mockReturnThis(),
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: mockEmployee, error: null }),
            };
            return chain as any;
        });

        const { result } = renderHook(() => useEmployees(), { wrapper });

        await result.current.rejectEmployee.mutateAsync('emp-1');

        expect(auditSecurity.employeeRejected).toHaveBeenCalledWith(
            'admin-123',
            'user-1',
            'test@example.com'
        );
    });
});
