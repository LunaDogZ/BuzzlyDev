#!/usr/bin/env bash
# Verification for 20260805150000_ingestion_dlq_and_atomic_promote.sql.
#
# Every check runs as its own `psql -c`, i.e. its own session and its own
# implicit transaction. That is deliberate: it is the exact shape PostgREST
# gives us over HTTP (one request = one statement = one transaction), so a
# rollback proven here is a rollback proven for the path the DAG will use.
set -u
DB=(docker exec dlq_verify psql -U postgres -d verify -tAqX)
PASS=0; FAIL=0

q()   { "${DB[@]}" -c "$1" 2>&1; }
# Run a statement expecting it to fail; print the SQLSTATE-ish first line.
qerr() { "${DB[@]}" -c "$1" 2>&1 | head -1; }

check() { # check <label> <actual> <expected>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '  ok   %-58s %s\n' "$1" "$2"
  else FAIL=$((FAIL+1)); printf '  FAIL %-58s got=%s want=%s\n' "$1" "$2" "$3"; fi
}
contains() { # contains <label> <haystack> <needle>
  case "$2" in *"$3"*) PASS=$((PASS+1)); printf '  ok   %-58s %s\n' "$1" "$3";;
  *) FAIL=$((FAIL+1)); printf '  FAIL %-58s got=%s want~=%s\n' "$1" "$2" "$3";; esac
}

WS=11111111-1111-1111-1111-111111111111
PLAT=22222222-2222-2222-2222-222222222222
ACCT=33333333-3333-3333-3333-333333333333
JOB1=44444444-4444-4444-4444-444444444444
JOB2=55555555-5555-5555-5555-555555555555
JOB3=66666666-6666-6666-6666-666666666666
B1=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
B2=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
GRP=a1111111-1111-1111-1111-111111111111
CAMP=c1111111-1111-1111-1111-111111111111
AD=d1111111-1111-1111-1111-111111111111
GRP2=a2222222-2222-2222-2222-222222222222
CAMP2=c2222222-2222-2222-2222-222222222222
AD2=d2222222-2222-2222-2222-222222222222
GHOST=f0f0f0f0-f0f0-f0f0-f0f0-f0f0f0f0f0f0

echo "── fixtures ─────────────────────────────────────────────────────────────"
q "TRUNCATE ingestion_staging, ingestion_batches, ingestion_dlq, ad_insights,
          campaign_ads, ads, campaigns, ad_groups, sync_history, import_jobs,
          ad_accounts, platforms, workspaces CASCADE;
   INSERT INTO workspaces (id,name) VALUES ('$WS','Verify WS');
   INSERT INTO platforms (id,name,slug) VALUES ('$PLAT','Facebook','facebook');
   INSERT INTO ad_accounts (id,team_id,platform_id,account_name)
     VALUES ('$ACCT','$WS','$PLAT','Meta (file import)');
   INSERT INTO import_jobs (id,team_id,platform,storage_path,original_filename,file_hash)
     VALUES ('$JOB1','$WS','meta','p/1','clean.csv','hash-clean'),
            ('$JOB2','$WS','meta','p/2','broken.csv','hash-broken'),
            ('$JOB3','$WS','meta','p/3','dupe.csv','hash-clean');" >/dev/null

