# Buzzly ingestion pipeline (Airflow)

The fallback ingestion path for merchants who cannot connect a platform API
(Shopee Open Platform approval is slow, and some merchants will never get it).
They upload the `.csv`/`.xlsx` reports they already have, and this pipeline
parses, cleans, validates and upserts them into the same tables the API
ingestion writes to.

Input fixtures for development live in [`../fixtures/imports/`](../fixtures/imports/README.md)
and are mounted read-only at `/opt/airflow/fixtures/imports`.

## Version

**Airflow 3.2.2**, pinned. Chosen for stability rather than currency: the 3.2
line has had three patch releases and ~2 months in the field, whereas 3.3.0
(2026-07-06) has none yet. Airflow 2.x is **EOL as of 2026-04-22** and gets no
security fixes, so it was not an option.

Executor is **LocalExecutor** — one merchant file at a time; Celery adds a
broker and a worker fleet for no benefit at this scale.

## Ports

The host is crowded, so all defaults are moved:

| Service | Host port | Why not the default |
|---|---|---|
| Airflow UI / REST API | **8081** | 8080 is the Vite dev server |
| Airflow metadata DB | **5434** | 5432 is `buzzly_db`, 5433 is the host's own postgres |

## Running it

```bash
cd airflow
cp .env.example .env          # then fill in the two secrets, see below
docker compose up -d
```

Generate the secrets before the first start:

```bash
echo "AIRFLOW_UID=$(id -u)"
openssl rand -base64 32 | tr '+/' '-_'   # FERNET_KEY
openssl rand -hex 32                     # AIRFLOW__API_AUTH__JWT_SECRET
```

UI: <http://localhost:8081> — login `airflow` / `airflow` (override in `.env`).

```bash
docker compose ps             # health of every service
docker compose logs -f airflow-scheduler
docker compose down           # stop
docker compose down -v        # stop and wipe the metadata DB
```

One-off CLI commands:

```bash
docker compose --profile debug run --rm airflow-cli airflow dags list
```

## Verifying the stack

`dags/buzzly_smoke_test.py` is not part of the pipeline — it exists to prove in
one run that the scheduler dispatches tasks, XCom passes values, and the
fixtures mount is readable from inside a worker.

```bash
docker compose --profile debug run --rm airflow-cli airflow dags test buzzly_smoke_test
```

## DAGs

| DAG | Schedule | Role |
|---|---|---|
| `buzzly_import_pipeline` | none (triggered) | Processes one uploaded file. Conf: `{"import_job_id": "<uuid>"}` |
| `buzzly_import_sensor` | every 2 min | Finds `pending` jobs the webhook missed and triggers the pipeline for each |
| `buzzly_smoke_test` | none | Stack health check, not part of the pipeline |

**Both import DAGs must be unpaused.** Triggering a paused DAG succeeds and
queues a run that never executes, which looks exactly like nothing happening:

```bash
docker compose --profile debug run --rm airflow-cli airflow dags unpause buzzly_import_pipeline
docker compose --profile debug run --rm airflow-cli airflow dags unpause buzzly_import_sensor
```

## Pipeline stages

`buzzly_import_pipeline` is one task per stage. That is slower than a few fat
tasks — every boundary is an XCom round-trip — and worth it: each boundary is
also a retry boundary, a log boundary, and a duration Airflow measures for free,
which is the per-stage throughput the research write-up needs.

| Stage | State | What it does |
|---|---|---|
| `resolve_job` | done | Takes ownership of the job, moves it to `running`, stamps `dag_run_id` |
| `verify_artifact` | done | Downloads the object, checks size + sha256 against the upload, stages it on disk |
| `hash_dedupe` | done | Short-circuits when this workspace already imported these exact bytes |
| `detect_format` | step 5 | csv vs xlsx, delimiter, encoding, BOM |
| `parse` | step 5 | Staged file → rows; sets `rows_total` |
| `clean_thai` | step 5 | Thai-locale cleaning — the research core |
| `validate` | step 6 | Splits `rows_ok` from `rows_quarantined` |
| `quarantine_bad_rows` | step 6 | Writes `import_row_errors` + a downloadable error CSV |
| `upsert_target` | step 7 | Idempotent upsert into the ad tables, then `sync_history` |
| `finalize` | done | Writes the one terminal status: `succeeded`, `partial` or `failed` |
| `cleanup_staging` | done | Teardown — removes the staged file however the run ended |

Stages pass a **ledger** (`dags/buzzly_common/pipeline.py`): row counts, a
staging path, a per-stage audit trail. Never file contents — XCom is the
metadata database, not a file store. Unimplemented stages pass it through
unchanged, so a run today ends `succeeded` with zero rows.

Two rules that are easy to break when filling the stages in:

- **`rows_ok + rows_quarantined` must equal `rows_total`.** `finalize` refuses
  to report counts that do not balance and fails the job instead.
