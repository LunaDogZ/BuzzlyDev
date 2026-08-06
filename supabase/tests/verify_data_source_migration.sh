#!/usr/bin/env bash
# Verification for 20260806090000_ad_insights_data_source.sql.
#
# Self-contained: creates its own throwaway container, tears it down at the end.
# It has to own the container because the claim that matters most — the backfill
# labels exactly the imported rows — can only be tested by seeding data in the
# *pre-migration* shape and then applying the migration to it. Applying it first
# and inserting afterwards would test the DEFAULT, not the backfill.
#
# As in verify_dlq_migration.sh, every check is its own `psql -c`: one session,
# one implicit transaction, the same shape PostgREST gives the DAG.
set -u
CT=ds_verify
DB=(docker exec "$CT" psql -U postgres -d verify -tAqX)
PASS=0; FAIL=0

q()    { "${DB[@]}" -c "$1" 2>&1; }
qerr() { "${DB[@]}" -c "$1" 2>&1 | head -1; }

check() { # check <label> <actual> <expected>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '  ok   %-58s %s\n' "$1" "$2"
  else FAIL=$((FAIL+1)); printf '  FAIL %-58s got=%s want=%s\n' "$1" "$2" "$3"; fi
}
contains() { # contains <label> <haystack> <needle>
  case "$2" in *"$3"*) PASS=$((PASS+1)); printf '  ok   %-58s %s\n' "$1" "$3";;
  *) FAIL=$((FAIL+1)); printf '  FAIL %-58s got=%s want~=%s\n' "$1" "$2" "$3";; esac
}

apply() { docker cp "$1" "$CT:/tmp/m.sql" >/dev/null && \
          docker exec "$CT" psql -U postgres -d verify -v ON_ERROR_STOP=1 -q -f /tmp/m.sql; }

WS=11111111-1111-1111-1111-111111111111
PLAT=22222222-2222-2222-2222-222222222222
ACCT=33333333-3333-3333-3333-333333333333
JOB=44444444-4444-4444-4444-444444444444
B1=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
GRP=a1111111-1111-1111-1111-111111111111
CAMP=c1111111-1111-1111-1111-111111111111
AD_IMP=d1111111-1111-1111-1111-111111111111
AD_API=d2222222-2222-2222-2222-222222222222
AD_NEW=d3333333-3333-3333-3333-333333333333

echo "── container ────────────────────────────────────────────────────────────"
docker rm -f "$CT" >/dev/null 2>&1
docker run -d --name "$CT" -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=verify postgres:17 >/dev/null
for _ in $(seq 1 30); do
  docker exec "$CT" pg_isready -U postgres -d verify >/dev/null 2>&1 && break
  sleep 1
done
apply supabase/tests/replica_schema.sql >/dev/null
apply supabase/migrations/20260805150000_ingestion_dlq_and_atomic_promote.sql >/dev/null
apply supabase/migrations/20260805160000_ingestion_dlq_conflict_target.sql >/dev/null
echo "  schema + DLQ migrations applied (data_source does NOT exist yet)"

echo
echo "── the state this migration finds in production ─────────────────────────"
# One ad account holding both sources, because ad_accounts is UNIQUE
# (team_id, platform_id) and an import must adopt the connected account.
q "INSERT INTO workspaces (id,name) VALUES ('$WS','Verify WS');
   INSERT INTO platforms (id,name,slug) VALUES ('$PLAT','Facebook','facebook');
   INSERT INTO ad_accounts (id,team_id,platform_id,account_name)
     VALUES ('$ACCT','$WS','$PLAT','E2E Facebook Account');
   INSERT INTO ad_groups (id,team_id,name,source_platform,external_group_id)
     VALUES ('$GRP','$WS','Set A','meta','import:$GRP');
   INSERT INTO campaigns (id,team_id,ad_account_id,name,status)
     VALUES ('$CAMP','$WS','$ACCT','Campaign','active');
   INSERT INTO ads (id,team_id,ad_group_id,name,platform,platform_ad_id,status) VALUES
     ('$AD_IMP','$WS','$GRP','Uploaded ad','meta','import:$AD_IMP','active'),
     ('$AD_API','$WS','$GRP','Connected ad','meta','120210000000000','active');
   INSERT INTO import_jobs (id,team_id,platform,storage_path,original_filename,file_hash)
     VALUES ('$JOB','$WS','meta','p/1','clean.csv','hash-clean');
   -- 3 rows the pipeline wrote, 2 the mock connect wrote, 1 with no ad at all.
   INSERT INTO ad_insights (ad_account_id,campaign_id,ads_id,date,impressions) VALUES
     ('$ACCT','$CAMP','$AD_IMP','2026-07-01',100),
     ('$ACCT','$CAMP','$AD_IMP','2026-07-02',200),
     ('$ACCT','$CAMP','$AD_IMP','2026-07-03',300),
     ('$ACCT','$CAMP','$AD_API','2026-07-01',400),
     ('$ACCT','$CAMP','$AD_API','2026-07-02',500),
     ('$ACCT','$CAMP',NULL,      '2026-07-04',600);" >/dev/null