stage_good() { # stage_good <batch> <camp> <grp> <ad> <date> <impr>
  q "INSERT INTO ingestion_staging (batch_id,target_table,row_index,payload) VALUES
   ('$1','ad_groups',0,'{\"id\":\"$3\",\"team_id\":\"$WS\",\"name\":\"Set A\",\"status\":\"active\",\"source_platform\":\"meta\",\"external_group_id\":\"import:$3\"}'),
   ('$1','campaigns',0,'{\"id\":\"$2\",\"team_id\":\"$WS\",\"ad_account_id\":\"$ACCT\",\"name\":\"Campaign $2\",\"status\":\"active\",\"objective\":\"CONVERSIONS\"}'),
   ('$1','campaign_windows',0,'{\"id\":\"$2\",\"start_date\":\"2026-07-01T00:00:00Z\",\"end_date\":\"2026-07-15T23:59:59Z\"}'),
   ('$1','ads',0,'{\"id\":\"$4\",\"team_id\":\"$WS\",\"ad_group_id\":\"$3\",\"name\":\"Ad $4\",\"platform\":\"meta\",\"platform_ad_id\":\"import:$4\",\"status\":\"active\",\"external_status\":\"published\"}'),
   ('$1','campaign_ads',0,'{\"campaign_id\":\"$2\",\"ad_id\":\"$4\"}'),
   ('$1','ad_insights',0,'{\"ad_account_id\":\"$ACCT\",\"campaign_id\":\"$2\",\"ads_id\":\"$4\",\"date\":\"$5\",\"impressions\":$6,\"reach\":900,\"clicks\":45,\"conversions\":3,\"spend\":\"120.50\",\"ctr\":\"4.5000\",\"cpc\":\"2.68\",\"cpm\":\"120.50\",\"roas\":\"3.20\"}'),
   ('$1','sync_history',0,'{\"id\":\"$(echo $1 | sed s/^./9/)\",\"team_id\":\"$WS\",\"platform_id\":\"$PLAT\",\"sync_type\":\"manual\",\"status\":\"success\",\"rows_synced\":1,\"started_at\":\"2026-08-05T00:00:00Z\",\"completed_at\":\"2026-08-05T00:00:05Z\"}');" >/dev/null
}

echo
echo "T1 — a good batch commits, and every table gets its rows ───────────────"
stage_good "$B1" "$CAMP" "$GRP" "$AD" "2026-07-10" 1000
R=$(q "SELECT promote_batch('$B1','$JOB1','$WS');")
contains "promote reports it did the work"      "$R" '"already_promoted": false'
contains "ad_insights count in the result"      "$R" '"ad_insights": 1'
check "campaigns committed"      "$(q "SELECT count(*) FROM campaigns;")"    1
check "ad_groups committed"      "$(q "SELECT count(*) FROM ad_groups;")"    1
check "ads committed"            "$(q "SELECT count(*) FROM ads;")"          1
check "campaign_ads committed"   "$(q "SELECT count(*) FROM campaign_ads;")" 1
check "ad_insights committed"    "$(q "SELECT count(*) FROM ad_insights;")"  1
check "sync_history committed"   "$(q "SELECT count(*) FROM sync_history;")" 1
check "staging buffer drained"   "$(q "SELECT count(*) FROM ingestion_staging WHERE batch_id='$B1';")" 0
check "batch recorded"           "$(q "SELECT rows_promoted FROM ingestion_batches WHERE batch_id='$B1';")" 1
check "window start applied"     "$(q "SELECT start_date::date FROM campaigns WHERE id='$CAMP';")" "2026-07-01"

echo
echo "T2 — a fault mid-promote commits NOTHING (the atomicity claim) ─────────"
# Same shape as T1 but the insight points at a campaign that does not exist and
# is not in the batch. campaigns/ad_groups/ads insert first and would already be
# in the table when the FK on ad_insights raises.
stage_good "$B2" "$CAMP2" "$GRP2" "$AD2" "2026-07-11" 2000
q "UPDATE ingestion_staging
     SET payload = jsonb_set(payload,'{campaign_id}','\"$GHOST\"')
   WHERE batch_id='$B2' AND target_table='ad_insights';" >/dev/null
