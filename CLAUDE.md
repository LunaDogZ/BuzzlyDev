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

**Data safety & measurement integrity (non-negotiable):**
8. **NEVER truncate or mass-delete cloud Supabase tables.** The cloud project
   (`aokzvknggtccgwbavszj`) holds live data that research KPIs are measured
   against. Any test reset must be **scoped to a dedicated test workspace**
   (`WHERE team_id = :test_team` / `ad_account_id = :test_ad_account`) and must
   count its blast radius before deleting — an unexpected count aborts rather
   than proceeds.
9. **Never silently patch pipeline logic to make a test pass.** A failing test
   is a result. Stop and report which failures are real bugs and which are bad
   fixtures; let the human decide. A known bug pinned as an documented XFAIL is
   worth more than a quiet fix, because it gives before/after evidence.
10. **`Decimal` for all money and metric values — never `float`.** Money is the
    product. `records.jsonable` serialises `Decimal` to *strings* so exactness
    survives the stage boundary; `records.rehydrate` restores the type on read,
    because the validation rules test `isinstance(value, (int, Decimal))` and a
    JSON round-trip would silently disable them.
11. Test corpora must be **deterministic and frozen** (fixed seed, no clock
    reads, byte-identical on regeneration), and their expectations
    **hand-declared, never derived by running the code under test** — a spec
    computed from the thing it measures only proves self-agreement.
12. **An assertion scoped through a table the tested operation itself writes
    proves nothing.** "No staged rows survived" filtered through
    `ingestion_batches` matches the empty set for every refused file, because a
    batch row is written *by* the promote that refused files never reach — it
    reports a clean result without ever looking at one. Derive the key
    independently and **prove the derivation** against a case that really did
    write (see `assert_batch_derivation`). A check that cannot fail is worse
    than no check: it is a claim.
13. **Execution order is not list order.** A fixture that depends on another's
    state must be *placed* immediately after it and guarded at run time, not
    assumed from where it sits in the corpus listing. Order guards belong on any
    fixture with a `depends_on`; without one, running it alone or shuffled
    passes for the wrong reason.

**Ingestion KPI work:** see [`docs/HANDOFF_INGESTION_KPI.md`](./docs/HANDOFF_INGESTION_KPI.md)
for state, decisions, resolved open items and known limitations (L-4, the
`stage_rows` → `promote_batch` crash window). Results and evidence live in
[`tests/RESULTS.md`](./tests/RESULTS.md) and `tests/evidence/`; re-measure with
`python3 -m pytest tests/test_ingestion_kpi.py -v` (~20 min, sequential by
design — it resets a scoped cloud workspace between fixtures).

   


**Performance KPI work (KPI-4 Lighthouse, KPI-5 load — both FAILING):** see
[`docs/KPI_FAILURE_ANALYSIS.md`](./docs/KPI_FAILURE_ANALYSIS.md) (Thai twin:
`KPI_FAILURE_ANALYSIS.th.md` — **edit both in the same commit**). It carries the
five-step failure narrative, the cause analysis, the six candidate remedies, the
experiment that would decide between them, and §6 "Handoff" with the re-run
commands, the four preconditions that each produce a meaningless clean number,
and the open decisions. Thresholds stay in `docs/KPI_SPEC.md` and **never move**;
a new measurement is a new dated directory reported beside the old one, never a
replacement.

**Writing the thesis (proposal vs. what was built):** see
[`docs/PROPOSAL_VS_IMPLEMENTATION.md`](./docs/PROPOSAL_VS_IMPLEMENTATION.md)
(Thai twin `.th.md` — **edit both in the same commit**). Sixteen dated
deviations, each citing a page/§ of `docs/proposal/Prem_ProposVer.2.pdf` on one side and a
verified file/line on the other, plus which chapter each one forces a rewrite
in. Read it before transcribing any sentence from the proposal into the thesis:
several proposal statements (Pandas, psycopg2, Realtime DLQ alerts, GitHub
Actions CI/CD, "enterprise organizations", "strictly 3NF") are **not what was
built**, and one — the §3.5 Thin-Backend contingency — was invoked as designed.