check "6 insights seeded before the migration" "$(q "SELECT count(*) FROM ad_insights;")" 6
check "no data_source column yet" \
  "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='ad_insights' AND column_name='data_source';")" 0

echo
echo "T1 — the migration applies and labels the existing rows ────────────────"
apply supabase/migrations/20260806090000_ad_insights_data_source.sql >/dev/null 2>&1
check "column exists"        "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='ad_insights' AND column_name='data_source';")" 1
check "column is NOT NULL"   "$(q "SELECT is_nullable='NO' FROM information_schema.columns WHERE table_name='ad_insights' AND column_name='data_source';")" "t"
check "default is api"       "$(q "SELECT column_default LIKE '%api%' FROM information_schema.columns WHERE table_name='ad_insights' AND column_name='data_source';")" "t"
check "backfill: import rows"  "$(q "SELECT count(*) FROM ad_insights WHERE data_source='import';")" 3
check "backfill: api rows"     "$(q "SELECT count(*) FROM ad_insights WHERE data_source='api';")"    3
# The point of the whole exercise: the labels track the ad, not the account.
check "every import row is on the import ad" \
  "$(q "SELECT count(*) FROM ad_insights i JOIN ads a ON a.id=i.ads_id WHERE i.data_source='import' AND a.platform_ad_id NOT LIKE 'import:%';")" 0
check "no connected-ad row was mislabelled" \
  "$(q "SELECT count(*) FROM ad_insights i JOIN ads a ON a.id=i.ads_id WHERE i.data_source='api' AND a.platform_ad_id LIKE 'import:%';")" 0
check "an insight with no ad stays api" \
  "$(q "SELECT data_source FROM ad_insights WHERE ads_id IS NULL;")" "api"
check "totals still sum to the whole"  "$(q "SELECT count(*) FROM ad_insights;")" 6
check "index for the filtered read exists" \
  "$(q "SELECT count(*) FROM pg_indexes WHERE indexname='ad_insights_account_source_date_idx';")" 1

echo
echo "T2 — the migration is re-runnable (the FYP grading rule) ───────────────"
apply supabase/migrations/20260806090000_ad_insights_data_source.sql >/dev/null 2>&1
check "second apply exits clean"  "$?" 0
check "still 3 import"            "$(q "SELECT count(*) FROM ad_insights WHERE data_source='import';")" 3
check "still 3 api"               "$(q "SELECT count(*) FROM ad_insights WHERE data_source='api';")"    3

echo
echo "T3 — a writer that does not name a source is API data ──────────────────"
# The mock connect path, and every pre-existing writer, insert without the
# column. Silently labelling those as imports would move a merchant's live
# platform numbers under "uploaded files".
q "INSERT INTO ad_insights (ad_account_id,campaign_id,ads_id,date,impressions)
   VALUES ('$ACCT','$CAMP','$AD_API','2026-07-09',700);" >/dev/null
check "unnamed insert defaults to api" \
  "$(q "SELECT data_source FROM ad_insights WHERE date='2026-07-09';")" "api"

