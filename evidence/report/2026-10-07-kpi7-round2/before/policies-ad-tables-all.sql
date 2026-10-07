-- Extracted verbatim from `supabase db dump --linked` (schema public), file written 2026-10-07 13:43:32 +0700,
-- sha256 1105e5fff0ca7c78cda7647c9a7fc6cb83081b3c068feae452c5dd54ecfbe6c4.

-- All 21 policies on ad_insights / ad_accounts before 20261007101000.

CREATE POLICY "Admins can view all ad accounts" ON "public"."ad_accounts" FOR SELECT TO "authenticated" USING (("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role") OR "public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'owner'::"public"."app_role")));

CREATE POLICY "Employees can view all ad accounts" ON "public"."ad_accounts" FOR SELECT USING (("public"."has_employee_role"(( SELECT "auth"."uid"() AS "uid"), 'support'::character varying) OR "public"."has_employee_role"(( SELECT "auth"."uid"() AS "uid"), 'owner'::character varying) OR "public"."has_employee_role"(( SELECT "auth"."uid"() AS "uid"), 'dev'::character varying)));

CREATE POLICY "RLS_AdAccounts_V3" ON "public"."ad_accounts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."workspace_members"
  WHERE (("workspace_members"."team_id" = "ad_accounts"."team_id") AND ("workspace_members"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("workspace_members"."status" = 'active'::"public"."member_status")))));

CREATE POLICY "Support employees can update ad accounts" ON "public"."ad_accounts" FOR UPDATE USING (("public"."has_employee_role"(( SELECT "auth"."uid"() AS "uid"), 'support'::character varying) OR "public"."has_employee_role"(( SELECT "auth"."uid"() AS "uid"), 'owner'::character varying) OR "public"."has_employee_role"(( SELECT "auth"."uid"() AS "uid"), 'dev'::character varying)));

CREATE POLICY "Team admins can delete ad_accounts" ON "public"."ad_accounts" FOR DELETE TO "authenticated" USING ("public"."can_manage_team"(( SELECT "auth"."uid"() AS "uid"), "team_id"));

CREATE POLICY "Team members can insert ad accounts" ON "public"."ad_accounts" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."workspace_members"
  WHERE (("workspace_members"."team_id" = "ad_accounts"."team_id") AND ("workspace_members"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (EXISTS ( SELECT 1
   FROM "public"."workspaces"
  WHERE (("workspaces"."id" = "ad_accounts"."team_id") AND ("workspaces"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));

CREATE POLICY "Team members can insert ad_accounts" ON "public"."ad_accounts" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_team_member"(( SELECT "auth"."uid"() AS "uid"), "team_id"));

CREATE POLICY "Team members can update ad_accounts" ON "public"."ad_accounts" FOR UPDATE TO "authenticated" USING ("public"."is_team_member"(( SELECT "auth"."uid"() AS "uid"), "team_id"));

CREATE POLICY "Team members can view ad accounts" ON "public"."ad_accounts" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."workspace_members"
  WHERE (("workspace_members"."team_id" = "ad_accounts"."team_id") AND ("workspace_members"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (EXISTS ( SELECT 1
   FROM "public"."workspaces"
  WHERE (("workspaces"."id" = "ad_accounts"."team_id") AND ("workspaces"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));

CREATE POLICY "team_admin_delete" ON "public"."ad_accounts" FOR DELETE TO "authenticated" USING ("public"."can_manage_team"(( SELECT "auth"."uid"() AS "uid"), "team_id"));

CREATE POLICY "team_member_insert" ON "public"."ad_accounts" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_team_member"(( SELECT "auth"."uid"() AS "uid"), "team_id"));

CREATE POLICY "team_member_select" ON "public"."ad_accounts" FOR SELECT TO "authenticated" USING ("public"."is_team_member"(( SELECT "auth"."uid"() AS "uid"), "team_id"));

CREATE POLICY "team_member_update" ON "public"."ad_accounts" FOR UPDATE TO "authenticated" USING ("public"."is_team_member"(( SELECT "auth"."uid"() AS "uid"), "team_id")) WITH CHECK ("public"."is_team_member"(( SELECT "auth"."uid"() AS "uid"), "team_id"));

CREATE POLICY "Admins can manage ad_insights" ON "public"."ad_insights" TO "authenticated" USING (("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role") OR "public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'owner'::"public"."app_role")));

CREATE POLICY "RLS_Insights_V3" ON "public"."ad_insights" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."ad_accounts" "aa"
     JOIN "public"."workspace_members" "tm" ON (("aa"."team_id" = "tm"."team_id")))
  WHERE (("aa"."id" = "ad_insights"."ad_account_id") AND ("tm"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("tm"."status" = 'active'::"public"."member_status")))));

CREATE POLICY "Team members can insert ad insights" ON "public"."ad_insights" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM ("public"."ad_accounts" "aa"
     JOIN "public"."workspace_members" "wm" ON (("wm"."team_id" = "aa"."team_id")))
  WHERE (("aa"."id" = "ad_insights"."ad_account_id") AND ("wm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (EXISTS ( SELECT 1
   FROM ("public"."ad_accounts" "aa"
     JOIN "public"."workspaces" "w" ON (("w"."id" = "aa"."team_id")))
  WHERE (("aa"."id" = "ad_insights"."ad_account_id") AND ("w"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));

CREATE POLICY "Team members can view ad insights" ON "public"."ad_insights" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM ("public"."ad_accounts" "aa"
     JOIN "public"."workspace_members" "wm" ON (("wm"."team_id" = "aa"."team_id")))
  WHERE (("aa"."id" = "ad_insights"."ad_account_id") AND ("wm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (EXISTS ( SELECT 1
   FROM ("public"."ad_accounts" "aa"
     JOIN "public"."workspaces" "w" ON (("w"."id" = "aa"."team_id")))
  WHERE (("aa"."id" = "ad_insights"."ad_account_id") AND ("w"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));

CREATE POLICY "team_admin_delete" ON "public"."ad_insights" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."ad_accounts" "aa"
  WHERE (("aa"."id" = "ad_insights"."ad_account_id") AND "public"."can_manage_team"(( SELECT "auth"."uid"() AS "uid"), "aa"."team_id")))));

CREATE POLICY "team_member_insert" ON "public"."ad_insights" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."ad_accounts" "aa"
  WHERE (("aa"."id" = "ad_insights"."ad_account_id") AND "public"."is_team_member"(( SELECT "auth"."uid"() AS "uid"), "aa"."team_id")))));

CREATE POLICY "team_member_select" ON "public"."ad_insights" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."ad_accounts" "aa"
  WHERE (("aa"."id" = "ad_insights"."ad_account_id") AND "public"."is_team_member"(( SELECT "auth"."uid"() AS "uid"), "aa"."team_id")))));

CREATE POLICY "team_member_update" ON "public"."ad_insights" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."ad_accounts" "aa"
  WHERE (("aa"."id" = "ad_insights"."ad_account_id") AND "public"."is_team_member"(( SELECT "auth"."uid"() AS "uid"), "aa"."team_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."ad_accounts" "aa"
  WHERE (("aa"."id" = "ad_insights"."ad_account_id") AND "public"."is_team_member"(( SELECT "auth"."uid"() AS "uid"), "aa"."team_id")))));
