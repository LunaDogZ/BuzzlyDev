import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logError, logWarning, logInfo, logToDatabase } from '../errorLogger';
import { supabase } from '@/integrations/supabase/client';

// Mock Supabase client — vi.hoisted so the hoisted vi.mock factory can reference these
const { mockInsert, mockFrom } = vi.hoisted(() => {
    const mockInsert = vi.fn();
    const mockFrom = vi.fn(() => ({
        insert: mockInsert,
    }));
    return { mockInsert, mockFrom };
});

vi.mock('@/integrations/supabase/client', () => ({
    supabase: {
        from: mockFrom,
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user-id' } } }),
            // Nothing stored → getCurrentUser falls through to the getUser stub above.
            getSession: async () => ({ data: { session: null }, error: null }),
        },
    },
}));


describe('errorLogger', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockInsert.mockResolvedValue({ error: null });

        // Ensure environment variables allow logging
        vi.stubEnv('VITE_ENABLE_ERROR_LOGGING', 'true');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('should log error to database with correct level', async () => {
        await logError('Test Error Message');

        expect(supabase.from).toHaveBeenCalledWith('error_logs');
        expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
            level: 'error',
            message: 'Test Error Message',
        }));
    });

    it('should log warning to database', async () => {
        await logWarning('Test Warning');

        expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
            level: 'warning',
            message: 'Test Warning',
        }));
    });

    it('should log info to database', async () => {
        await logInfo('Test Info');

        expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
            level: 'info',
            message: 'Test Info',
        }));
    });

    it('should extract details from Error object', async () => {
        const testError = new Error('Something went wrong');
        testError.stack = 'Error: stack trace...';

        await logError('Wrapper Message', testError);

        expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
            // Logger combines the wrapper message with the extracted error message
            message: 'Wrapper Message: Something went wrong',
            stack_trace: expect.stringContaining('Error: stack trace...'),
        }));
    });

    it('should include metadata', async () => {
        const metadata = { component: 'TestComponent', value: 123 };
        await logInfo('Metadata Test', metadata);

        expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({
                component: 'TestComponent',
                value: 123,
            }),
        }));
    });

    it('should fetch user ID correctly', async () => {
        await logInfo('User ID Test');

        // It fetches user ID internally
        expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
            user_id: 'test-user-id',
        }));
    });

    it('should generate request ID if not provided', async () => {
        await logInfo('Request ID Test');

        expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
            request_id: expect.stringMatching(/^req_/),
        }));
    });

    it('should skip logging if disabled via env', async () => {
        // The env gate is read at module load, so stub the env and re-import fresh
        vi.stubEnv('VITE_ENABLE_ERROR_LOGGING', 'false');
        vi.resetModules();
        const { logError: logErrorDisabled } = await import('../errorLogger');

        await logErrorDisabled('Should not log');

        expect(mockInsert).not.toHaveBeenCalled();
    });
});
