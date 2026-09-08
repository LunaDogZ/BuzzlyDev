import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';

/**
 * Audit Event Categories
 */
export type AuditCategory =
    | "authentication"
    | "security"
    | "settings"
    | "data"
    | "campaign"
    | "integration"
    | "discount"
    | "reward"
    | "redemption"
    | "activity_code"
    | "tier"
    | "feature";

/**
 * Audit Event Status
 */
export type AuditStatus = "success" | "failed";

/**
 * Parameters for logging an audit event
 */
export interface AuditEventParams {
    userId?: string | null;
    actionTypeId?: string;
    actionName: string;
    category: AuditCategory;
    description: string;
    status?: AuditStatus;
    metadata?: Record<string, unknown>;
}

/**
 * Log an audit event to the database
 * 
 * @param params - Audit event parameters
 * @returns Promise<void>
 * 
 * @example
 * ```typescript
 * await logAuditEvent({
 *   userId: user.id,
 *   actionName: 'Login',
 *   category: 'authentication',
 *   description: 'User logged in successfully',
 *   status: 'success',
 *   metadata: { device: 'Chrome on Windows' }
 * });
 * ```
 */
export async function logAuditEvent(params: AuditEventParams): Promise<void> {
    try {
        const {
            userId,
            actionTypeId,
            actionName,
            category,
            description,
            status = 'success',
            metadata = {},
        } = params;

        // Get current user if userId not provided
        let finalUserId = userId;
        if (!finalUserId) {
            const { data: { user } } = await getCurrentUser();
            finalUserId = user?.id || null;
        }

        // Insert audit log
        const { error } = await supabase
            .from('audit_logs_enhanced')
            .insert({
                user_id: finalUserId,
                action_type_id: actionTypeId || null,
                category,
                description,
                status,
                // Deliberately not collected. This used to call api.ipify.org on every
                // audit event, so every login and every page view stored an address.
                // Proposal §2.5 commits this system to "the systematic anonymization of
                // Personally Identifiable Information (PII) prior to database insertion";
                // writing a raw public address straight into a table is the opposite of
                // that, and nothing disclosed it either — the app ships no privacy notice,
                // and the SUS consent script read aloud to participants
                // (evidence/kpi6-sus/protocol.md:83) lists what is collected and this was
                // not on the list. The value was worthless anyway — an IP the browser
                // reads about itself is trivially forged, which is why the old code
                // carried a comment saying it should be done server-side, and nothing in
                // this app reads the column.
                //
                // Keeping an IP in an audit log is a normal thing to do; collecting one
                // undisclosed is not. So if a real need appears, take it from the request
                // on the server — where it cannot be faked — and say so somewhere the
                // person can read before it is written.
                ip_address: null,
                metadata: {
                    ...metadata,
                    action_name: actionName,
                    timestamp: new Date().toISOString(),
                    user_agent: navigator?.userAgent || 'unknown',
                },
            });

        if (error) {
            console.error('[Audit Log Error]', error);
            // Don't throw - logging should never break the main application
        }
    } catch (error) {
        console.error('[Audit Log Exception]', error);
        // Silently fail - logging is non-critical
    }
}

/**
 * Log page/feature view — for Product Usage analytics (ทุกฟีเจอร์ที่ผู้ใช้กด/เข้าถึงได้)
 * Call on route change for Customer pages.
 */
export async function logPageView(pathname: string): Promise<void> {
    if (!pathname || pathname === "/") return;
    await logAuditEvent({
        actionName: "Page View",
        category: "feature",
        description: `Viewed ${pathname}`,
        status: "success",
        metadata: { page_url: pathname },
    });
}

/**
 * Log authentication events (login, logout, failed login)
 */
