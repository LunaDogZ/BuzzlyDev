-- Index the foreign-key columns that carry real traffic.
--
-- Postgres does not index foreign keys automatically.  An unindexed FK column
-- costs on two paths: JOINs from the parent, and ON DELETE CASCADE / SET NULL,
-- which has to seq-scan (and lock) the child table for every parent row removed.
--
-- Measured against the live cloud catalog on 2026-08-11 (pg_constraint joined to
-- pg_index, "is there an index whose LEADING columns match the constraint's"):
--
--     124 foreign keys · 44 indexed · 80 unindexed
--
-- That is a bigger number than the 94/76/67 the static pass over the migration
-- text produced — the text pass under-reported, it did not over-report.
--
-- Selection rule, so the 54 that are skipped are a decision and not an
-- oversight.  An unindexed FK is indexed here when it is any of:
--   (a) on a table with real rows today (row counts pulled from the cloud the
--       same day: customer_activities 5,070 · audit_logs_enhanced 911 ·
--       ad_insights 881 · points_transactions 138 · loyalty_tier_history 106 ·
--       feedback 100 · social_comments 85 · ads / campaign_ads / loyalty_points
--       52 each);
--   (b) tenant-scoped `team_id` with ON DELETE CASCADE, where deleting one
--       workspace scans every child table;
--   (c) on the ad / ingestion path, which is what actually grows in this product.
--
-- Deliberately NOT indexed: static reference tables (provinces.country_id,
-- locations.*, time_zones.country_id, platforms.platform_category_id,
-- event_types.*, attribution_types.*, currency/provider lookups) and the
-- still-empty loyalty and billing children.  On a 25 MB database those are
-- theory, not pain, and every index is paid for on write.  Revisit when a table
-- gets rows.
--
-- Plain CREATE INDEX, not CONCURRENTLY: the largest table here is 5,070 rows, so
-- the build is milliseconds, and CONCURRENTLY cannot run inside the transaction
-- the migration runner wraps this in.
--
-- IF NOT EXISTS throughout so re-running is a no-op.

-- ── ad / ingestion path ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ad_insights_campaign_id      ON public.ad_insights (campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_insights_ads_id           ON public.ad_insights (ads_id);
CREATE INDEX IF NOT EXISTS idx_ads_ad_group_id              ON public.ads (ad_group_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_ad_account_id      ON public.campaigns (ad_account_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_team_id            ON public.campaigns (team_id);
CREATE INDEX IF NOT EXISTS idx_campaign_ads_ad_id           ON public.campaign_ads (ad_id);
CREATE INDEX IF NOT EXISTS idx_ad_personas_persona_id       ON public.ad_personas (persona_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_batches_team_id    ON public.ingestion_batches (team_id);

-- ── tables with real rows today ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_customer_activities_campaign_id         ON public.customer_activities (campaign_id);
CREATE INDEX IF NOT EXISTS idx_customer_activities_event_type_id       ON public.customer_activities (event_type_id);
CREATE INDEX IF NOT EXISTS idx_customer_activities_profile_customer_id ON public.customer_activities (profile_customer_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_enhanced_action_type_id      ON public.audit_logs_enhanced (action_type_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_enhanced_server_id           ON public.audit_logs_enhanced (server_id);
CREATE INDEX IF NOT EXISTS idx_points_transactions_user_id             ON public.points_transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_tier_history_profile_customer_id ON public.loyalty_tier_history (profile_customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_points_loyalty_tier_id          ON public.loyalty_points (loyalty_tier_id);
CREATE INDEX IF NOT EXISTS idx_feedback_customer_activities_id         ON public.feedback (customer_activities_id);
CREATE INDEX IF NOT EXISTS idx_feedback_rating_id                      ON public.feedback (rating_id);
CREATE INDEX IF NOT EXISTS idx_social_comments_platform_id             ON public.social_comments (platform_id);
CREATE INDEX IF NOT EXISTS idx_tier_history_user_id                    ON public.tier_history (user_id);
CREATE INDEX IF NOT EXISTS idx_suspicious_activities_user_id           ON public.suspicious_activities (user_id);

-- ── tenant-scoped CASCADE children (a workspace delete scans each of these) ──
CREATE INDEX IF NOT EXISTS idx_budgets_team_id             ON public.budgets (team_id);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_team_id     ON public.email_campaigns (team_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_reports_team_id   ON public.scheduled_reports (team_id);
CREATE INDEX IF NOT EXISTS idx_team_activity_logs_team_id  ON public.team_activity_logs (team_id);
CREATE INDEX IF NOT EXISTS idx_team_invitations_team_id    ON public.team_invitations (team_id);
