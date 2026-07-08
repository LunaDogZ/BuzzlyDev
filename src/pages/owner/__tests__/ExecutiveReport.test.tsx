import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { forwardRef } from 'react';
import ExecutiveReport from '../ExecutiveReport';

// Mock Toast
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({
        toast: mockToast,
    }),
}));

// Mock data hooks (all React Query based) so no QueryClientProvider is needed
const mockCreateReport = { mutateAsync: vi.fn().mockResolvedValue({}) };
const mockCreateScheduledReport = { mutateAsync: vi.fn().mockResolvedValue({}) };

vi.mock('@/hooks/useReports', () => ({
    useReports: () => ({
        reports: [
            {
                id: 'r1',
                name: 'Q4 2024 Executive Summary',
                report_type: 'executive',
                status: 'completed',
                created_at: '2026-01-01T00:00:00Z',
                file_url: 'https://example.com/report.pdf',
            },
        ],
        isLoading: false,
        deleteReport: { mutate: vi.fn() },
        createReport: mockCreateReport,
    }),
}));

vi.mock('@/hooks/useScheduledReports', () => ({
    useScheduledReports: () => ({
        scheduledReports: [],
        isLoading: false,
        toggleActive: { mutate: vi.fn() },
        deleteScheduledReport: { mutate: vi.fn() },
        createScheduledReport: mockCreateScheduledReport,
    }),
}));

vi.mock('@/hooks/useOwnerMetrics', () => ({
    useSubscriptionMetrics: () => ({ data: undefined }),
    useFeedbackMetrics: () => ({ data: undefined }),
    useProductUsageMetrics: () => ({ data: undefined }),
    useAARRRMetrics: () => ({ data: undefined }),
}));

vi.mock('@/hooks/useCustomerTiers', () => ({
    useCustomerTiers: () => ({ data: undefined }),
}));

vi.mock('@/hooks/useDiscounts', () => ({
    useDiscounts: () => ({ discounts: [] }),
}));

// The hidden print document just needs to exist so reportRef.current is set
vi.mock('@/components/owner/ExecutiveReportDocument', () => ({
    ExecutiveReportDocument: forwardRef<HTMLDivElement>((_props, ref) => (
        <div ref={ref} data-testid="report-document" />
    )),
}));

// PDF generation machinery is not under test
vi.mock('html2canvas', () => ({
    default: vi.fn().mockResolvedValue({
        toDataURL: () => 'data:image/jpeg;base64,',
        height: 100,
        width: 100,
    }),
}));
vi.mock('jspdf', () => ({
    jsPDF: vi.fn().mockImplementation(() => ({
        internal: { pageSize: { getWidth: () => 210 } },
        addImage: vi.fn(),
        output: () => new Blob(),
    })),
}));

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

describe('ExecutiveReport Page', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders correctly', () => {
        render(<ExecutiveReport />);
        expect(screen.getByText('Executive Report')).toBeInTheDocument();
        expect(screen.getByTestId('tab-trigger-generate')).toBeInTheDocument();
    });

    it('allows selecting metrics', () => {
        render(<ExecutiveReport />);

        // "business" is selected by default; toggling unchecks it
        const businessCheckbox = screen.getByLabelText(/Business Performance/i);
        expect(businessCheckbox).toBeChecked();

        fireEvent.click(businessCheckbox);
        expect(businessCheckbox).not.toBeChecked();
    });

    it('generates report triggers toast', async () => {
        render(<ExecutiveReport />);

        const tabContent = screen.getByTestId('tab-content-generate');
        const generateBtn = Array.from(tabContent.querySelectorAll('button'))
            .find((b) => b.textContent?.includes('Generate Report'));
        expect(generateBtn).toBeTruthy();

        fireEvent.click(generateBtn!);

        await waitFor(() => {
            expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
                title: 'Generating Report',
            }));
        });
    });

    it('schedules report via the modal', async () => {
        render(<ExecutiveReport />);

        // Open the schedule modal
        fireEvent.click(screen.getByText('Schedule Report', { selector: 'button' }));

        await waitFor(() => {
            expect(screen.getByText('Schedule Report Delivery')).toBeInTheDocument();
        });

        // Provide recipients (name defaults to "Executive Summary")
        const recipientsInput = screen.getByPlaceholderText(/CEO@buzzly.com/i);
        fireEvent.change(recipientsInput, { target: { value: 'boss@buzzly.com' } });

        fireEvent.click(screen.getByText('Save Schedule', { selector: 'button' }));

        await waitFor(() => {
            expect(mockCreateScheduledReport.mutateAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'Executive Summary',
                    recipients: ['boss@buzzly.com'],
                })
            );
        });
    });

    it('displays history tab content', () => {
        render(<ExecutiveReport />);

        // With mocked tabs, content is always rendered
        expect(screen.getByText('Recent Reports')).toBeInTheDocument();
        expect(screen.getByText('Q4 2024 Executive Summary')).toBeInTheDocument();
    });
});
