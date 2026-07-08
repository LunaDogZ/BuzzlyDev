import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmployeesList } from '@/components/team/EmployeesList';
import * as useEmployeesHook from '@/hooks/useEmployees';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the hook
vi.mock('@/hooks/useEmployees', () => ({
    useEmployees: vi.fn(),
}));

// Mock Sonner
vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

describe('EmployeesList', () => {
    let queryClient: QueryClient;

    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const mockCreate = { mutateAsync: vi.fn(), isPending: false };
    const mockUpdate = { mutateAsync: vi.fn(), isPending: false };
    const mockDelete = { mutateAsync: vi.fn(), isPending: false };
    const mockSuspend = { mutateAsync: vi.fn(), isPending: false };
    const mockReactivate = { mutateAsync: vi.fn(), isPending: false };
    const mockApprove = { mutateAsync: vi.fn(), isPending: false };
    const mockReject = { mutateAsync: vi.fn(), isPending: false };

    const defaultHookReturn = {
        employees: [],
        roles: [{ id: 'r1', role_name: 'Dev' }],
        isLoading: false,
        createEmployee: mockCreate,
        updateEmployee: mockUpdate,
        deleteEmployee: mockDelete,
        suspendEmployee: mockSuspend,
        reactivateEmployee: mockReactivate,
        approveEmployee: mockApprove,
        rejectEmployee: mockReject,
    };

    beforeEach(() => {
        queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
            },
        });
        vi.clearAllMocks();

        // Setup window.confirm mock
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        vi.mocked(useEmployeesHook.useEmployees).mockReturnValue(defaultHookReturn as any);
    });

    it('should render loading state', () => {
        vi.mocked(useEmployeesHook.useEmployees).mockReturnValue({
            ...defaultHookReturn,
            isLoading: true,
        } as any);

        render(<EmployeesList canManage={true} />, { wrapper });
        expect(screen.queryByText('No employees in the system yet.')).not.toBeInTheDocument();
    });

    it('should render empty state', () => {
        render(<EmployeesList canManage={true} />, { wrapper });
        expect(screen.getByText('No employees in the system yet.')).toBeInTheDocument();
    });

    it('should render employee list', () => {
        const mockEmployees = [
            {
                id: '1',
                email: 'test@example.com',
                profile: { first_name: 'John', last_name: 'Doe' },
                role: { role_name: 'Developer' },
                status: 'active',
                approval_status: 'approved',
            },
        ];

        vi.mocked(useEmployeesHook.useEmployees).mockReturnValue({
            ...defaultHookReturn,
            employees: mockEmployees,
        } as any);

        render(<EmployeesList canManage={true} />, { wrapper });

        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('Developer')).toBeInTheDocument();
        // "Active" also appears in the stats card, so allow multiple
        expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Approved').length).toBeGreaterThan(0);
    });

    it('should validate inputs when adding employee', async () => {
        const user = userEvent.setup();
        render(<EmployeesList canManage={true} />, { wrapper });

        await user.click(screen.getByText('Add Employee'));

        // Click save without entering data
        const dialog = screen.getByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: /Add Employee/ }));

        expect(mockCreate.mutateAsync).not.toHaveBeenCalled();
    });

    it('should call createEmployee when passing validation', async () => {
        const user = userEvent.setup();
        render(<EmployeesList canManage={true} />, { wrapper });

        await user.click(screen.getByText('Add Employee'));

        const dialog = screen.getByRole('dialog');
        await user.type(within(dialog).getByLabelText(/First Name/i), 'Jane');
        await user.type(within(dialog).getByLabelText(/Last Name/i), 'Doe');
        await user.type(within(dialog).getByLabelText(/Email/i), 'jane@example.com');

        await user.click(within(dialog).getByRole('button', { name: /Add Employee/ }));

        await waitFor(() => {
            expect(mockCreate.mutateAsync).toHaveBeenCalled();
        });
    });

    it('should call approveEmployee when clicking approve', async () => {
        const mockEmployees = [
            {
                id: '1',
                email: 'test@example.com',
                profile: { first_name: 'New' },
                role: { role_name: 'Dev' },
                status: 'pending',
                approval_status: 'pending',
            },
        ];

        vi.mocked(useEmployeesHook.useEmployees).mockReturnValue({
            ...defaultHookReturn,
            employees: mockEmployees,
        } as any);

        const user = userEvent.setup();
        render(<EmployeesList canManage={true} />, { wrapper });

        const buttons = screen.getAllByRole('button');
        const menuTrigger = buttons[buttons.length - 1];
        await user.click(menuTrigger);

        await user.click(screen.getByText('Approve'));

        await waitFor(() => {
            expect(mockApprove.mutateAsync).toHaveBeenCalledWith('1');
        });
    });

    it('should call suspendEmployee when clicking suspend', async () => {
        const mockEmployees = [
            {
                id: '1',
                email: 'test@example.com',
                profile: { first_name: 'User' },
                role: { role_name: 'Dev' },
                status: 'active',
                approval_status: 'approved',
            },
        ];

        vi.mocked(useEmployeesHook.useEmployees).mockReturnValue({
            ...defaultHookReturn,
            employees: mockEmployees,
        } as any);

        const user = userEvent.setup();
        render(<EmployeesList canManage={true} />, { wrapper });

        const buttons = screen.getAllByRole('button');
        const menuTrigger = buttons[buttons.length - 1];
        await user.click(menuTrigger);

        await user.click(screen.getByText('Suspend'));

        await waitFor(() => {
            expect(mockSuspend.mutateAsync).toHaveBeenCalledWith('1');
        });
    });

    it('should call reactivateEmployee when clicking reactivate', async () => {
        const mockEmployees = [
            {
                id: '1',
                email: 'test@example.com',
                profile: { first_name: 'User' },
                role: { role_name: 'Dev' },
                status: 'suspended',
                approval_status: 'approved',
            },
        ];

        vi.mocked(useEmployeesHook.useEmployees).mockReturnValue({
            ...defaultHookReturn,
            employees: mockEmployees,
        } as any);

        const user = userEvent.setup();
        render(<EmployeesList canManage={true} />, { wrapper });

        const buttons = screen.getAllByRole('button');
        const menuTrigger = buttons[buttons.length - 1];
        await user.click(menuTrigger);

        await user.click(screen.getByText('Reactivate'));

        await waitFor(() => {
            expect(mockReactivate.mutateAsync).toHaveBeenCalledWith('1');
        });
    });

    it('should call deleteEmployee when clicking delete', async () => {
        const mockEmployees = [
            {
                id: '1',
                email: 'test@example.com',
                profile: { first_name: 'User' },
                role: { role_name: 'Dev' },
                status: 'active',
                approval_status: 'approved',
            },
        ];

        vi.mocked(useEmployeesHook.useEmployees).mockReturnValue({
            ...defaultHookReturn,
            employees: mockEmployees,
        } as any);

        const user = userEvent.setup();
        render(<EmployeesList canManage={true} />, { wrapper });

        const buttons = screen.getAllByRole('button');
        const menuTrigger = buttons[buttons.length - 1];
        await user.click(menuTrigger);

        await user.click(screen.getByText('Delete Employee'));

        await waitFor(() => {
            expect(mockDelete.mutateAsync).toHaveBeenCalledWith('1');
        });
    });
});
