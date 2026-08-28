-- Scope five policies that ignored the tenant boundary the product is built on.
--
-- Found on 2026-08-28 by signing in as a real customer and reading other
-- workspaces' rows over PostgREST, then resolving each row's owner through
-- `service_role` — i.e. independently of the policies being measured. The probe
-- is `scripts/tenant-isolation-probe.mjs`; its before/after JSON is in
-- `evidence/rls-tenant-isolation/`.
--
-- The workspace design itself is sound. Every table on the ads path
-- (ad_insights, ads, ad_groups, campaigns, ad_accounts, campaign_ads) is scoped
-- through `is_team_member(auth.uid(), team_id)` or through
-- `ad_accounts.team_id -> workspace_members`, and the customer measured 0 rows
-- on all six while service_role saw 82/20/4/4/1/1. Nothing below touches them.
--
-- What went wrong is narrower and always the same shape: a legacy
-- `USING (true)` policy left sitting *next to* the correctly scoped one.
-- Postgres ORs permissive policies together, so the loose one decides the
-- outcome and the scoped one never gets a say. Each table below already has a
-- correct policy; the fix is to remove the override, not to add anything.
--
-- Measured before the change (customer `e2e@buzzly.test`, team b022da17…):
--   social_posts        89 of 89 rows visible, 76 owned by 4 other workspaces
--   customer_activities 5,070 of 5,070 visible, none belonging to the caller
--   feedback            100 of 100 visible, from 30 different users
--
-- Severity note, stated honestly: the UI does not display any of this today,
-- because every social hook already sends `.eq("team_id", workspaceId)`. The
-- exposure is at the API. The anon key ships inside the Vercel bundle, so any
-- logged-in customer can query PostgREST directly and read all of it, which is
-- why this lands before the deploy rather than after.

-- ── 1. social_posts ─────────────────────────────────────────────────────────
-- Remaining SELECT policies: "Team members can view social posts"
-- (is_team_member) and "Owners can view social posts" (workspaces.owner_id),
-- plus "Admins can manage social_posts" for employees. `social_posts.team_id`
-- is already indexed (idx_social_posts_team_id), so the surviving policy is an
-- index lookup rather than the seq scan the permissive one allowed.
DROP POLICY IF EXISTS "Authenticated users can view social_posts" ON public.social_posts;

-- ── 2. customer_activities ──────────────────────────────────────────────────
-- Remaining SELECT: `owner_select` (via profile_customers) for the customer who
-- owns the activity, and `admin_owner_select` / "Admins can manage
-- customer_activities" for employees. The only reader in src/ is the embed at
-- useOwnerMetrics.tsx:1671 behind /owner/user-feedback, which runs as an
-- employee and is covered by the admin path — verified against a throwaway
-- `owner` employee before this migration was written, not assumed.
-- `idx_customer_activities_profile_customer_id` already backs the owner path.
DROP POLICY IF EXISTS "Authenticated users can view customer_activities" ON public.customer_activities;

-- ── 3. feedback ─────────────────────────────────────────────────────────────
-- Remaining SELECT: `owner_all` and "Users can view their own feedback"
-- (user_id = auth.uid()), and "Admins can view all feedback" /
-- `admin_owner_select` for the owner dashboard.
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.feedback;

-- feedback.user_id is the column the surviving customer-side policy filters on
-- and it had no index. 100 rows makes this unmeasurable today; it is here
-- because the policy now depends on it.
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON public.feedback USING btree (user_id);

-- ── 4. audit_logs_enhanced: stop one user writing history as another ────────
-- `WITH CHECK (true)` let any authenticated caller insert an audit row carrying
-- somebody else's `user_id`. Confirmed live: a customer wrote a row attributed
-- to another workspace's owner (201, row present, removed again by the probe).
--
-- This is only reachable with `Prefer: return=minimal`, which is exactly what a
-- plain `supabase.from().insert()` sends. A first attempt using
-- `return=representation` was refused 403 and looked like a pass — that reading
-- was wrong: representation adds a RETURNING clause that needs a SELECT policy
-- the customer does not have, so the refusal came from the read, never from the
-- write. Noted because the same trap will re-appear in any future write probe.
--
-- NULL stays allowed: `auditAuth.loginFailed` deliberately logs with
-- `userId: null` (there is no session yet), and an unattributed row impersonates
-- nobody. What is refused is naming a *different* real user.
ALTER POLICY "Anyone can insert audit logs" ON public.audit_logs_enhanced
  WITH CHECK (user_id IS NULL OR user_id = (SELECT auth.uid()));

-- Same hole via the other door: this policy has no `TO` clause, so it reaches
-- `anon`, and category was its only condition.
ALTER POLICY "Enable insert for authentication events" ON public.audit_logs_enhanced
  WITH CHECK (
    (category)::text = 'authentication'::text
    AND (user_id IS NULL OR user_id = (SELECT auth.uid()))
  );

-- ── 5. error_logs: same, but reachable without logging in at all ────────────
-- `WITH CHECK (true)` with no `TO` clause. Confirmed live: an anonymous caller
-- holding only the publishable anon key inserted an error row attributed to a
-- real user id. Anonymous logging still has to work — errorLogger runs on the
-- login page, where `getCurrentUserId()` returns null — so NULL is allowed and
-- only impersonation is refused.
ALTER POLICY "Anyone can insert error logs" ON public.error_logs
  WITH CHECK (user_id IS NULL OR user_id = (SELECT auth.uid()));

-- Not changed, on purpose: the 38 `USING (true)` policies on reference tables
-- (countries, provinces, platforms, subscription_plans, loyalty_tiers, …).
-- Those carry no ownership column; every tenant is meant to read them.