ERR=$(qerr "SELECT promote_batch('$B2','$JOB2','$WS');")
contains "promote fails loudly"                 "$ERR" "violates foreign key constraint"
check "no second campaign leaked"  "$(q "SELECT count(*) FROM campaigns WHERE id='$CAMP2';")"  0
check "no second ad_group leaked"  "$(q "SELECT count(*) FROM ad_groups WHERE id='$GRP2';")"   0
check "no second ad leaked"        "$(q "SELECT count(*) FROM ads WHERE id='$AD2';")"          0
check "no second sync_history"     "$(q "SELECT count(*) FROM sync_history;")"                 1
check "production still at T1 size" "$(q "SELECT count(*) FROM ad_insights;")"                 1
check "failed batch not recorded"  "$(q "SELECT count(*) FROM ingestion_batches WHERE batch_id='$B2';")" 0
check "LEAKED ROWS (hard gate)"    "$(q "SELECT count(*) FROM ad_insights i
                                          JOIN campaigns c ON c.id=i.campaign_id
                                          WHERE c.id IN ('$CAMP2','$GHOST');")" 0
check "staging buffer survived the rollback" "$(q "SELECT count(*) FROM ingestion_staging WHERE batch_id='$B2';")" 7

echo
echo "T3 — the DLQ write is a separate transaction, so it survives ───────────"
q "INSERT INTO ingestion_dlq (import_job_id,team_id,batch_id,original_filename,file_hash,
                              platform,error_code,error_message,stage,rows_attempted,rows_rejected)
   VALUES ('$JOB2','$WS','$B2','broken.csv','hash-broken','meta',
           'ROW_VALIDATION_FAILED','7 of 10 rows failed the validation rules','validate',10,7);" >/dev/null
check "DLQ row exists after the rollback" "$(q "SELECT count(*) FROM ingestion_dlq WHERE import_job_id='$JOB2';")" 1
check "DLQ kept the reason"               "$(q "SELECT error_code FROM ingestion_dlq WHERE import_job_id='$JOB2';")" "ROW_VALIDATION_FAILED"
check "buffer discardable"                "$(q "SELECT discard_staging_batch('$B2');")" 7

