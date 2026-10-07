"""L-7 mechanism probe: does deleting a workspace silently erase its import history?"""
import json, sys, uuid, datetime
sys.path.insert(0, "tests")
import kpi_harness as k

db = k.Supabase(*k.load_service_credentials())
start = datetime.datetime.now(datetime.timezone.utc).isoformat()
owner = db.select("workspaces", f"id=eq.{k.TEST_TEAM_ID}&select=owner_id")[0]["owner_id"]
ws, job = str(uuid.uuid4()), str(uuid.uuid4())
before = {t: db.count(t) for t in ("workspaces", "import_jobs", "ingestion_dlq", "ad_insights")}

db.insert("workspaces", [{"id": ws, "name": f"L7-cascade-probe {start}", "owner_id": owner}])
db.insert("import_jobs", [{"id": job, "team_id": ws, "platform": "shopee_ads",
    "storage_path": f"{ws}/{job}/probe.csv", "original_filename": "probe.csv", "status": "succeeded"}])

print("job present before delete:", db.count("import_jobs", f"id=eq.{job}&select=*"))

# Blast radius: only rows we just created reference ws.
assert db.count("workspaces", f"id=eq.{ws}&select=*") == 1
n = db.delete("workspaces", f"id=eq.{ws}")
print("workspaces deleted:", n)
print("job present after delete:", db.count("import_jobs", f"id=eq.{job}&select=*"))
after = {t: db.count(t) for t in before}
print("counts before", before, "after", after)
audit = db.select("audit_logs_enhanced", f"created_at=gte.{start.replace('+00:00', 'Z')}&select=category,description,metadata")
print("audit rows since start:", json.dumps(audit, default=str)[:1500])
