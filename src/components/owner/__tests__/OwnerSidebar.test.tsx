import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OwnerSidebar } from '../OwnerSidebar';
import { BrowserRouter } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
    supabase: {
        auth: {
            // The real client also exposes getSession, which getCurrentUser now asks first.
            // Answering "nothing stored" sends it down the getUser path these tests stub.
            getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
            getUser: vi.fn(),
            signOut: vi.fn(),
        },
    },
}));

// Mock useToast
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({
        toast: mockToast,
    }),
}));

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

// Mock Global Window Location
Object.defineProperty(window, 'location', {
    writable: true,
    value: { href: '' },
    configurable: true // Allow redefinition if needed
});

// Mock the Custom NavLink component to avoid Router context issues entirely if possible, 
// or ensure it receives correct props.
// The error usually comes from `NavLink` trying to access router context. 
// We are wrapping in BrowserRouter so it should be fine.
// But the error stack trace point to `NavLinkWithRef`...
// Let's try to mock the internal `NavLink` used in `OwnerSidebar.tsx`.
// `OwnerSidebar.tsx` imports `NavLink` from `@/components/NavLink`.

vi.mock('@/components/NavLink', () => ({
    NavLink: ({ children, to, className, ...props }: any) => {
        return (
            <a href={to} data-testid={`nav-link-${to}`} onClick={(e) => { e.preventDefault(); }}>
                {typeof children === 'function' ? children({ isActive: false }) : children}
            </a>
        );
    }
}));

describe('OwnerSidebar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default mock for getUser interactions
        vi.mocked(supabase.auth.getUser).mockResolvedValue({
            data: {
                user: { email: 'owner@buzzly.com' }
            },
            error: null
        } as any);
    });

    it('renders navigation items correctly', async () => {
        render(
            <BrowserRouter>
                <OwnerSidebar collapsed={false} onToggle={() => {}} />
            </BrowserRouter>
        );

        expect(screen.getByText('Buzzly')).toBeInTheDocument();
        expect(screen.getByText('Owner Portal')).toBeInTheDocument();

        // Navigation items
        expect(screen.getByText('Business Performance')).toBeInTheDocument();
        expect(screen.getByText('Product Usage')).toBeInTheDocument();
        expect(screen.getByText('Customer Tiers')).toBeInTheDocument();
        expect(screen.getByText('User Feedback')).toBeInTheDocument();
        expect(screen.getByText('Executive Report')).toBeInTheDocument();
    });

    it('fetches and displays user email', async () => {
        render(
            <BrowserRouter>
                <OwnerSidebar collapsed={false} onToggle={() => {}} />
            </BrowserRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('owner@buzzly.com')).toBeInTheDocument();
        });
    });

    it('logout button signs out and redirects', async () => {
        vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null } as any);

        render(
            <BrowserRouter>
                <OwnerSidebar collapsed={false} onToggle={() => {}} />
            </BrowserRouter>
        );

        const logoutBtn = screen.getByText('SIGN OUT');
        fireEvent.click(logoutBtn);

        await waitFor(() => {
            expect(supabase.auth.signOut).toHaveBeenCalled();
            expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
                title: "Signed Out"
            }));
            expect(window.location.href).toBe('/');
        });
    });
});