export const auditAuth = {
    login: (userId: string, role: string, email: string) =>
        logAuditEvent({
            userId,
            actionName: 'Login',
            category: 'authentication',
            description: `${role} user ${email} logged in`,
            status: 'success',
            metadata: { role, email },
        }),

    logout: (userId: string, role: string, email: string) =>
        logAuditEvent({
            userId,
            actionName: 'Logout',
            category: 'authentication',
            description: `${role} user ${email} logged out`,
            status: 'success',
            metadata: { role, email },
        }),

    loginFailed: (email: string, reason: string) =>
        logAuditEvent({
            userId: null,
            actionName: 'Login Failed',
            category: 'authentication',
            description: `Failed login attempt for ${email}: ${reason}`,
            status: 'failed',
            metadata: { email, reason },
        }),
};

/**
 * Log security/admin actions
 */
export const auditSecurity = {
    employeeApproved: (adminId: string, employeeId: string, employeeEmail: string) =>
        logAuditEvent({
            userId: adminId,
            actionName: 'Employee Approved',
            category: 'security',
            description: `Approved employee: ${employeeEmail}`,
            status: 'success',
            metadata: { employeeId, employeeEmail },
        }),

    employeeRegistered: async (
        userId: string,
        employeeEmail: string,
        employeeName: string
    ) => {
        await logAuditEvent({
            userId,
            category: 'security',
            actionName: 'Employee_Registered',
            description: `New employee registration: ${employeeName} (${employeeEmail}) - Pending approval`,
            status: 'success',
            metadata: {
                email: employeeEmail,
                name: employeeName,
                role: 'Employee',
            },
        });
    },

    employeeRejected: (adminId: string, employeeId: string, employeeEmail: string, reason?: string) =>
        logAuditEvent({
            userId: adminId,
            actionName: 'Employee Rejected',
            category: 'security',
            description: `Rejected employee: ${employeeEmail}`,
            status: 'success',
            metadata: { employeeId, employeeEmail, reason },
        }),

    roleChanged: (adminId: string, targetUserId: string, oldRole: string, newRole: string) =>
        logAuditEvent({
            userId: adminId,
            actionName: 'Role Changed',
            category: 'security',
            description: `Changed user role from ${oldRole} to ${newRole}`,
            status: 'success',
            metadata: { targetUserId, oldRole, newRole },
        }),

    userSuspended: (adminId: string, targetUserId: string, targetEmail: string, reason?: string) =>
        logAuditEvent({
            userId: adminId,
            actionName: 'User Suspended',
            category: 'security',
            description: `Suspended user: ${targetEmail}`,
            status: 'success',
            metadata: { targetUserId, targetEmail, reason },
        }),

    userActivated: (adminId: string, targetUserId: string, targetEmail: string) =>
        logAuditEvent({
            userId: adminId,
            actionName: 'User Activated',
            category: 'security',
            description: `Activated user: ${targetEmail}`,
            status: 'success',
            metadata: { targetUserId, targetEmail },
        }),
};

/**
 * Log settings changes
 */
export const auditSettings = {
    settingsChanged: (userId: string, settingName: string, oldValue: unknown, newValue: unknown) =>
        logAuditEvent({
            userId,
            actionName: 'Settings Changed',
            category: 'settings',
            description: `Changed ${settingName}`,
            status: 'success',
            metadata: { settingName, oldValue, newValue },
        }),

    apiKeyCreated: (userId: string, keyName: string) =>
        logAuditEvent({
            userId,
            actionName: 'API Key Created',
            category: 'settings',
            description: `Created API key: ${keyName}`,
            status: 'success',
            metadata: { keyName },
        }),

    apiKeyRevoked: (userId: string, keyName: string) =>
        logAuditEvent({
            userId,
            actionName: 'API Key Revoked',
            category: 'settings',
            description: `Revoked API key: ${keyName}`,
            status: 'success',
            metadata: { keyName },
        }),
};

/**
 * Log data export/import actions
 */
