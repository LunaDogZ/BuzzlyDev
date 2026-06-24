// Creates a self-contained workspace OWNED BY the e2e test user and a mock
// Facebook connection, so reseed.mjs can populate ad data into THIS user's own
// workspace (no dependency on any pre-existing real workspace).
//
// Idempotent. Run from repo root:  node scripts/e2e-seed-workspace.mjs
// Then: (cd mock-api && node scripts/reseed.mjs)  to ingest fixture data.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, '../mock-api/.env'), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const EMAIL = process.env.E2E_EMAIL || 'e2e@buzzly.test';
const PASSWORD = process.env.E2E_PASSWORD || 'E2eWalk!2026';
const WS_NAME = 'E2E Walk Workspace';
const FB_PLATFORM_ID = '40000000-0000-0000-0000-000000000001'; // facebook
const FB_SLUG = 'facebook';
const MOCK_KEY = 'FB_TEST_KEY_SHOP_A';

// 1) resolve e2e user id (created earlier via admin.createUser). Sign in to get id.
const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let userId;
{
  const create = await sb.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
  if (!create.error && create.data?.user) { userId = create.data.user.id; console.log('[user] created:', userId); }
  else {
    const si = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (si.error) throw new Error('cannot resolve e2e user: ' + si.error.message);
    userId = si.data.user.id; console.log('[user] resolved via sign-in:', userId);
  }
}

// 2) workspace owned by e2e user (idempotent on owner_id + name)
let teamId;
{
  const { data: existing } = await sb.from('workspaces').select('id').eq('owner_id', userId).eq('name', WS_NAME).maybeSingle();
  if (existing) { teamId = existing.id; console.log('[ws] exists:', teamId); }
  else {
    const { data, error } = await sb.from('workspaces').insert({ name: WS_NAME, owner_id: userId, description: 'e2e visual-walk' }).select('id').single();
    if (error) throw error;
    teamId = data.id; console.log('[ws] created:', teamId);
  }
}

// 3) owner membership
{
  const { data: m } = await sb.from('workspace_members').select('id,status').eq('team_id', teamId).eq('user_id', userId).maybeSingle();
  if (!m) { await sb.from('workspace_members').insert({ team_id: teamId, user_id: userId, role: 'owner', status: 'active' }); console.log('[member] owner added'); }
  else { console.log('[member] exists'); }
}

// 4) ad_account for facebook (idempotent)
let adAccountId;
{
  const { data: a } = await sb.from('ad_accounts').select('id').eq('team_id', teamId).eq('platform_id', FB_PLATFORM_ID).maybeSingle();
  if (a) { adAccountId = a.id; console.log('[ad_account] exists:', adAccountId); }
  else {
    const { data, error } = await sb.from('ad_accounts').insert({ team_id: teamId, platform_id: FB_PLATFORM_ID, account_name: 'E2E Facebook Account', is_active: true }).select('id').single();
    if (error) throw error;
    adAccountId = data.id; console.log('[ad_account] created:', adAccountId);
  }
}

// 5) workspace_api_keys with the mock key (idempotent on team_id+platform_id)
{
  const { error } = await sb.from('workspace_api_keys').upsert(
    { team_id: teamId, platform_id: FB_PLATFORM_ID, access_token: MOCK_KEY, is_active: true, sync_status: 'connected' },
    { onConflict: 'team_id,platform_id' }
  );
  if (error) throw error;
  console.log('[api_key] upserted mock key', MOCK_KEY);
}

// 6) active Team subscription for the e2e user (PlanContext resolves plan by user_id).
//    Data pages (Campaigns/Analytics/Customer Journey/AARRR) are Pro-gated; Team unlocks all.
const TEAM_PLAN_ID = '5b000003-0000-0000-0000-000000000003'; // slug 'team'
{
  const { data: sub } = await sb.from('subscriptions').select('id').eq('user_id', userId).eq('status', 'active').maybeSingle();
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
  const row = {
    user_id: userId, team_id: teamId, plan_id: TEAM_PLAN_ID, status: 'active',
    billing_cycle: 'monthly', current_period_start: now.toISOString(), current_period_end: periodEnd.toISOString(),
  };
  if (sub) { await sb.from('subscriptions').update(row).eq('id', sub.id); console.log('[sub] updated active subscription -> team'); }
  else { const { error } = await sb.from('subscriptions').insert(row); if (error) throw error; console.log('[sub] created active team subscription'); }
}

console.log('\n✅ Workspace ready for ingestion:');
console.log('   team_id    :', teamId);
console.log('   adAccountId:', adAccountId);
console.log('   platform   :', FB_SLUG, '/', MOCK_KEY);
console.log('\nNext: (cd mock-api && node scripts/reseed.mjs)  then verify with scripts/verify.mjs', teamId);