- **`finalize` must stay the only leaf task.** Airflow derives the DagRun state
  from its leaves, so a plain `trigger_rule=ALL_DONE` cleanup on the end marks a
  failed run *successful* — the failure callback never fires and the job sits at
  `running` forever. `cleanup_staging` is a `.as_teardown()` for that reason;
  teardowns are excluded from the calculation. Both wirings were run against a
  deliberately broken stage to confirm it.

The stage contract has unit tests that need no Airflow and no install:

```bash
python3 -m unittest discover -s airflow/tests -v   # from the repo root
```

## How a file gets picked up

There are two trigger paths on purpose, and either one alone is sufficient.

```
upload UI → Storage + import_jobs INSERT (status=pending)
   ├─ push: DB trigger → pg_net → airflow-trigger Edge Function
   │        → POST /api/v2/dags/buzzly_import_pipeline/dagRuns
   └─ pull: buzzly_import_sensor, every 2 min, claims anything still pending
```

The push path is a latency optimisation; the pull path is the mechanism of
record. Both take a job by moving it `pending → queued` with a **conditional
update**, so only one of them can ever own a job and a file is never ingested
twice. A push that fails rolls the job back to `pending` and the sensor gets it
on the next tick.

**In local development the push path does not work and does not need to.**
Supabase Edge Functions run in Supabase's cloud and cannot reach an Airflow on
your laptop. Leave the webhook unconfigured (its default) and the sensor handles
everything; wire the webhook up only once Airflow is reachable from the internet.

## Configuration

Both DAGs read Supabase credentials from **Airflow Variables** — never DAG code,
never git:

```bash
docker compose --profile debug run --rm airflow-cli \
    airflow variables set BUZZLY_SUPABASE_URL https://<ref>.supabase.co
docker compose --profile debug run --rm airflow-cli \
    airflow variables set BUZZLY_SUPABASE_SERVICE_ROLE_KEY <service_role key>
```

`service_role` is required rather than convenient: `import_jobs` has no UPDATE
policy for `authenticated`, because every status transition belongs to the
pipeline.

`.env` is gitignored and holds the Fernet key that encrypts Variables and
Connections. **Losing it makes every stored Variable undecryptable.**

### Enabling the push path (only when Airflow is publicly reachable)

Set the Edge Function's secrets, then point the database at it:

```bash
supabase secrets set \
    AIRFLOW_BASE_URL=https://airflow.example.com \
    AIRFLOW_USERNAME=airflow \
    AIRFLOW_PASSWORD=<password> \
    BUZZLY_TRIGGER_SECRET=<generate one>
supabase functions deploy airflow-trigger --no-verify-jwt
```

`--no-verify-jwt` is required: the caller is Postgres, which has no user JWT.
The shared secret is what authenticates it, sent as `x-buzzly-trigger-secret`.

Then, as `service_role` (never in a migration — migrations are in git):

```sql
select public.set_pipeline_setting('airflow_trigger_url',    'https://<ref>.functions.supabase.co/airflow-trigger');
select public.set_pipeline_setting('airflow_trigger_secret', '<the same secret>');
select public.pipeline_webhook_health();   -- confirm it is wired up
```

The DB trigger swallows its own errors so a failed notification can never fail
an upload — which means a broken install looks like a healthy one.
`pipeline_webhook_health()` is how you tell them apart.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Job sits at `pending` forever | `buzzly_import_sensor` is paused, or the Airflow Variables are unset |
| Job sits at `queued`, `dag_run_id` null | `buzzly_import_pipeline` is paused. The sensor returns such jobs to `pending` after 10 min, but they will not progress until it is unpaused |
| A new DAG file does not appear | The dags-folder bundle rescans on an interval; `docker compose restart airflow-dag-processor` forces it |
| `docker compose exec … airflow dags list-runs` errors | Removed in Airflow 3 — use the REST API (`GET /api/v2/dags/{id}/dagRuns`) |

REST API access (Airflow 3 uses JWT, not basic auth):

```bash
TOKEN=$(curl -s -X POST http://localhost:8081/auth/token \
  -H 'Content-Type: application/json' \
  -d '{"username":"airflow","password":"airflow"}' | jq -r .access_token)
curl -s "http://localhost:8081/api/v2/dags" -H "Authorization: Bearer $TOKEN"
```

## What is not built yet

Steps 0-4 are done: the stack, the schema, the upload UI, the trigger path, and
the stage graph above with its status and row-count plumbing. The stages that do
the actual reading are still placeholders, so a run finishes as `succeeded` with
zero rows. Still to come: format detection and parsing, the Thai-locale cleaning
module (step 5), validation + quarantine + downloadable error reports (step 6),
the idempotent upsert into the ad tables (step 7), the job-status UI (step 8),
and the research measurement harness (step 9).
