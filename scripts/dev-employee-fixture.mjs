/**
 * Mint or remove a throwaway employee (dev | support | owner) for verifying the employee-only
 * pages against the real cloud project.
 *
 *   node scripts/dev-employee-fixture.mjs create [role]  # prints export lines
 *   node scripts/dev-employee-fixture.mjs destroy  # removes every trace
 *
 * WHY THIS EXISTS AS A FILE rather than an ad-hoc snippet: the delete order is
 * not obvious and getting it wrong strands a privileged account. `employees_profile`
 * has an FK to `employees` and `useEmployeeAuth` inserts a profile row on first
 * sign-in, so deleting the employee first fails, the auth user gets deleted
 * anyway, and what is left is an employees row pointing at a user that no longer
 * exists. Destroy therefore goes profile → employee → auth user, and verifies.
 *
 * Every statement is scoped by the `dlq-rls-check-` email prefix. Nothing else
 * in `employees` can match it.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";

const parseEnv = (path) =>
  Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
      .map((l) => {
        const [k, ...rest] = l.split("=");
        return [k.trim(), rest.join("=").trim().replace(/^["']|["']$/g, "")];
      }),
  );

const svc = parseEnv("mock-api/.env");
const URL = svc.SUPABASE_URL.replace(/\/$/, "");
const SERVICE_KEY = svc.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

const PREFIX = "dev-e2e-check-";
// role_employees ids. `destroy` matches on PREFIX alone, so every role minted
// here is cleaned up by the same command.
const ROLES = {
  dev: "9d489879-8e8e-49e6-a9ab-20d6c491053d",
  support: "af8ae2a9-42cc-432d-9264-4b29a26d3304",
  owner: "ec9a79bf-089d-49b9-9c9b-d0fd29995c28",
};

async function create(roleName = "dev") {
  const roleId = ROLES[roleName];
  if (!roleId) {
    console.error(`unknown role '${roleName}' — expected one of ${Object.keys(ROLES).join(", ")}`);
    process.exit(2);
  }
  const email = `${PREFIX}${Date.now()}@buzzly.test`;
  const password = `Verify-${randomBytes(12).toString("hex")}!`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;

  const { error: empError } = await admin.from("employees").insert({
    id: randomUUID(),
    user_id: data.user.id,
    email,
    role_employees_id: roleId,
    status: "active",
    approval_status: "approved",
  });
  if (empError) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw empError;
  }

  const prefix = roleName === "dev" ? "DEV" : roleName.toUpperCase();
  console.log(`export ${prefix}_E2E_EMAIL='${email}'`);
  console.log(`export ${prefix}_E2E_PASSWORD='${password}'`);
}

async function destroy() {
  const { data: employees, error } = await admin
    .from("employees")
    .select("id,user_id,email")
    .like("email", `${PREFIX}%`);
  if (error) throw error;

  console.log(`found ${employees.length} throwaway employee(s)`);

  for (const employee of employees) {
    const { data: profiles } = await admin
      .from("employees_profile")
      .delete()
      .eq("employees_id", employee.id)
      .select("id");
    const { data: rows } = await admin
      .from("employees")
      .delete()
      .eq("id", employee.id)
      .select("id");
    const { error: userError } = await admin.auth.admin.deleteUser(employee.user_id);
    console.log(
      `  ${employee.email}: ${profiles?.length ?? 0} profile, ${rows?.length ?? 0} employee, auth ${userError ? `FAILED (${userError.message})` : "deleted"}`,
    );
  }

  const { data: left } = await admin
    .from("employees")
    .select("id")
    .like("email", `${PREFIX}%`);
  if ((left ?? []).length > 0) {
    console.error(`FAILED: ${left.length} throwaway employee(s) still present`);
    process.exit(1);
  }
  console.log("verified: nothing matching the throwaway prefix remains");
}

const command = process.argv[2];
if (command === "create") await create(process.argv[3]);
else if (command === "destroy") await destroy();
else {
  console.error("usage: node scripts/dev-employee-fixture.mjs create [dev|support|owner] | destroy");
  process.exit(2);
}
