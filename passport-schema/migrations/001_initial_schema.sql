CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$ BEGIN
  CREATE TYPE trust_status AS ENUM (
    'auto_generated_draft',
    'creator_claimed',
    'seller_confirmed',
    'community_reviewed',
    'reviewer_signed',
    'security_checked',
    'continuously_monitored',
    'disputed'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  github_id TEXT UNIQUE,
  username TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS passports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  trust_status trust_status NOT NULL DEFAULT 'auto_generated_draft',
  tool_identity JSONB NOT NULL,
  creator_identity JSONB,
  version_hash JSONB NOT NULL,
  capabilities JSONB NOT NULL,
  permission_manifest JSONB NOT NULL,
  risk_summary JSONB,
  review_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  commercial_status JSONB NOT NULL,
  billing_plan JSONB,
  fee_schedule JSONB,
  agent_access JSONB NOT NULL,
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(capabilities::text, ''))
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_passports_search ON passports USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_passports_trust_status ON passports(trust_status);

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  passport_id UUID NOT NULL REFERENCES passports(id) ON DELETE CASCADE,
  reviewer TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT,
  signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tool_id UUID REFERENCES passports(id) ON DELETE CASCADE,
  plan JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'stub',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
