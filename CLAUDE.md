# Buzzly Context

> **Canonical product context:** [`BUZZLY-CONTEXT.md`](./BUZZLY-CONTEXT.md) — what Buzzly IS (wedge = Real-time True Net Profit after Shopee fees), the fixed persona, pricing, and non-negotiables. Founder source of truth; **it wins over this file on any product/business conflict.** Read it before making product/feature/copy decisions.

**Stack:** React 18, Vite 5, TS 5.8, Tailwind 3.4, shadcn, Supabase, TanStack Query v5, Hook Form, Zod, React Router v6.
**Run:** `npm run dev` (port 8080). **NO `bun`**.

**Dirs:** `@/` = `src/`.
- `pages/`: Customer, `dev/`, `support/`, `owner/`, `employee/`, `social/`
- `components/`: `ui/` (shadcn), `layout/`, `admin/`, `campaigns/`, `customer/`, `dashboard/`, `dev/`, `feedback/`, `icons/`, `landing/`, `owner/`, `persona/`, `reports/`, `settings/`, `shared/`, `sidebar/`, `social/`, `subscription/`, `support/`, `team/`
- `hooks/`, `contexts/`, `integrations/supabase/`, `services/`, `lib/`, `utils/`, `constants/`
- `supabase/migrations/` (202+ migrations)

**Routes (`App.tsx`):**
- **Public:** `/`, `/auth`, `/signup`, `/employee/login`, `/employee/signup`
- **Customer (`CustomerProtectedRoute` + `TeamPermissionsGuard`):**
  `/dashboard`, `/personas`, `/campaigns`, `/campaigns/:id`, `/social/*` (planner/analytics/inbox/integrations), `/customer-journey`, `/aarrr-funnel`, `/analytics`, `/reports`, `/api-keys`, `/imports`, `/settings`, `/team`
- **Employee — Dev** (`DevLayout`, roles: `dev`|`owner`): `/dev/monitor`, `/dev/audit-logs`, `/dev/employees`, `/dev/support`
- **Employee — Support** (`SupportLayout`, roles: `support`|`owner`): `/support/workspaces`, `/support/tier-management`, `/support/rewards-management`, `/support/redemption-requests`, `/support/discount-management`, `/support/activity-codes`
- **Employee — Owner** (`OwnerLayout`, role: `owner`): `/owner/dashboard`, `/owner/product-usage`, `/owner/business-performance`, `/owner/user-feedback`, `/owner/executive-report`, `/owner/customer-tiers`
- **Legacy:** `/admin/*` all redirect to `/dev/*` or `/support/*`. `/prospects` redirects to `/personas`.

**Auth:** Customers: Supabase Auth (`profile_customers`). Employees: `employees` table + `useEmployeeAuth` (roles: `dev`, `support`, `owner`).
**Plans:** `PlanContext` (`hasFeature()`). Slugs: `free-*`, `pro-*`, `team-*`. See `constants/plans.ts`.
**Contexts:** `PlanContext` (plan/feature access), `SocialFiltersContext` (social filter state).

**Database (Supabase):** RLS ALWAYS enabled. Client: `import { supabase } from "@/integrations/supabase/client"`.
- *Key tables:* import_jobs, import_row_errors, workspaces, workspace_members, workspace_ad_persona, workspace_api_keys, customer, profile_customers, subscriptions, subscription_plans, payment_methods, payment_transactions, invoices, currencies, campaigns, ad_groups, ads, ad_insights, ad_accounts, campaign_ads, social_posts, social_comments, sync_history, customer_personas, ad_personas, post_personas, persona_metrics_daily, loyalty_tiers, loyalty_points, loyalty_tier_history, tier_history, loyalty_missions, loyalty_mission_completions, loyalty_activity_codes, points_transactions, reward_items, reward_redemptions, discounts, customer_notifications, customer_coupons, user_redeemed_coupons, employees, audit_logs_enhanced, error_logs, notifications, workspace_notifications, notification_preferences, reports, scheduled_reports, revenue_metrics, platforms, feedback, suspicious_activities
- *Migrations:* `supabase/migrations/` (append-only, NEVER edit existing).

**Key RPC Functions:**
- `redeem_reward(p_reward_item_id)` — atomic reward redemption
- `award_loyalty_points(p_action_type)` — award points for activities
- `get_my_loyalty_tier()` — current user tier (SECURITY DEFINER)
- `auto_evaluate_loyalty_tier()` — auto-tier from points
- `admin_override_tier()` / `manual_override_customer_tier()` — support overrides
- `get_customer_journey_funnel_totals()` / `get_customer_journey_monthly_data()` — AARRR analytics
- `search_customers_for_support()` — support customer search
- `ensure_loyalty_wallet()` — guarantee loyalty_points record exists
- `detect_suspicious_points_activity()` — fraud detection

**Hooks (React Query):** Wrap Supabase calls. Throw errors.
- *Loyalty/Rewards:* useLoyaltyTier, useLoyaltyMissions, useAwardMission, useCustomerRewards, useRewardsManagement, useTierManagement, useActivityCodes, useCustomerTiers, useCustomerCoupons, useUserRedeemedCoupons, useDiscounts
- *Campaigns/Ads:* useCampaigns, useCampaignAdsAndPosts, useAdGroups, useAds, useAdInsights, useAdPersonas, useAdPosts, useBudgets
- *Persona/Audience:* useCustomerPersonas, usePersonas, usePersonaInsights, useWorkspaceAdPersona, usePostPersonaLinks, useLinkableItems, useAudienceDiscovery
- *Social:* useSocialPosts, useSocialAnalyticsSummary, useSocialInbox, useSocialComments, useUnifiedCalendar
- *Analytics:* useDashboardMetrics, useCustomerJourneyData, useCustomerJourneyMonthlyData, useAARRRMonthlyData, useFunnelData, useReports, useScheduledReports, useRevenueMetrics, useOwnerMetrics
- *Employee/Admin:* useEmployeeAuth, useEmployees, useAdminMonitor, useDevWorkspaces, useDevSupport, useAuditLogs
- *Workspace/Team:* useWorkspace, useWorkspaceMembers, useWorkspaceInfo, useWorkspaceNotifications, useTeamManagement, useTeamPermissions
- *Settings/Misc:* useSubscription, usePlanAccess, usePlatformConnections, useNotifications, useNotificationPreferences, useUserPaymentMethods, useInvoices, useSyncHistory, useSidebarState, useTags, useOnboardingGuard, useProfileCustomer
- *Imports (file ingestion):* useImportJobs

**Patterns & Rules:**
1. React Query hooks ONLY for DB. No raw `fetch` or local state for server data.
2. Log errors to `error_logs` via `logError` (`@/services/errorLogger`), notify via `toast`. Never swallow errors.
3. Scope queries by `workspaceId` (pass as query key).
4. Loyalty: Use RPC `redeem_reward` for redemptions. Tier upgrades via DB triggers (`auto_evaluate_loyalty_tier`). Support overrides via `manual_override_customer_tier`. Always call `ensure_loyalty_wallet()` before awarding points.
5. Social: Use `@/lib/socialQueryInvalidation` for consistent cache invalidation after mutations.
6. Permissions: Wrap customer pages with `TeamPermissionsGuard`. Check `useTeamPermissions` before rendering sensitive actions.
7. NEVER: Edit `types.ts`, bypass RLS silently, commit `.env`, use `bun`.

   

