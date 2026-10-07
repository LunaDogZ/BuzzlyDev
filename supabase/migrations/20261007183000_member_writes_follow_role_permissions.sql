-- KPI-7 round 3, A01: member-level write access on the 21 tables listed in the
-- round-2 README ("Remaining A01 findings") plus the `imports` storage bucket.
--
-- Before: each table had at least one INSERT/UPDATE/DELETE policy that required
-- only membership (is_team_member, or an EXISTS/IN over workspace_members), so
-- a 'viewer' could write through PostgREST with their own JWT. Permissive
-- policies OR together, so every member-level write policy is DROPPED — a
-- stricter policy added beside one would change nothing.
--
-- Replacements use has_permission(uid, team, key), which already mirrors the
-- frontend's defaultRolePermissions (src/hooks/useTeamManagement.tsx:88) and
-- honours workspace_members.custom_permissions:
--
--   manage_settings  (owner)              workspace_api_keys, import_jobs,
--                                          imports bucket upload, budgets
--   edit_campaigns   (owner admin editor) ads, ad_groups, campaigns, campaign_ads,
--                                          campaign_tags, tags, ad_personas,
--                                          social_posts, social_comments,
--                                          post_personas
--   delete_campaigns (owner admin)        ads, ad_groups, campaigns (DELETE)
--   edit_prospects   (owner admin editor) workspace_ad_persona
--                                          (customer_personas already has
--                                          has_permission policies; only its
--                                          membership-only siblings are dropped)
--   export_data      (owner admin)        reports, scheduled_reports,
--                                          email_campaigns
--
-- No replacement (service_role writes only, bypassing RLS): sync_history
-- (meta-sync, promote_batch), conversion_events (seed script).
-- Own rows only: team_activity_logs — every member legitimately writes one
-- ("invitation_accepted" is logged by the accepting member), so the rule is
-- active membership AND user_id = the caller, instead of no write at all.
--
-- Unchanged: every SELECT policy, every staff policy (has_role(...)), the
-- has_role(..., 'admin'::app_role) branch inside the ads / ad_groups policies
-- (carried over verbatim), DELETE policies that already require
-- can_manage_team (reports, social_posts, import_jobs, imports bucket),
-- "Owners can insert social posts", and the helper functions.
--
-- campaign_tags: its single FOR ALL policy was also its only read path. It is
-- split: a SELECT policy with the identical USING expression (read from
-- pg_policies), plus write policies on edit_campaigns.

-- workspace_api_keys -------------------------------------------------------------
DROP POLICY "Team members can insert API keys" ON public.workspace_api_keys;
DROP POLICY "Team members can update API keys" ON public.workspace_api_keys;
DROP POLICY "Team members can delete API keys" ON public.workspace_api_keys;

CREATE POLICY "team_manage_settings_insert" ON public.workspace_api_keys
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'manage_settings'));
CREATE POLICY "team_manage_settings_update" ON public.workspace_api_keys
  FOR UPDATE TO authenticated
  USING      (public.has_permission((SELECT auth.uid()), team_id, 'manage_settings'))
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'manage_settings'));
CREATE POLICY "team_manage_settings_delete" ON public.workspace_api_keys
  FOR DELETE TO authenticated
  USING (public.has_permission((SELECT auth.uid()), team_id, 'manage_settings'));

-- import_jobs + imports bucket ---------------------------------------------------
-- The AFTER INSERT trigger starts the pipeline, which writes ad tables with
-- service_role; gating the insert closes that indirect route around the
-- round-2 ad_insights fix. /imports is guarded by manage_settings (App.tsx:185).
DROP POLICY "import_jobs_insert" ON public.import_jobs;
CREATE POLICY "import_jobs_insert" ON public.import_jobs
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'manage_settings')
              AND uploaded_by = (SELECT auth.uid()));

DROP POLICY "imports_insert_policy" ON storage.objects;
CREATE POLICY "imports_insert_policy" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'imports'
              AND public.has_permission((SELECT auth.uid()),
                    public.try_cast_uuid((storage.foldername(name))[1]), 'manage_settings'));

