# Buzzly — Feature-Database Mapping

เอกสารนี้รวบรวมการ mapping ระหว่าง Features, Actors, Routes, Pages, Hooks, Tables, RPCs และ Storage ของระบบ Buzzly

---

## ส่วนที่ 0: สรุป Actor และสิทธิ์

| Actor | Auth | Roles | Routes Prefix |
|-------|------|-------|---------------|
| **Customer** | Supabase Auth (profile_customers) | TeamRole: owner/admin/editor/viewer | /dashboard, /personas, /campaigns, /social/*, /customer-journey, /aarrr-funnel, /api-keys, /analytics, /reports, /settings, /team |
| **Support** | employees (role: support) | support, owner | /support/* |
| **Dev** | employees (role: dev) | dev, owner | /dev/* |
| **Owner** | employees (role: owner) | owner only | /owner/* |

**หมายเหตุ:** Owner เข้าถึงได้ทั้ง Dev + Support + Owner routes

---

## ส่วนที่ 1: CUSTOMER

**Auth:** `profile_customers`, `customer` | **Guard:** `CustomerProtectedRoute` + `TeamPermissionsGuard`

**Sub-roles (workspace_members.role):** owner, admin, editor, viewer — ใช้ `defaultRolePermissions` จาก `src/hooks/useTeamManagement.tsx`

| Permission | owner | admin | editor | viewer |
|------------|-------|-------|--------|--------|
| view_dashboard | ✓ | ✓ | ✓ | ✓ |
| view_campaigns | ✓ | ✓ | ✓ | ✓ |
| edit_campaigns | ✓ | ✓ | ✓ | ✗ |
| delete_campaigns | ✓ | ✓ | ✗ | ✗ |
| view_prospects | ✓ | ✓ | ✓ | ✓ |
| edit_prospects | ✓ | ✓ | ✓ | ✗ |
| delete_prospects | ✓ | ✓ | ✗ | ✗ |
| view_analytics | ✓ | ✓ | ✓ | ✓ |
| export_data | ✓ | ✓ | ✗ | ✗ |
| manage_team | ✓ | ✓ | ✗ | ✗ |
| manage_settings | ✓ | ✗ | ✗ | ✗ |

### 1.1 Customer — Dashboard

| Field | Value |
|-------|-------|
| **Route** | `/dashboard` |
| **Permission** | view_dashboard |
| **Page** | `src/pages/Dashboard.tsx` |
| **Hooks** | useDashboardMetrics, usePlatformConnections |
| **Tables** | ad_accounts, ad_insights, workspaces, workspace_members, platforms, workspace_api_keys |
| **RPCs** | — |

### 1.2 Customer — Personas / Prospects

| Field | Value |
|-------|-------|
| **Route** | `/personas` |
| **Permission** | view_prospects |
| **Page** | `src/pages/Prospects.tsx` |
| **Hooks** | usePersonas, usePersonaInsights, useWorkspaceAdPersona, useCustomerPersonas, usePostPersonaLinks, useLinkableItems, useAudienceDiscovery, useTags |
| **Tables** | persona_definition, ad_personas, ad_insights, workspace_ad_persona, customer_personas, genders, locations, post_personas, social_posts, ads, tags, campaign_tags |
| **RPCs** | — |
| **Storage** | avatars (EditHeroPersonaDialog) |

### 1.3 Customer — Campaigns

| Field | Value |
|-------|-------|
| **Route** | `/campaigns`, `/campaigns/:id` |
| **Permission** | view_campaigns |
| **PlanGate** | campaigns |
| **Pages** | `src/pages/Campaigns.tsx`, `src/pages/CampaignDetail.tsx` |
| **Hooks** | useCampaigns, useCampaignAdsAndPosts, useAdGroups, useAds, useAdInsights, useAdPersonas, useAdPosts, useBudgets, useTags |
| **Tables** | campaigns, campaign_ads, ad_insights, campaign_tags, ads, ad_groups, social_posts, ad_personas, workspaces, workspace_members, budgets |
| **RPCs** | award_loyalty_points, create_ad_with_mirror_post |
| **Direct** | Campaigns.tsx → ad_accounts |

### 1.4 Customer — Social

| Field | Value |
|-------|-------|
| **Route** | `/social/*` (planner, analytics, inbox, integrations) |
| **Permission** | view_dashboard |
| **Pages** | SocialPlanner, SocialAnalyticsView, SocialInbox, SocialIntegrations |
| **Hooks** | useSocialPosts, useSocialInbox, useSocialComments, useSocialCalendar, useUnifiedCalendar, useSocialAnalyticsSummary, usePlatformConnections, usePlatformsDB |
| **Tables** | social_posts, social_comments, ad_groups, post_personas, customer_personas, workspaces, workspace_members, platforms, workspace_api_keys, ad_accounts |
| **RPCs** | seed_demo_insights, award_loyalty_points |

### 1.5 Customer — Customer Journey / AARRR

| Field | Value |
|-------|-------|
| **Route** | `/customer-journey`, `/aarrr-funnel` |
| **Permission** | view_analytics |
| **Pages** | `src/pages/CustomerJourney.tsx`, `src/pages/AARRRFunnel.tsx` |
| **Hooks** | useFunnelData, useCustomerJourneyData, useCustomerJourneyMonthlyData, useAARRRMonthlyData |
| **Tables** | aarrr_categories, funnel_stages, ad_insights |
| **RPCs** | get_customer_journey_funnel_totals, get_customer_journey_monthly_data |

### 1.6 Customer — API Keys

| Field | Value |
|-------|-------|
| **Route** | `/api-keys` |
| **Permission** | manage_settings |
| **Page** | `src/pages/APIKeys.tsx` |
| **Hooks** | usePlatformConnections, usePlatformsDB |
| **Tables** | workspaces, workspace_members, platforms, workspace_api_keys, ad_accounts |
| **RPCs** | seed_demo_insights |

### 1.7 Customer — Analytics

| Field | Value |
|-------|-------|
| **Route** | `/analytics` |
| **Permission** | view_analytics |
| **Page** | `src/pages/Analytics.tsx` |
| **Hooks** | useAnalyticsData |
| **Tables** | cohort_analysis, customer_activities, conversion_events, event_types |
| **RPCs** | — |

### 1.8 Customer — Reports

| Field | Value |
|-------|-------|
| **Route** | `/reports` |
| **Permission** | view_analytics |
| **Page** | `src/pages/Reports.tsx` |
| **Hooks** | useReports, useScheduledReports |
| **Tables** | workspaces, workspace_members, reports, scheduled_reports |
| **RPCs** | — |
| **Storage** | reports (`src/lib/reportPdf.ts`) |

### 1.9 Customer — Settings

| Field | Value |
|-------|-------|
| **Route** | `/settings` |
| **Permission** | manage_settings |
| **Page** | `src/pages/Settings.tsx`, SettingsGeneralTab |
| **Tables** | profile_customers, customer |
| **Storage** | avatars |
| **Direct** | Settings.tsx, SettingsGeneralTab → profile_customers, customer, storage |

### 1.10 Customer — Team Management

| Field | Value |
|-------|-------|
| **Route** | `/team` |
| **Permission** | manage_team |
| **Page** | `src/pages/TeamManagement.tsx` |
| **Hooks** | useTeamManagement, useWorkspaceMembers, useTeamPermissions |
| **Tables** | workspaces, workspace_members, customer, team_invitations, team_activity_logs |
| **RPCs** | — |

### 1.11 Customer — Loyalty (ฝั่งลูกค้า)

| Field | Value |
|-------|-------|
| **Hooks** | useLoyaltyTier, useLoyaltyMissions, useAwardMission, useCustomerRewards, useCustomerCoupons, useUserRedeemedCoupons |
| **Tables** | loyalty_tiers, loyalty_points, loyalty_activity_codes, loyalty_mission_completions, points_transactions, profile_customers, payment_transactions, reward_items, customer_coupons, customer_notifications, discounts, user_redeemed_coupons |
| **RPCs** | get_my_loyalty_tier, award_loyalty_points, redeem_reward, get_available_discounts |
| **Components** | PlanSelectionDialog, UpgradeRequiredDialog → award_loyalty_points |

### 1.12 Customer — Subscription / Billing

| Field | Value |
|-------|-------|
| **Hooks** | useSubscription, useUserPaymentMethods, useInvoices |
| **Tables** | subscription_plans, payment_methods, subscriptions, currencies, payment_transactions, invoices, customer |
| **RPCs** | apply_collected_discount |
| **Components** | PaymentMethodDialog → validate_collected_discount |

### 1.13 Customer — Sign Up (Public)

| Field | Value |
|-------|-------|
| **Page** | `src/pages/SignUp.tsx` |
| **Tables** | customer, profile_customers |
| **RPCs** | ensure_loyalty_wallet |

---

## ส่วนที่ 2: SUPPORT

**Auth:** employees (role: support หรือ owner) | **Guard:** `EmployeeProtectedRoute` allowedRoles=["support","owner"] | **Layout:** SupportLayout

| Route | Page | Hooks | Tables | RPCs |
|-------|------|-------|--------|------|
| /support/workspaces | DevWorkspaces | useDevWorkspaces | workspaces, workspace_members, ad_accounts | — |
| /support/tier-management | TierManagement | useTierManagement, useCustomerTiers | loyalty_tier_history, tier_history, loyalty_tiers, loyalty_points, points_transactions, suspicious_activities, profile_customers, customer | admin_override_tier, get_tier_history_for_support, search_customers_for_support, update_tier_retention_period, evaluate_inactivity_tier_downgrades, sync_tier_from_lifetime_points |
| /support/rewards-management | RewardsManagement | useRewardsManagement | reward_items | — |
| /support/redemption-requests | RedemptionRequests | useRedemptionRequests | reward_redemptions | — |
| /support/discount-management | DiscountManagement | useDiscounts | discounts | — |
| /support/activity-codes | ActivityCodes | useActivityCodes | loyalty_activity_codes | — |

**Shared:** SupportLayout, SupportSidebar → employees, auditLogger (logPageView, auditAuth.logout), useNotifications (notifications)

---

## ส่วนที่ 3: DEV

**Auth:** employees (role: dev หรือ owner) | **Guard:** `EmployeeProtectedRoute` allowedRoles=["dev","owner"] | **Layout:** DevLayout

| Route | Page | Hooks | Tables | RPCs |
|-------|------|-------|--------|------|
| /dev/monitor | MonitorDashboard | useDevMonitor | server, data_pipeline, external_api_status, employees, error_logs | — |
| /dev/audit-logs | AuditLogs | useAuditLogs | audit_logs_enhanced, employees, customer | — |
| /dev/employees | EmployeeManagement | useEmployees | employees, role_employees, employees_profile | — |
| /dev/support | DevSupport | useDevSupport | employees, customer, error_logs | — |

**Shared:** DevLayout, DevSidebar → employees, user_roles, auditLogger, useNotifications

---

## ส่วนที่ 4: OWNER

**Auth:** employees (role: owner เท่านั้น) | **Guard:** `EmployeeProtectedRoute` allowedRoles=["owner"] | **Layout:** OwnerLayout

| Route | Page | Hooks | Tables | RPCs |
|-------|------|-------|--------|------|
| /owner/dashboard | OwnerDashboard | useOwnerMetrics | subscriptions, payment_transactions, cohort_analysis, feedback, customer, workspace_members, workspaces, audit_logs_enhanced, persona_metrics_daily, profile_customers | — |
| /owner/product-usage | ProductUsage | useOwnerMetrics | (same as dashboard) | — |
| /owner/business-performance | BusinessPerformance | useOwnerMetrics | (same as dashboard) | — |
| /owner/user-feedback | UserFeedback | useOwnerMetrics | (same as dashboard) | — |
| /owner/executive-report | ExecutiveReport | useReports, useOwnerMetrics | reports, (same as dashboard) | — |
| /owner/customer-tiers | CustomerTiers | useCustomerTiers | loyalty_tiers, profile_customers, payment_transactions, tier_history | — |

**Storage:** ExecutiveReport → reports bucket (upload PDF)

---

## ส่วนที่ 5: PUBLIC / SHARED

| Page | Tables | RPCs | หมายเหตุ |
|------|--------|------|----------|
| Landing | employees, user_roles | — | ตรวจสอบว่ามี employee หรือไม่ |
| Auth | employees | — | Customer vs Employee login |
| EmployeeLogin | employees, user_roles | — | — |
| EmployeeSignUp | customer, employees | — | — |

---

## ส่วนที่ 6: Services (Cross-Actor)

| Service | Tables | ไฟล์ | เรียกจาก |
|---------|--------|------|----------|
| logError | error_logs | `src/services/errorLogger.ts` | App.tsx, ErrorBoundary, mutations |
| logAuditEvent | audit_logs_enhanced | `src/lib/auditLogger.ts` | Support/Dev actions, auth |
| logPageView | audit_logs_enhanced | `src/lib/auditLogger.ts` | SupportLayout |

---

## ส่วนที่ 7: Contexts ที่ใช้ DB

| Context | Tables | ไฟล์ |
|---------|--------|------|
| PlanContext | subscriptions, subscription_plans | `src/contexts/PlanContext.tsx` |
| PlatformConnectionsProvider | (usePlatformConnections) | — |
| LoyaltyProvider | (useLoyaltyTier) | — |

---

## ส่วนที่ 8: ภาคผนวก

### 8.1 RPC ที่มีใน DB แต่ไม่เรียกจาก Client

| RPC | หมายเหตุ |
|-----|----------|
| increment_discount_usage | อาจเรียกจาก redeem_reward หรือ RPC อื่นภายใน DB |
| get_notification_preferences | มีใน migration |
| send_promo_to_customer | มีใน migration |

### 8.2 Trigger / Internal Functions

| Function | วัตถุประสงค์ |
|----------|--------------|
| handle_new_user | สร้าง profile, loyalty wallet เมื่อ sign up |
| handle_user_sign_in | อัปเดต last_sign_in |
| handle_new_customer_discounts | สร้าง customer_coupons เมื่อมี discount ใหม่ |
| handle_discount_publish | — |
| log_auto_tier_change | บันทึก tier_history เมื่อ tier เปลี่ยนอัตโนมัติ |
| log_loyalty_tier_change | — |
| log_bulletproof_tier_change | — |
| auto_evaluate_loyalty_tier | อัปเกรด tier ตาม points |
| handle_auto_tier_update | — |
| detect_suspicious_points_activity | Fraud detection |
| fn_notify_budget_alert | แจ้งเตือนเมื่อ budget ถึง threshold |
| fn_notify_on_critical_error | แจ้งเตือน critical error |
| fn_notify_on_login_failure | แจ้งเตือน login ล้มเหลว |
| fn_notify_on_reward_redemption | แจ้งเตือนเมื่อมีการ redeem reward |
| fn_notify_on_suspicious_activity | แจ้งเตือน suspicious activity |
| process_scheduled_reports_with_preferences | ประมวลผล scheduled reports |
| create_weekly_digest_notifications | สร้าง weekly digest |
| assign_admin_role_on_approval | กำหนด role เมื่อ employee ถูก approve |
| auto_link_employee_on_insert | — |
| can_manage_team | RLS helper |
| has_permission | RLS helper |
| is_employee | RLS helper |
| has_employee_role | RLS helper |
| validate_persona_workspace | RLS helper |
| compute_server_status | อัปเดต server status |
| auto_stop_completed_campaigns | หยุด campaign ที่เสร็จแล้ว |

### 8.3 Hooks ที่ Compose (ไม่มี Direct DB)

| Hook | คำอธิบาย |
|------|----------|
| useInboxArchived | localStorage only |
| useSidebarState | localStorage only |
| useOnboardingGuard | compose จาก usePlatformConnections, useWorkspace |
| usePlanAccess | ใช้ PlanContext (subscriptions) |
| useSocialAnalyticsSummary | compose จาก useAdInsights, useSocialPosts, usePlatformConnections |
| useCustomerJourneyData | compose จาก useFunnelData |
| useUserRole | ใช้ employees ผ่าน useEmployeeAuth |

### 8.4 Storage Buckets สรุป

| Bucket | ไฟล์ที่ใช้ | การใช้งาน |
|--------|------------|-----------|
| avatars | Settings.tsx, SettingsGeneralTab.tsx, EditHeroPersonaDialog.tsx | อัปโหลด/ลบ avatar, list files |
| reports | reportPdf.ts, ExecutiveReport.tsx | อัปโหลด PDF reports, getPublicUrl |
