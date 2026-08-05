-- Faithful-enough replica of the live tables promote_batch() writes.
-- Column types, NOT NULLs, defaults, FKs and unique keys are copied from the
-- cloud schema (read via the PostgREST OpenAPI spec) and from the migrations
-- that created them; everything the RPC does not touch is omitted.

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;

CREATE TABLE public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL
);

CREATE TABLE public.platforms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100)
);

CREATE TABLE public.ad_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  platform_id UUID REFERENCES public.platforms(id),
  account_name VARCHAR(255) NOT NULL,
  platform_account_id VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT ad_accounts_team_platform_key UNIQUE (team_id, platform_id)
);

CREATE TABLE public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id UUID REFERENCES public.ad_accounts(id),
  team_id UUID REFERENCES public.workspaces(id),
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50),
  objective VARCHAR(100),
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.ad_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES public.workspaces(id),
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50),
  external_group_id TEXT,
  source_platform TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_group_id UUID REFERENCES public.ad_groups(id),
  team_id UUID REFERENCES public.workspaces(id),
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50),
  platform_ad_id VARCHAR(255),
  platform TEXT,
  external_status TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.campaign_ads (
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  ad_id UUID NOT NULL REFERENCES public.ads(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, ad_id)
);

CREATE TABLE public.ad_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id UUID REFERENCES public.ad_accounts(id),
  campaign_id UUID REFERENCES public.campaigns(id),
  ads_id UUID REFERENCES public.ads(id),
  date DATE NOT NULL,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  spend NUMERIC(15,2) DEFAULT 0,
  roas NUMERIC(15,2),
  conversions INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  ctr NUMERIC(8,4),
  cpc NUMERIC(15,2),
  cpm NUMERIC(15,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- The idempotency key added by 20260723120000.
CREATE UNIQUE INDEX ad_insights_account_ad_date_key
  ON public.ad_insights (ad_account_id, ads_id, date) NULLS NOT DISTINCT;

CREATE TABLE public.sync_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id UUID NOT NULL REFERENCES public.platforms(id),
  team_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL CHECK (sync_type IN ('manual','scheduled','webhook')) DEFAULT 'manual',
  status TEXT NOT NULL CHECK (status IN ('success','failed','in_progress')) DEFAULT 'in_progress',
  rows_synced INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_ok INTEGER NOT NULL DEFAULT 0,
  rows_quarantined INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