-- ads ----------------------------------------------------------------------------
DROP POLICY "Users can insert ads if team member" ON public.ads;
DROP POLICY "Users can update ads if team member" ON public.ads;
DROP POLICY "Users can delete ads if team member" ON public.ads;

CREATE POLICY "team_edit_campaigns_insert" ON public.ads
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'edit_campaigns')
              OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "team_edit_campaigns_update" ON public.ads
  FOR UPDATE TO authenticated
  USING      (public.has_permission((SELECT auth.uid()), team_id, 'edit_campaigns')
              OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'edit_campaigns')
              OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "team_delete_campaigns_delete" ON public.ads
  FOR DELETE TO authenticated
  USING (public.has_permission((SELECT auth.uid()), team_id, 'delete_campaigns')
         OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

-- ad_groups ----------------------------------------------------------------------
DROP POLICY "Users can insert ad_groups if team member" ON public.ad_groups;
DROP POLICY "Users can update ad_groups if team member" ON public.ad_groups;
DROP POLICY "Users can delete ad_groups if team member" ON public.ad_groups;

CREATE POLICY "team_edit_campaigns_insert" ON public.ad_groups
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'edit_campaigns')
              OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "team_edit_campaigns_update" ON public.ad_groups
  FOR UPDATE TO authenticated
  USING      (public.has_permission((SELECT auth.uid()), team_id, 'edit_campaigns')
              OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'edit_campaigns')
              OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "team_delete_campaigns_delete" ON public.ad_groups
  FOR DELETE TO authenticated
  USING (public.has_permission((SELECT auth.uid()), team_id, 'delete_campaigns')
         OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

-- campaigns ----------------------------------------------------------------------
-- The has_permission siblings (campaigns_*_policy) match through ad_account_id;
-- the replacements match on team_id so a campaign without an ad account keeps
-- the same writers it has today, minus the viewer.
DROP POLICY "team_campaigns_insert" ON public.campaigns;
DROP POLICY "team_campaigns_update" ON public.campaigns;
DROP POLICY "team_campaigns_delete" ON public.campaigns;

CREATE POLICY "team_edit_campaigns_insert" ON public.campaigns
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'edit_campaigns'));
CREATE POLICY "team_edit_campaigns_update" ON public.campaigns
  FOR UPDATE TO authenticated
  USING      (public.has_permission((SELECT auth.uid()), team_id, 'edit_campaigns'))
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'edit_campaigns'));
CREATE POLICY "team_delete_campaigns_delete" ON public.campaigns
  FOR DELETE TO authenticated
  USING (public.has_permission((SELECT auth.uid()), team_id, 'delete_campaigns'));

-- campaign_ads -------------------------------------------------------------------
-- Reads stay with campaign_ads_select, whose USING is a superset of the dropped
-- ALL policy's.
DROP POLICY "campaign_ads_write" ON public.campaign_ads;

CREATE POLICY "team_edit_campaigns_insert" ON public.campaign_ads
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.campaigns c
                      WHERE c.id = campaign_ads.campaign_id
                        AND public.has_permission((SELECT auth.uid()), c.team_id, 'edit_campaigns')));
CREATE POLICY "team_edit_campaigns_update" ON public.campaign_ads
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.campaigns c
                      WHERE c.id = campaign_ads.campaign_id
                        AND public.has_permission((SELECT auth.uid()), c.team_id, 'edit_campaigns')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.campaigns c
                      WHERE c.id = campaign_ads.campaign_id
                        AND public.has_permission((SELECT auth.uid()), c.team_id, 'edit_campaigns')));
CREATE POLICY "team_edit_campaigns_delete" ON public.campaign_ads
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.campaigns c
                 WHERE c.id = campaign_ads.campaign_id
                   AND public.has_permission((SELECT auth.uid()), c.team_id, 'edit_campaigns')));

