import { supabase } from '@/integrations/supabase/client';
import { getCurrentUser } from '@/lib/currentUser';

// Environment configuration
const isErrorLoggingEnabled = import.meta.env.VITE_ENABLE_ERROR_LOGGING !== 'false';
const isDevelopment = import.meta.env.DEV;

// Error logging levels
export type LogLevel = 'error' | 'warning' | 'info' | 'debug';

interface LogOptions {
    level: LogLevel;
    message: string;
    error?: Error | unknown;
    metadata?: Record<string, unknown>;
    userId?: string;
    requestId?: string;
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

/**
 * Get current user ID from Supabase session
 */
async function getCurrentUserId(): Promise<string | null> {
    try {
        const { data: { user } } = await getCurrentUser();
        return user?.id || null;
    } catch {
        return null;
    }
}

/**
 * Extract error details from Error object or unknown value
 */
function extractErrorDetails(error: Error | unknown): {
    message: string;
    stackTrace: string | null;
} {
    if (error instanceof Error) {
        return {
            message: error.message,
            stackTrace: error.stack || null,
        };
    }

    if (typeof error === 'string') {
        return {
            message: error,
            stackTrace: null,
        };
    }

    if (error && typeof error === 'object') {
        return {
            message: JSON.stringify(error),
            stackTrace: null,
        };
    }

    return {
        message: 'Unknown error',
        stackTrace: null,
    };
}

/**
 * Main error logging function
 */
export async function logToDatabase(options: LogOptions): Promise<void> {
    // Skip logging if disabled
    if (!isErrorLoggingEnabled) {
        if (isDevelopment) {
            console.log('[Error Logger] Logging disabled via environment variable');
        }
        return;
    }

    try {
        const { level, message, error, metadata, userId, requestId } = options;

        // Extract error details if error object is provided
        const errorDetails = error ? extractErrorDetails(error) : { message, stackTrace: null };

        // Combine message if different to preserve context
        const finalMessage = (message && message !== errorDetails.message)
            ? `${message}: ${errorDetails.message}`
            : errorDetails.message;

        // Get user ID if not provided
        const finalUserId = userId || await getCurrentUserId();

        // Generate request ID if not provided
        const finalRequestId = requestId || generateRequestId();

        // Prepare metadata with additional context
        const enrichedMetadata = {
            ...metadata,
            timestamp: new Date().toISOString(),
            userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'unknown',
            url: typeof window !== 'undefined' ? window.location.href : 'unknown',
            isDevelopment,
        };

        // Insert log to database
        const { error: insertError } = await supabase
            .from('error_logs')
            .insert({
                level,
                message: finalMessage,
                stack_trace: errorDetails.stackTrace,
                user_id: finalUserId,
                request_id: finalRequestId,
                metadata: enrichedMetadata,
            });

        if (insertError) {
            console.error('[Error Logger] ❌ Failed to insert log:', insertError);
            console.error('[Error Logger] Error details:', {
                code: insertError.code,
                message: insertError.message,
                details: insertError.details,
                hint: insertError.hint,
            });
            throw insertError;
        } else {
            // Always log success to help with debugging
            console.log(`[Error Logger] ✅ Successfully logged ${level.toUpperCase()}: ${errorDetails.message}`);
        }
    } catch (loggingError) {
        // Log locally and throw so caller can catch
        console.error('[Error Logger] Logging failed:', loggingError);
        throw loggingError;
    }
}

/**
 * Log an error
 */
export async function logError(
    message: string,
    error?: Error | unknown,
    metadata?: Record<string, unknown>
): Promise<void> {
    return logToDatabase({
        level: 'error',
        message,
        error,
        metadata,
    });
}

/**
 * Log a warning
 */
export async function logWarning(
    message: string,
    metadata?: Record<string, unknown>
): Promise<void> {
    return logToDatabase({
        level: 'warning',
        message,
        metadata,
    });
}

/**
 * Log an info message
 */
export async function logInfo(
    message: string,
    metadata?: Record<string, unknown>
): Promise<void> {
    return logToDatabase({
        level: 'info',
        message,
        metadata,
    });
}

/**
 * Log a debug message (only in development)
 */
export async function logDebug(
    message: string,
    metadata?: Record<string, unknown>
): Promise<void> {
    if (isDevelopment) {
        return logToDatabase({
            level: 'debug',
            message,
            metadata,
        });
    }
}
