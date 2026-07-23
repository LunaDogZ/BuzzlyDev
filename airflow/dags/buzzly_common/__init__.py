"""Shared helpers for the Buzzly ingestion DAGs.

Lives inside the dags folder because Airflow puts DAGS_FOLDER on sys.path at
parse time, so `from buzzly_common.supabase import SupabaseClient` resolves in
both the DAG processor and the task runner without any packaging step.
"""
