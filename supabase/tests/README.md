# Migration tests

Checks that run against a throwaway PostgreSQL container rather than against
the project's database. Nothing here touches cloud or the local Supabase stack.

## `verify_dlq_migration.sh`

Proves the claims that `20260805150000_ingestion_dlq_and_atomic_promote.sql`
makes: a batch commits entirely or not at all, a refusal leaves no rows behind,
the dead-letter record survives the rollback that produced it, and none of the
three new tables is reachable without `service_role`.

```bash
docker run -d --name dlq_verify -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=verify postgres:17
docker cp supabase/tests/replica_schema.sql dlq_verify:/tmp/replica.sql
docker exec dlq_verify psql -U postgres -d verify -v ON_ERROR_STOP=1 -q -f /tmp/replica.sql
for m in 20260805150000_ingestion_dlq_and_atomic_promote 20260805160000_ingestion_dlq_conflict_target; do
  docker cp "supabase/migrations/$m.sql" "dlq_verify:/tmp/$m.sql"
  docker exec dlq_verify psql -U postgres -d verify -v ON_ERROR_STOP=1 -q -f "/tmp/$m.sql"
done
./supabase/tests/verify_dlq_migration.sh          # 51 checks, exits non-zero on any failure
docker rm -f dlq_verify
```

`replica_schema.sql` is a cut-down copy of the live tables `promote_batch()`
writes — column types, NOT NULLs, defaults, foreign keys and unique indexes are
taken from the cloud schema and from the migrations that created them, and
everything the function does not touch is left out.

**Each check is its own `psql -c`**, so each runs in its own session and its own
implicit transaction. That is the point rather than a convenience: it is the
same one-request-one-transaction shape PostgREST gives the DAG, so a rollback
demonstrated here is a rollback demonstrated for the path that runs in
production.

### What this does *not* prove

That PostgREST maps one HTTP request to one transaction. That is documented
behaviour and the whole architecture rests on it, but it is a property of
PostgREST, not of the SQL — it is closed by the live end-to-end run against
cloud, not here.