echo
echo "T4 — the closed value set is enforced ──────────────────────────────────"
E=$(qerr "INSERT INTO ad_insights (ad_account_id,campaign_id,ads_id,date,data_source)
          VALUES ('$ACCT','$CAMP','$AD_API','2026-07-10','manual');")
contains "a third value is rejected"      "$E" "ad_insights_data_source_check"
E=$(qerr "UPDATE ad_insights SET data_source=NULL WHERE date='2026-07-09';")
contains "NULL is rejected"               "$E" "not-null"
check "the bad rows did not land"         "$(q "SELECT count(*) FROM ad_insights WHERE date='2026-07-10';")" 0

echo
echo "T5 — promote_batch labels what it commits ──────────────────────────────"
q "INSERT INTO ingestion_staging (batch_id,target_table,row_index,payload) VALUES
   ('$B1','ads',0,'{\"id\":\"$AD_NEW\",\"team_id\":\"$WS\",\"ad_group_id\":\"$GRP\",\"name\":\"New ad\",\"platform\":\"meta\",\"platform_ad_id\":\"import:$AD_NEW\",\"status\":\"active\",\"external_status\":\"published\"}'),
   ('$B1','ad_insights',0,'{\"ad_account_id\":\"$ACCT\",\"campaign_id\":\"$CAMP\",\"ads_id\":\"$AD_NEW\",\"date\":\"2026-07-20\",\"impressions\":1000,\"reach\":900,\"clicks\":45,\"conversions\":3,\"spend\":\"120.50\",\"ctr\":\"4.5000\",\"cpc\":\"2.68\",\"cpm\":\"120.50\",\"roas\":\"3.20\"}');" >/dev/null
R=$(q "SELECT promote_batch('$B1','$JOB','$WS');")
contains "promote committed the row"      "$R" '"ad_insights": 1'
check "the promoted row says import"      "$(q "SELECT data_source FROM ad_insights WHERE date='2026-07-20';")" "import"
# The payload cannot override it — the label is a property of the code path.
q "DELETE FROM ingestion_batches WHERE batch_id='$B1';
   INSERT INTO ingestion_staging (batch_id,target_table,row_index,payload) VALUES
   ('$B1','ad_insights',0,'{\"ad_account_id\":\"$ACCT\",\"campaign_id\":\"$CAMP\",\"ads_id\":\"$AD_NEW\",\"date\":\"2026-07-21\",\"impressions\":10,\"data_source\":\"api\"}');" >/dev/null
q "SELECT promote_batch('$B1','$JOB','$WS');" >/dev/null
check "a payload claiming api is ignored" "$(q "SELECT data_source FROM ad_insights WHERE date='2026-07-21';")" "import"

echo
echo "T6 — an import overwriting an API row takes ownership of it ────────────"
# Same (ad_account_id, ads_id, date) as the API row seeded above: promote
# replaces every metric on it, so the row is the file's afterwards. Leaving it
# labelled 'api' would show a merchant an uploaded number under "connected".
q "DELETE FROM ingestion_batches WHERE batch_id='$B1';
   DELETE FROM ingestion_staging WHERE batch_id='$B1';
   INSERT INTO ingestion_staging (batch_id,target_table,row_index,payload) VALUES
   ('$B1','ad_insights',0,'{\"ad_account_id\":\"$ACCT\",\"campaign_id\":\"$CAMP\",\"ads_id\":\"$AD_API\",\"date\":\"2026-07-01\",\"impressions\":9999}');" >/dev/null
q "SELECT promote_batch('$B1','$JOB','$WS');" >/dev/null
check "the overwritten row is now import"  "$(q "SELECT data_source FROM ad_insights WHERE ads_id='$AD_API' AND date='2026-07-01';")" "import"
check "and it carries the new number"      "$(q "SELECT impressions FROM ad_insights WHERE ads_id='$AD_API' AND date='2026-07-01';")" 9999
check "it did not become a second row"     "$(q "SELECT count(*) FROM ad_insights WHERE ads_id='$AD_API' AND date='2026-07-01';")" 1

echo
echo "═════════════════════════════════════════════════════════════════════════"
echo "  PASS $PASS   FAIL $FAIL"
docker rm -f "$CT" >/dev/null 2>&1
[ "$FAIL" -eq 0 ] || exit 1