-- campaign_tags ------------------------------------------------------------------
DROP POLICY "Users can manage campaign tags for their team" ON public.campaign_tags;

-- Identical USING to the dropped ALL policy (pg_policies.qual, 2026-10-07), so
-- reads are unchanged.
CREATE POLICY "Users can view campaign tags for their team" ON public.campaign_tags
  FOR SELECT TO public
  USING (campaign_id IN ( SELECT c.id
   FROM (campaigns c
     JOIN ad_accounts aa ON ((c.ad_account_id = aa.id)))
  WHERE (aa.team_id IN ( SELECT workspaces.id
           FROM workspaces
          WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid))
        UNION
         SELECT workspace_members.team_id
           FROM workspace_members
          WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid))))));

-- Writes follow the same campaign → ad_account → team path as the read.
CREATE POLICY "team_edit_campaigns_insert" ON public.campaign_tags
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.campaigns c
                        JOIN public.ad_accounts aa ON aa.id = c.ad_account_id
                      WHERE c.id = campaign_tags.campaign_id
                        AND public.has_permission((SELECT auth.uid()), aa.team_id, 'edit_campaigns')));
CREATE POLICY "team_edit_campaigns_update" ON public.campaign_tags
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.campaigns c
                        JOIN public.ad_accounts aa ON aa.id = c.ad_account_id
                      WHERE c.id = campaign_tags.campaign_id
                        AND public.has_permission((SELECT auth.uid()), aa.team_id, 'edit_campaigns')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.campaigns c
                        JOIN public.ad_accounts aa ON aa.id = c.ad_account_id
                      WHERE c.id = campaign_tags.campaign_id
                        AND public.has_permission((SELECT auth.uid()), aa.team_id, 'edit_campaigns')));
CREATE POLICY "team_edit_campaigns_delete" ON public.campaign_tags
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.campaigns c
                   JOIN public.ad_accounts aa ON aa.id = c.ad_account_id
                 WHERE c.id = campaign_tags.campaign_id
                   AND public.has_permission((SELECT auth.uid()), aa.team_id, 'edit_campaigns')));

-- tags ---------------------------------------------------------------------------
DROP POLICY "Users can insert their team tags" ON public.tags;
DROP POLICY "Users can update their team tags" ON public.tags;
DROP POLICY "Users can delete their team tags" ON public.tags;

CREATE POLICY "team_edit_campaigns_insert" ON public.tags
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'edit_campaigns'));
CREATE POLICY "team_edit_campaigns_update" ON public.tags
  FOR UPDATE TO authenticated
  USING      (public.has_permission((SELECT auth.uid()), team_id, 'edit_campaigns'))
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'edit_campaigns'));
CREATE POLICY "team_edit_campaigns_delete" ON public.tags
  FOR DELETE TO authenticated
  USING (public.has_permission((SELECT auth.uid()), team_id, 'edit_campaigns'));

-- budgets ------------------------------------------------------------------------
-- Written only from /settings (manage_settings, App.tsx:189).
DROP POLICY "Users can insert their team budgets" ON public.budgets;
DROP POLICY "Users can update their team budgets" ON public.budgets;
DROP POLICY "Users can delete their team budgets" ON public.budgets;

CREATE POLICY "team_manage_settings_insert" ON public.budgets
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'manage_settings'));
CREATE POLICY "team_manage_settings_update" ON public.budgets
  FOR UPDATE TO authenticated
  USING      (public.has_permission((SELECT auth.uid()), team_id, 'manage_settings'))
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'manage_settings'));
CREATE POLICY "team_manage_settings_delete" ON public.budgets
  FOR DELETE TO authenticated
  USING (public.has_permission((SELECT auth.uid()), team_id, 'manage_settings'));

-- customer_personas --------------------------------------------------------------
-- Role-aware siblings already exist and stay: "Team members can create
-- personas" / "Team members can update personas" (edit_prospects), "Team
-- admins can delete personas" (delete_prospects).
DROP POLICY "personas_insert_policy" ON public.customer_personas;
DROP POLICY "personas_update_policy" ON public.customer_personas;
DROP POLICY "personas_delete_policy" ON public.customer_personas;