echo
echo "T4 — exactly one DLQ row per job, enforced by the database ─────────────"
E=$(qerr "INSERT INTO ingestion_dlq (import_job_id,team_id,error_code)
          VALUES ('$JOB2','$WS','UNKNOWN');")
contains "a second DLQ row is rejected" "$E" "ingestion_dlq_import_job_id_key"
# No predicate on the ON CONFLICT clause, because PostgREST does not emit one.
# The original partial unique index enforced the rule perfectly and could not
# serve as this target (42P10), so every DLQ write failed in production while
# every test here passed. That is why this statement is written the hard way.
E=$(qerr "INSERT INTO ingestion_dlq (import_job_id,team_id,error_code,error_message)
          VALUES ('$JOB2','$WS','TYPE_COERCION_FAILED','revised')
          ON CONFLICT (import_job_id)
          DO UPDATE SET error_code=EXCLUDED.error_code, error_message=EXCLUDED.error_message;")
check "the upsert target is inferrable"     "$(echo "$E" | grep -c 42P10)" 0
check "the upsert path rewrites in place" "$(q "SELECT error_code FROM ingestion_dlq WHERE import_job_id='$JOB2';")" "TYPE_COERCION_FAILED"
check "still exactly one row"             "$(q "SELECT count(*) FROM ingestion_dlq WHERE import_job_id='$JOB2';")" 1
check "orphaned records are not unique-constrained" \
  "$(q "INSERT INTO ingestion_dlq (team_id,error_code) VALUES ('$WS','UNKNOWN'),('$WS','UNKNOWN');
        SELECT count(*) FROM ingestion_dlq WHERE import_job_id IS NULL;")" 2
q "DELETE FROM ingestion_dlq WHERE import_job_id IS NULL;" >/dev/null
E=$(qerr "INSERT INTO ingestion_dlq (import_job_id,team_id,error_code)
          VALUES ('$JOB3','$WS','NOT_A_REAL_CODE');")
contains "an invented code is rejected" "$E" "violates check constraint"

echo
echo "T5 — re-promoting a batch changes nothing (idempotency) ────────────────"
R=$(q "SELECT promote_batch('$B1','$JOB1','$WS');")
contains "reported as already promoted" "$R" '"already_promoted": true'
check "ad_insights unchanged"  "$(q "SELECT count(*) FROM ad_insights;")" 1
check "campaigns unchanged"    "$(q "SELECT count(*) FROM campaigns;")"   1
check "one batch row only"     "$(q "SELECT count(*) FROM ingestion_batches;")" 1

echo
echo "T6 — a re-import updates its rows, and only widens the window ──────────"
# A corrected export: same campaign and ad, same day, different numbers, plus a
# day outside the first window on either side.
q "INSERT INTO ingestion_staging (batch_id,target_table,row_index,payload) VALUES
 ('$B2','campaigns',0,'{\"id\":\"$CAMP\",\"team_id\":\"$WS\",\"ad_account_id\":\"$ACCT\",\"name\":\"Campaign renamed\",\"status\":\"active\",\"objective\":\"CONVERSIONS\"}'),
 ('$B2','campaign_windows',0,'{\"id\":\"$CAMP\",\"start_date\":\"2026-06-20T00:00:00Z\",\"end_date\":\"2026-07-10T00:00:00Z\"}'),
 ('$B2','ad_insights',0,'{\"ad_account_id\":\"$ACCT\",\"campaign_id\":\"$CAMP\",\"ads_id\":\"$AD\",\"date\":\"2026-07-10\",\"impressions\":5555,\"clicks\":50,\"spend\":\"200.00\"}');" >/dev/null
q "SELECT promote_batch('$B2','$JOB2','$WS');" >/dev/null
check "the day was updated, not duplicated" "$(q "SELECT count(*) FROM ad_insights;")" 1
check "new impressions took effect"         "$(q "SELECT impressions FROM ad_insights;")" 5555
check "window start grew earlier"           "$(q "SELECT start_date::date FROM campaigns WHERE id='$CAMP';")" "2026-06-20"
check "window end did NOT shrink"           "$(q "SELECT end_date::date FROM campaigns WHERE id='$CAMP';")"   "2026-07-15"

echo
echo "T7 — RLS: none of this is reachable without service_role ───────────────"
for role in anon authenticated; do
  check "$role sees no ingestion_dlq rows"     "$(q "SET ROLE $role; SELECT count(*) FROM ingestion_dlq;")"     0
  check "$role sees no ingestion_staging rows" "$(q "SET ROLE $role; SELECT count(*) FROM ingestion_staging;")" 0
  check "$role sees no ingestion_batches rows" "$(q "SET ROLE $role; SELECT count(*) FROM ingestion_batches;")" 0
  E=$(qerr "SET ROLE $role; SELECT promote_batch('$B1','$JOB1','$WS');")
  contains "$role cannot call promote_batch" "$E" "permission denied"
  E=$(qerr "SET ROLE $role; INSERT INTO ingestion_dlq (team_id,error_code) VALUES ('$WS','UNKNOWN');")
  contains "$role cannot write to the DLQ"   "$E" "row-level security"
done
check "service_role still sees everything" "$(q "SET ROLE service_role; SELECT count(*) FROM ingestion_dlq;")" 1

echo
echo "T8 — the DLQ record outlives the import the merchant deleted ───────────"
q "DELETE FROM import_jobs WHERE id='$JOB2';" >/dev/null
check "DLQ row survives"          "$(q "SELECT count(*) FROM ingestion_dlq WHERE original_filename='broken.csv';")" 1
check "its job link is nulled"    "$(q "SELECT import_job_id IS NULL FROM ingestion_dlq WHERE original_filename='broken.csv';")" "t"
check "it still names the file"   "$(q "SELECT file_hash FROM ingestion_dlq WHERE original_filename='broken.csv';")" "hash-broken"

echo
echo "═════════════════════════════════════════════════════════════════════════"
echo "  PASS $PASS   FAIL $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
