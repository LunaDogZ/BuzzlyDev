import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSuspiciousActivities } from '../useTierManagement';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { auditTier } from '@/lib/auditLogger';

// What is under test is one rule: PostgREST reports an UPDATE that matched no
// rows as a success (`error` is null), so "suspend this account" can return
// cleanly having suspended nothing. Support staff then read a green toast and
// believe a customer is locked out when they are not.
//
// That is not hypothetical here. Until migration 20260906091500, handle_new_user
// never managed to write a public.customer row at all, so every account that
// signed up in that window is exactly the case where `.eq("id", userId)` matches
// nothing.

vi.mock('@/integrations/supabase/client', () => ({
    supabase: {
        from: vi.fn(),
        // getCurrentUser asks getSession first; "nothing stored" keeps these
        // tests on the getUser path they stub.
        auth: { getUser: vi.fn(), getSession: async () => ({ data: { session: null }, error: null }) },
    },
}));

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/auditLogger', () => ({
    auditTier: { customerSuspended: vi.fn(), activityResolved: vi.fn() },
}));

const USER = '8b49f2bd-a986-493f-8d09-3d783dbe23ef';
const ADMIN = 'cafe0000-0000-0000-0000-00000000beef';

/**
 * Stub for `from("customer")`.
 *
 * The mutation touches the table twice and the two calls are told apart by how
 * they finish: the lookup ends in `.single()`, the update is awaited directly
 * after `.select("id")`. So `single()` answers with the email and `then()`
 * answers with whatever the UPDATE is supposed to have matched.
 */
const customerQuery = (updateRows: unknown[] | null, updateError: unknown = null) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'update']) q[m] = vi.fn(() => q);
    q.single = vi.fn(() => Promise.resolve({ data: { email: 'suspended@buzzly.test' }, error: null }));
    q.then = (f: (v: unknown) => unknown) =>
        Promise.resolve({ data: updateRows, error: updateError }).then(f);
    return q;
};

/** Anything the two background useQuery calls in the hook reach for. */
const idleQuery = () => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'range']) q[m] = vi.fn(() => q);
    q.then = (f: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null, count: 0 }).then(f);
    return q;
};

function mockTables(customer: ReturnType<typeof customerQuery>) {
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) =>
        table === 'customer' ? customer : idleQuery(),
    );
}

const wrapper = ({ children }: { children: ReactNode }) => {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe('useSuspiciousActivities → suspendCustomer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (supabase.auth.getUser as ReturnType<typeof vi.fn>).mockResolvedValue({
            data: { user: { id: ADMIN } },
        });
    });

    it('fails when the UPDATE matched no row, even though PostgREST reported no error', async () => {
        mockTables(customerQuery([]));

        const { result } = renderHook(() => useSuspiciousActivities(), { wrapper });
        result.current.suspendCustomer.mutate(USER);

        await waitFor(() => expect(result.current.suspendCustomer.isError).toBe(true));

        expect(result.current.suspendCustomer.error?.message).toContain(USER);
        expect(toast.error).toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
        // Nothing was suspended, so nothing may be written to the audit trail
        // claiming otherwise.
        expect(auditTier.customerSuspended).not.toHaveBeenCalled();
    });

    it('succeeds when the UPDATE matched the row', async () => {
        mockTables(customerQuery([{ id: USER }]));

        const { result } = renderHook(() => useSuspiciousActivities(), { wrapper });
        result.current.suspendCustomer.mutate(USER);

        await waitFor(() => expect(result.current.suspendCustomer.isSuccess).toBe(true));

        expect(toast.success).toHaveBeenCalledWith('User account suspended');
        expect(toast.error).not.toHaveBeenCalled();
        expect(auditTier.customerSuspended).toHaveBeenCalledWith(
            ADMIN,
            USER,
            'suspended@buzzly.test',
        );
    });

    it('still surfaces a real PostgREST error', async () => {
        mockTables(customerQuery(null, { message: 'permission denied for table customer' }));

        const { result } = renderHook(() => useSuspiciousActivities(), { wrapper });
        result.current.suspendCustomer.mutate(USER);

        await waitFor(() => expect(result.current.suspendCustomer.isError).toBe(true));

        expect(result.current.suspendCustomer.error?.message).toContain('permission denied');
        expect(auditTier.customerSuspended).not.toHaveBeenCalled();
    });
});