-- workspace_ad_persona -----------------------------------------------------------
DROP POLICY "Workspace members can insert workspace_ad_persona" ON public.workspace_ad_persona;
DROP POLICY "Workspace members can update workspace_ad_persona" ON public.workspace_ad_persona;

CREATE POLICY "team_edit_prospects_insert" ON public.workspace_ad_persona
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission((SELECT auth.uid()), workspace_id, 'edit_prospects'));
CREATE POLICY "team_edit_prospects_update" ON public.workspace_ad_persona
  FOR UPDATE TO authenticated
  USING      (public.has_permission((SELECT auth.uid()), workspace_id, 'edit_prospects'))
  WITH CHECK (public.has_permission((SELECT auth.uid()), workspace_id, 'edit_prospects'));

-- ad_personas --------------------------------------------------------------------
-- Reads stay with ad_personas_select (identical USING to the dropped ALL).
DROP POLICY "ad_personas_write" ON public.ad_personas;

CREATE POLICY "team_edit_campaigns_insert" ON public.ad_personas
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.ads a
                      WHERE a.id = ad_personas.ad_id
                        AND public.has_permission((SELECT auth.uid()), a.team_id, 'edit_campaigns')));
CREATE POLICY "team_edit_campaigns_update" ON public.ad_personas
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.ads a
                      WHERE a.id = ad_personas.ad_id
                        AND public.has_permission((SELECT auth.uid()), a.team_id, 'edit_campaigns')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ads a
                      WHERE a.id = ad_personas.ad_id
                        AND public.has_permission((SELECT auth.uid()), a.team_id, 'edit_campaigns')));
CREATE POLICY "team_edit_campaigns_delete" ON public.ad_personas
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ads a
                 WHERE a.id = ad_personas.ad_id
                   AND public.has_permission((SELECT auth.uid()), a.team_id, 'edit_campaigns')));

-- post_personas ------------------------------------------------------------------
-- Reads stay with post_personas_select (identical USING to the dropped ALL).
DROP POLICY "post_personas_write" ON public.post_personas;

CREATE POLICY "team_edit_campaigns_insert" ON public.post_personas
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.social_posts p
                      WHERE p.id = post_personas.post_id
                        AND public.has_permission((SELECT auth.uid()), p.team_id, 'edit_campaigns')));
CREATE POLICY "team_edit_campaigns_update" ON public.post_personas
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.social_posts p
                      WHERE p.id = post_personas.post_id
                        AND public.has_permission((SELECT auth.uid()), p.team_id, 'edit_campaigns')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.social_posts p
                      WHERE p.id = post_personas.post_id
                        AND public.has_permission((SELECT auth.uid()), p.team_id, 'edit_campaigns')));
CREATE POLICY "team_edit_campaigns_delete" ON public.post_personas
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.social_posts p
                 WHERE p.id = post_personas.post_id
                   AND public.has_permission((SELECT auth.uid()), p.team_id, 'edit_campaigns')));

-- social_posts -------------------------------------------------------------------
-- create_ad_with_mirror_post (SECURITY INVOKER) writes ads and social_posts in
-- one call, so both tables use edit_campaigns. DELETE keeps "Team admins can
-- delete social posts" (can_manage_team).
DROP POLICY "Team members can create social posts" ON public.social_posts;
DROP POLICY "Team members can update social posts" ON public.social_posts;

CREATE POLICY "team_edit_campaigns_insert" ON public.social_posts
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'edit_campaigns'));
CREATE POLICY "team_edit_campaigns_update" ON public.social_posts
  FOR UPDATE TO authenticated
  USING      (public.has_permission((SELECT auth.uid()), team_id, 'edit_campaigns'))
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'edit_campaigns'));

