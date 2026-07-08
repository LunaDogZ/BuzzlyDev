import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Auth from '@/pages/Auth';
import { supabase } from '@/integrations/supabase/client';
import { auditAuth } from '@/lib/auditLogger';
import { useToast } from '@/hooks/use-toast';

// Mock dependencies
vi.mock('@/integrations/supabase/client', () => ({
    supabase: {
        auth: {
            signInWithPassword: vi.fn(),
            signOut: vi.fn(),
            onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
            getSession: vi.fn(() => Promise.resolve({ data: { session: null } })),
        },
        from: vi.fn(),
    },
}));

vi.mock('@/lib/auditLogger', () => ({
    auditAuth: {
        loginFailed: vi.fn(),
        login: vi.fn(),
    }
}));

vi.mock('@/hooks/use-toast', () => ({
    useToast: vi.fn(() => ({ toast: vi.fn() }))
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual as any,
        useNavigate: () => mockNavigate,
        useLocation: () => ({ state: null }),
    };
});

describe('Auth Component - Suspended Employee Logic', () => {
    const mockToast = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        (useToast as any).mockReturnValue({ toast: mockToast });
    });

    const renderComponent = () => {
        return render(
            <BrowserRouter>
                <Auth />
            </BrowserRouter>
        );
    };

    it('should sign out and show error toast when employee is suspended', async () => {
        // 1. Mock sign in success
        (supabase.auth.signInWithPassword as any).mockResolvedValue({
            data: { user: { id: 'test-user-id', email: 'suspended@buzzly.com' } },
            error: null
        });

        // 2. Mock exactly one suspended employee
        const mockSelect = vi.fn().mockReturnThis();
        const mockEq = vi.fn().mockReturnThis();
        const mockMaybeSingle = vi.fn().mockResolvedValue({
            data: {
                id: 'emp-1',
                user_id: 'test-user-id',
                status: 'suspended', // THIS IS THE KEY
                approval_status: 'approved',
                role_employees: { role_name: 'admin' }
            },
            error: null
        });

        (supabase.from as any).mockReturnValue({
            select: mockSelect,
            eq: mockEq,
            maybeSingle: mockMaybeSingle
        });

        renderComponent();

        // Fill form
        fireEvent.change(screen.getByPlaceholderText('name@company.com'), { target: { value: 'suspended@buzzly.com' } });
        fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'password123' } });

        // Submit
        fireEvent.click(screen.getByRole('button', { name: /Sign In to Buzzly/i }));

        // Verify
        await waitFor(() => {
            expect(auditAuth.loginFailed).toHaveBeenCalledWith('suspended@buzzly.com', 'Employee account suspended');
            expect(supabase.auth.signOut).toHaveBeenCalled();
            expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
                title: "Account suspended"
            }));
            expect(mockNavigate).not.toHaveBeenCalledWith('/admin/dashboard');
        });
    });

    it('should sign out and show error toast when employee is pending', async () => {
        // 1. Mock sign in success
        (supabase.auth.signInWithPassword as any).mockResolvedValue({
            data: { user: { id: 'test-user-id', email: 'pending@buzzly.com' } },
            error: null
        });

        // 2. Mock exactly one pending employee
        const mockSelect = vi.fn().mockReturnThis();
        const mockEq = vi.fn().mockReturnThis();
        const mockMaybeSingle = vi.fn().mockResolvedValue({
            data: {
                id: 'emp-2',
                user_id: 'test-user-id',
                status: 'active',
                approval_status: 'pending', // THIS IS THE KEY
                role_employees: { role_name: 'admin' }
            },
            error: null
        });

        (supabase.from as any).mockReturnValue({
            select: mockSelect,
            eq: mockEq,
            maybeSingle: mockMaybeSingle
        });

        renderComponent();

        // Fill form
        fireEvent.change(screen.getByPlaceholderText('name@company.com'), { target: { value: 'pending@buzzly.com' } });
        fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'password123' } });

        // Submit
        fireEvent.click(screen.getByRole('button', { name: /Sign In to Buzzly/i }));

        // Verify
        await waitFor(() => {
            expect(auditAuth.loginFailed).toHaveBeenCalledWith('pending@buzzly.com', 'Employee account pending');
            expect(supabase.auth.signOut).toHaveBeenCalled();
            expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
                title: "Cannot sign in"
            }));
            expect(mockNavigate).not.toHaveBeenCalledWith('/admin/dashboard');
        });
    });
});