export const auditData = {
    dataExported: (userId: string, dataType: string, recordCount: number) =>
        logAuditEvent({
            userId,
            actionName: 'Data Exported',
            category: 'data',
            description: `Exported ${recordCount} ${dataType} records`,
            status: 'success',
            metadata: { dataType, recordCount },
        }),

    dataImported: (userId: string, dataType: string, recordCount: number) =>
        logAuditEvent({
            userId,
            actionName: 'Data Imported',
            category: 'data',
            description: `Imported ${recordCount} ${dataType} records`,
            status: 'success',
            metadata: { dataType, recordCount },
        }),
};

/**
 * Log discount actions (Support + Customer)
 */
export const auditDiscount = {
    supportCreated: (userId: string, code: string, discountId?: string) =>
        logAuditEvent({
            userId,
            actionName: "Discount Created",
            category: "discount",
            description: `Support สร้าง Discount code: ${code}`,
            status: "success",
            metadata: { code, discount_id: discountId },
        }),

    supportUpdated: (userId: string, discountId: string, code?: string) =>
        logAuditEvent({
            userId,
            actionName: "Discount Updated",
            category: "discount",
            description: `Support แก้ไข Discount`,
            status: "success",
            metadata: { discount_id: discountId, code },
        }),

    supportDeleted: (userId: string, discountId: string, code?: string) =>
        logAuditEvent({
            userId,
            actionName: "Discount Deleted",
            category: "discount",
            description: `Support ลบ Discount`,
            status: "success",
            metadata: { discount_id: discountId, code },
        }),

    supportPublished: (userId: string, discountId: string, code?: string) =>
        logAuditEvent({
            userId,
            actionName: "Discount Published",
            category: "discount",
            description: `Support เผยแพร่ Discount: ${code || discountId}`,
            status: "success",
            metadata: { discount_id: discountId, code },
        }),

    supportToggled: (userId: string, discountId: string, isActive: boolean, code?: string) =>
        logAuditEvent({
            userId,
            actionName: isActive ? "Discount Activated" : "Discount Deactivated",
            category: "discount",
            description: `Support ${isActive ? "เปิด" : "ปิด"} Discount: ${code || discountId}`,
            status: "success",
            metadata: { discount_id: discountId, code, is_active: isActive },
        }),

    customerCollected: (userId: string, discountId: string, code?: string) =>
        logAuditEvent({
            userId,
            actionName: "Customer Collected Discount",
            category: "discount",
            description: `Customer เก็บ Discount: ${code || discountId}`,
            status: "success",
            metadata: { discount_id: discountId, code },
        }),

    customerUsed: (userId: string, code: string, discountId?: string) =>
        logAuditEvent({
            userId,
            actionName: "Customer Used Discount",
            category: "discount",
            description: `Customer ใช้ Discount: ${code}`,
            status: "success",
            metadata: { code, discount_id: discountId },
        }),
};

/**
 * Log reward/redemption actions
 */
export const auditReward = {
    supportCreated: (userId: string, name: string, rewardId?: string) =>
        logAuditEvent({
            userId,
            actionName: "Reward Item Created",
            category: "reward",
            description: `Support สร้างของรางวัล: ${name}`,
            status: "success",
            metadata: { reward_id: rewardId, name },
        }),

    supportUpdated: (userId: string, rewardId: string, name?: string) =>
        logAuditEvent({
            userId,
            actionName: "Reward Item Updated",
            category: "reward",
            description: `Support แก้ไขของรางวัล`,
            status: "success",
            metadata: { reward_id: rewardId, name },
        }),

    supportDeleted: (userId: string, rewardId: string, name?: string) =>
        logAuditEvent({
            userId,
            actionName: "Reward Item Deleted",
            category: "reward",
            description: `Support ลบของรางวัล`,
            status: "success",
            metadata: { reward_id: rewardId, name },
        }),

    supportToggled: (userId: string, rewardId: string, isActive: boolean, name?: string) =>
        logAuditEvent({
            userId,
            actionName: isActive ? "Reward Enabled" : "Reward Disabled",
            category: "reward",
            description: `Support ${isActive ? "เปิด" : "ปิด"} ของรางวัล: ${name || rewardId}`,
            status: "success",
            metadata: { reward_id: rewardId, name, is_active: isActive },
        }),

    customerRedeemed: (userId: string, rewardId: string, rewardName?: string) =>
        logAuditEvent({
            userId,
            actionName: "Customer Redeemed Reward",
            category: "reward",
            description: `Customer แลกของรางวัล: ${rewardName || rewardId}`,
            status: "success",
            metadata: { reward_id: rewardId, name: rewardName },
        }),

    supportFulfilled: (userId: string, redemptionId: string, customerEmail?: string) =>
        logAuditEvent({
            userId,
            actionName: "Redemption Fulfilled",
            category: "redemption",
            description: `Support ยืนยันการแลกของรางวัล`,
            status: "success",
            metadata: { redemption_id: redemptionId, customer_email: customerEmail },
        }),

    supportRejected: (userId: string, redemptionId: string, customerEmail?: string) =>
        logAuditEvent({
            userId,
            actionName: "Redemption Rejected",
            category: "redemption",
            description: `Support ปฏิเสธการแลกของรางวัล`,
            status: "success",
            metadata: { redemption_id: redemptionId, customer_email: customerEmail },
        }),
};