-- social_comments ----------------------------------------------------------------
DROP POLICY "social_comments_insert" ON public.social_comments;
DROP POLICY "social_comments_update" ON public.social_comments;
DROP POLICY "social_comments_delete" ON public.social_comments;

CREATE POLICY "team_edit_campaigns_insert" ON public.social_comments
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'edit_campaigns'));
CREATE POLICY "team_edit_campaigns_update" ON public.social_comments
  FOR UPDATE TO authenticated
  USING      (public.has_permission((SELECT auth.uid()), team_id, 'edit_campaigns'))
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'edit_campaigns'));
CREATE POLICY "team_edit_campaigns_delete" ON public.social_comments
  FOR DELETE TO authenticated
  USING (public.has_permission((SELECT auth.uid()), team_id, 'edit_campaigns'));

-- reports ------------------------------------------------------------------------
-- DELETE keeps "Team admins can delete reports" (can_manage_team).
DROP POLICY "Team members can create reports" ON public.reports;
DROP POLICY "Team members can update reports" ON public.reports;

CREATE POLICY "team_export_data_insert" ON public.reports
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'export_data'));
CREATE POLICY "team_export_data_update" ON public.reports
  FOR UPDATE TO authenticated
  USING      (public.has_permission((SELECT auth.uid()), team_id, 'export_data'))
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'export_data'));

-- scheduled_reports --------------------------------------------------------------
DROP POLICY "Users can insert their team scheduled reports" ON public.scheduled_reports;
DROP POLICY "Users can update their team scheduled reports" ON public.scheduled_reports;
DROP POLICY "Users can delete their team scheduled reports" ON public.scheduled_reports;

CREATE POLICY "team_export_data_insert" ON public.scheduled_reports
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'export_data'));
CREATE POLICY "team_export_data_update" ON public.scheduled_reports
  FOR UPDATE TO authenticated
  USING      (public.has_permission((SELECT auth.uid()), team_id, 'export_data'))
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'export_data'));
CREATE POLICY "team_export_data_delete" ON public.scheduled_reports
  FOR DELETE TO authenticated
  USING (public.has_permission((SELECT auth.uid()), team_id, 'export_data'));

-- email_campaigns ----------------------------------------------------------------
-- No writer in the code today; follows reports.
DROP POLICY "Users can insert their team email campaigns" ON public.email_campaigns;
DROP POLICY "Users can update their team email campaigns" ON public.email_campaigns;
DROP POLICY "Users can delete their team email campaigns" ON public.email_campaigns;

CREATE POLICY "team_export_data_insert" ON public.email_campaigns
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'export_data'));
CREATE POLICY "team_export_data_update" ON public.email_campaigns
  FOR UPDATE TO authenticated
  USING      (public.has_permission((SELECT auth.uid()), team_id, 'export_data'))
  WITH CHECK (public.has_permission((SELECT auth.uid()), team_id, 'export_data'));
CREATE POLICY "team_export_data_delete" ON public.email_campaigns
  FOR DELETE TO authenticated
  USING (public.has_permission((SELECT auth.uid()), team_id, 'export_data'));

-- sync_history -------------------------------------------------------------------
-- No replacement: written only by meta-sync and promote_batch with service_role.
-- The table has no user column, so an own-rows rule is not possible.
DROP POLICY "sync_history_insert" ON public.sync_history;
DROP POLICY "sync_history_update" ON public.sync_history;
DROP POLICY "sync_history_delete" ON public.sync_history;

-- conversion_events --------------------------------------------------------------
-- No replacement: no client writer. Staff policy "Admins can manage
-- conversion_events" is unchanged.
DROP POLICY "team_member_insert" ON public.conversion_events;

-- team_activity_logs -------------------------------------------------------------
-- Own rows: a member may log only an entry that names themselves as the actor.
DROP POLICY "System can insert activity logs" ON public.team_activity_logs;

CREATE POLICY "team_member_insert_own" ON public.team_activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_team_member((SELECT auth.uid()), team_id)
              AND user_id = (SELECT auth.uid()));
