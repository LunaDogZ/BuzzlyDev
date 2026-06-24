// Seeds a dedicated E2E test customer and grants it membership to a workspace
// that already has ad data, so the authenticated visual-walk e2e can render real data.
//
// Reads cloud Supabase service_role from mock-api/.env (same pattern as reseed tooling).
// Idempotent: safe to re-run.
//
// Usage (from repo root):  node scripts/e2e-seed-user.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../mock-api/.env');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = env.SUPABASE_ANON_KEY; // may be undefined; service client used for admin

const EMAIL = process.env.E2E_EMAIL || 'e2e@buzzly.test';
const PASSWORD = process.env.E2E_PASSWORD || 'E2eWalk!2026';
const TARGET_TEAM = process.env.E2E_TEAM_ID || '7c3976f5-bbf4-42b8-bd41-69a9e7f74c92'; // "TEST" ws, 280 insights

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function getOrCreateUser() {
  // 1) try admin createUser (auto-confirmed)
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (!error && data?.user) {
    console.log('[user] created via admin.createUser:', data.user.id);
    return data.user.id;
  }
  console.log('[user] admin.createUser ->', error?.message || 'no user');

  // 2) fallback: sign in (user may already exist with this password)
  const anon = createClient(SUPABASE_URL, ANON_KEY || SERVICE_KEY, { auth: { persistSession: false } });
  const signIn = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (!signIn.error && signIn.data?.user) {
    console.log('[user] already exists, signed in:', signIn.data.user.id);
    return signIn.data.user.id;
  }
  console.log('[user] signInWithPassword ->', signIn.error?.message);

  // 3) fallback: public signUp (works if email confirmation disabled)
  const signUp = await anon.auth.signUp({ email: EMAIL, password: PASSWORD });
  if (!signUp.error && signUp.data?.user) {
    const confirmed = !!signUp.data.user.confirmed_at || !!signUp.data.session;
    console.log('[user] signUp created:', signUp.data.user.id, 'confirmed:', confirmed);
    if (!confirmed) console.log('[WARN] email confirmation required — user cannot log in until confirmed.');
    return signUp.data.user.id;
  }
  throw new Error('Could not create or resolve e2e user: ' + (signUp.error?.message || 'unknown'));
}

async function ensureMembership(userId) {
  // does TEST workspace exist?
  const { data: ws, error: wErr } = await admin.from('workspaces').select('id,name').eq('id', TARGET_TEAM).maybeSingle();
  if (wErr) throw wErr;
  if (!ws) throw new Error('target workspace not found: ' + TARGET_TEAM);
  console.log('[ws] target:', ws.id, `"${ws.name}"`);

  // already a member?
  const { data: existing } = await admin.from('workspace_members')
    .select('id,status,role').eq('team_id', TARGET_TEAM).eq('user_id', userId).maybeSingle();
  if (existing) {
    if (existing.status !== 'active') {
      await admin.from('workspace_members').update({ status: 'active' }).eq('id', existing.id);
      console.log('[member] reactivated existing membership');
    } else {
      console.log('[member] already active member, role:', existing.role);
    }
    return;
  }
  const { error: mErr } = await admin.from('workspace_members')
    .insert({ team_id: TARGET_TEAM, user_id: userId, role: 'admin', status: 'active' });
  if (mErr) throw mErr;
  console.log('[member] added as active member of TEST workspace');
}

const userId = await getOrCreateUser();
await ensureMembership(userId);
console.log('\n✅ E2E user ready:');
console.log('   email:', EMAIL);
console.log('   password:', PASSWORD);
console.log('   workspace:', TARGET_TEAM, '(TEST, has ad data)');