/**
 * Log activity code actions (Support)
 */
export const auditActivityCode = {
    created: (userId: string, name: string, actionCode?: string) =>
        logAuditEvent({
            userId,
            actionName: "Activity Code Created",
            category: "activity_code",
            description: `Support สร้าง Activity code: ${name}`,
            status: "success",
            metadata: { name, action_code: actionCode },
        }),

    updated: (userId: string, activityCodeId: string, name?: string) =>
        logAuditEvent({
            userId,
            actionName: "Activity Code Updated",
            category: "activity_code",
            description: `Support แก้ไข Activity code`,
            status: "success",
            metadata: { activity_code_id: activityCodeId, name },
        }),

    toggled: (userId: string, activityCodeId: string, isActive: boolean, name?: string) =>
        logAuditEvent({
            userId,
            actionName: isActive ? "Activity Code Enabled" : "Activity Code Disabled",
            category: "activity_code",
            description: `Support ${isActive ? "เปิด" : "ปิด"} Activity code: ${name || activityCodeId}`,
            status: "success",
            metadata: { activity_code_id: activityCodeId, name, is_active: isActive },
        }),

    deleted: (userId: string, activityCodeId: string, name?: string) =>
        logAuditEvent({
            userId,
            actionName: "Activity Code Deleted",
            category: "activity_code",
            description: `Support ลบ Activity code`,
            status: "success",
            metadata: { activity_code_id: activityCodeId, name },
        }),
};

/**
 * Log tier management actions (Support)
 */
export const auditTier = {
    activityResolved: (userId: string, activityId: string) =>
        logAuditEvent({
            userId,
            actionName: "Suspicious Activity Resolved",
            category: "tier",
            description: `Support แก้ไข suspicious activity`,
            status: "success",
            metadata: { activity_id: activityId },
        }),

    customerSuspended: (userId: string, targetUserId: string, targetEmail?: string) =>
        logAuditEvent({
            userId,
            actionName: "Customer Suspended",
            category: "tier",
            description: `Support แก้ไข Customer: ${targetEmail || targetUserId}`,
            status: "success",
            metadata: { target_user_id: targetUserId, target_email: targetEmail },
        }),
};

/**
 * Log campaign actions
 */
export const auditCampaign = {
    campaignCreated: (userId: string, campaignId: string, campaignName: string) =>
        logAuditEvent({
            userId,
            actionName: 'Campaign Created',
            category: 'campaign',
            description: `Created campaign: ${campaignName}`,
            status: 'success',
            metadata: { campaignId, campaignName },
        }),

    campaignDeleted: (userId: string, campaignId: string, campaignName: string) =>
        logAuditEvent({
            userId,
            actionName: 'Campaign Deleted',
            category: 'campaign',
            description: `Deleted campaign: ${campaignName}`,
            status: 'success',
            metadata: { campaignId, campaignName },
        }),
};
