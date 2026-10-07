-- ROLLBACK for 20261007101000_ad_tables_writes_service_or_manager_only.sql
-- (and 20261007120000_drop_seed_demo_insights.sql, if that was applied too).
--
-- NOT a migration. Reconstructed AFTER the push, from the 2026-10-07 13:43 +0700
-- `supabase db dump` (see README.md in this directory). Running it restores the
-- A01 viewer-write hole and the anon-callable seed_demo_insights — use only to
-- undo the fix deliberately. Safe to run in either state: the function is
-- CREATE OR REPLACE'd, the new policies are dropped IF EXISTS.

BEGIN;

DROP POLICY IF EXISTS "team_manager_insert" ON public.ad_accounts;
DROP POLICY IF EXISTS "team_manager_update" ON public.ad_accounts;

-- The 8 policies dropped by 20261007101000, verbatim from the dump.
CREATE POLICY "Team members can insert ad accounts" ON "public"."ad_accounts" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."workspace_members"
  WHERE (("workspace_members"."team_id" = "ad_accounts"."team_id") AND ("workspace_members"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (EXISTS ( SELECT 1
   FROM "public"."workspaces"
  WHERE (("workspaces"."id" = "ad_accounts"."team_id") AND ("workspaces"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));

CREATE POLICY "Team members can insert ad_accounts" ON "public"."ad_accounts" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_team_member"(( SELECT "auth"."uid"() AS "uid"), "team_id"));

CREATE POLICY "Team members can update ad_accounts" ON "public"."ad_accounts" FOR UPDATE TO "authenticated" USING ("public"."is_team_member"(( SELECT "auth"."uid"() AS "uid"), "team_id"));

CREATE POLICY "team_member_insert" ON "public"."ad_accounts" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_team_member"(( SELECT "auth"."uid"() AS "uid"), "team_id"));

CREATE POLICY "team_member_update" ON "public"."ad_accounts" FOR UPDATE TO "authenticated" USING ("public"."is_team_member"(( SELECT "auth"."uid"() AS "uid"), "team_id")) WITH CHECK ("public"."is_team_member"(( SELECT "auth"."uid"() AS "uid"), "team_id"));

CREATE POLICY "Team members can insert ad insights" ON "public"."ad_insights" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM ("public"."ad_accounts" "aa"
     JOIN "public"."workspace_members" "wm" ON (("wm"."team_id" = "aa"."team_id")))
  WHERE (("aa"."id" = "ad_insights"."ad_account_id") AND ("wm"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (EXISTS ( SELECT 1
   FROM ("public"."ad_accounts" "aa"
     JOIN "public"."workspaces" "w" ON (("w"."id" = "aa"."team_id")))
  WHERE (("aa"."id" = "ad_insights"."ad_account_id") AND ("w"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));

CREATE POLICY "team_member_insert" ON "public"."ad_insights" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."ad_accounts" "aa"
  WHERE (("aa"."id" = "ad_insights"."ad_account_id") AND "public"."is_team_member"(( SELECT "auth"."uid"() AS "uid"), "aa"."team_id")))));

CREATE POLICY "team_member_update" ON "public"."ad_insights" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."ad_accounts" "aa"
  WHERE (("aa"."id" = "ad_insights"."ad_account_id") AND "public"."is_team_member"(( SELECT "auth"."uid"() AS "uid"), "aa"."team_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."ad_accounts" "aa"
  WHERE (("aa"."id" = "ad_insights"."ad_account_id") AND "public"."is_team_member"(( SELECT "auth"."uid"() AS "uid"), "aa"."team_id")))));

-- seed_demo_insights, verbatim from the dump.
CREATE OR REPLACE FUNCTION "public"."seed_demo_insights"("p_ad_account_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  d int;
  v_date date;
  v_impr int; v_clicks int; v_conv int; v_reach int;
  v_spend numeric; v_roas numeric; v_ctr numeric; v_cpc numeric; v_cpm numeric;
BEGIN
  -- Only seed if this ad_account has fewer than 5 insight rows (idempotent)
  IF (SELECT COUNT(*) FROM public.ad_insights WHERE ad_account_id = p_ad_account_id) >= 5 THEN
    RETURN;
  END IF;

  -- Seed 30 days × 1 row per day for this account
  FOR d IN 0..29 LOOP
    v_date   := CURRENT_DATE - d;
    v_impr   := 800  + floor(random() * 2200)::int;
    v_clicks := 30   + floor(random() * 120)::int;
    v_conv   := 2    + floor(random() * 18)::int;
    v_reach  := floor(v_impr * (0.6 + random() * 0.3))::int;
    v_spend  := round((50 + random() * 350)::numeric, 2);
    v_roas   := round((1.5 + random() * 4.5)::numeric, 2);
    v_ctr    := round((v_clicks::numeric / GREATEST(v_impr, 1) * 100), 4);
    v_cpc    := round((v_spend / GREATEST(v_clicks, 1)), 2);
    v_cpm    := round((v_spend / GREATEST(v_impr, 1) * 1000), 2);

    INSERT INTO public.ad_insights (
      id, ad_account_id, campaign_id, date,
      impressions, reach, clicks, conversions,
      spend, roas, ctr, cpc, cpm, created_at
    ) VALUES (
      gen_random_uuid(),
      p_ad_account_id,
      NULL,  -- no campaign needed for demo data
      v_date,
      v_impr, v_reach, v_clicks, v_conv,
      v_spend, v_roas, v_ctr, v_cpc, v_cpm,
      NOW() - (d * INTERVAL '1 day')
    ) ON CONFLICT DO NOTHING;
  END LOOP;

END;
$$;

ALTER FUNCTION "public"."seed_demo_insights"("p_ad_account_id" "uuid") OWNER TO "postgres";

COMMENT ON FUNCTION "public"."seed_demo_insights"("p_ad_account_id" "uuid") IS 'Seeds 30 days of demo ad insights for a newly connected ad_account. Idempotent.';

GRANT ALL ON FUNCTION "public"."seed_demo_insights"("p_ad_account_id" "uuid") TO "anon";

GRANT ALL ON FUNCTION "public"."seed_demo_insights"("p_ad_account_id" "uuid") TO "authenticated";

GRANT ALL ON FUNCTION "public"."seed_demo_insights"("p_ad_account_id" "uuid") TO "service_role";

-- The dump has no `REVOKE ... FROM PUBLIC` for this function, which pg_dump
-- emits whenever PUBLIC lacks the default EXECUTE — so PUBLIC had it before.
-- CREATE OR REPLACE keeps an existing (revoked) ACL, hence the explicit grant.
GRANT EXECUTE ON FUNCTION "public"."seed_demo_insights"("p_ad_account_id" "uuid") TO PUBLIC;

COMMIT;
