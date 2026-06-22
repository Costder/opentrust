-- Migration 004: Discovery & Marketing tables
-- Adds: tool_embeddings, tags, listing_tags, listing_events,
--        featured_listings, listing_reviews, collections, collection_items
-- Run after: 003_add_marketplace_tables.sql (or whatever the prior migration is)

-- ---------------------------------------------------------------------------
-- 1. Semantic search foundation
-- ---------------------------------------------------------------------------

-- Vector embeddings per listing (pgvector extension required for v2 search)
-- For v1: this table is created but unused — search uses ILIKE
CREATE TABLE IF NOT EXISTS tool_embeddings (
  listing_id UUID PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  embedding   vector(1536),         -- OpenAI text-embedding-3-small dimensions
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Flat tag vocabulary
CREATE TABLE IF NOT EXISTS tags (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,        -- kebab-case  e.g. "file-system"
  name TEXT NOT NULL                -- Display label  e.g. "File System"
);

-- Many-to-many listing ↔ tag
CREATE TABLE IF NOT EXISTS listing_tags (
  listing_id UUID REFERENCES listings(id) ON DELETE CASCADE,
  tag_id     UUID REFERENCES tags(id)     ON DELETE CASCADE,
  PRIMARY KEY (listing_id, tag_id)
);

-- Seed tag vocabulary
INSERT INTO tags (slug, name) VALUES
  ('file-system',   'File System'),
  ('web-browser',   'Web Browser'),
  ('email',         'Email'),
  ('payments',      'Payments'),
  ('calendar',      'Calendar'),
  ('database',      'Database'),
  ('code-exec',     'Code Execution'),
  ('image-gen',     'Image Generation'),
  ('communication', 'Communication'),
  ('data-extract',  'Data Extraction'),
  ('identity',      'Identity'),
  ('notifications', 'Notifications'),
  ('storage',       'Storage'),
  ('search',        'Search'),
  ('ai-models',     'AI Models')
ON CONFLICT (slug) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 2. Seller analytics events
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS listing_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,  -- 'view' | 'install' | 'badge_click' | 'embed_click'
  actor_id   UUID,           -- nullable; agent or user who triggered event
  metadata   JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listing_events_listing_id_idx
  ON listing_events(listing_id, created_at DESC);

CREATE INDEX IF NOT EXISTS listing_events_type_idx
  ON listing_events(event_type, created_at DESC);


-- ---------------------------------------------------------------------------
-- 3. Featured listings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS featured_listings (
  listing_id  UUID PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  starts_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at     TIMESTAMPTZ,           -- NULL = permanent (admin-curated)
  placement   TEXT NOT NULL DEFAULT 'marketplace_top',
              -- allowed values: 'marketplace_top' | 'search_top' | 'homepage'
  created_by  UUID                   -- admin user id
);

CREATE INDEX IF NOT EXISTS featured_listings_active_idx
  ON featured_listings(placement, starts_at, ends_at)
  WHERE ends_at IS NULL OR ends_at > now();


-- ---------------------------------------------------------------------------
-- 4. Reviews + social proof counters
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS listing_reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL,          -- agent or user who used the tool
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        TEXT,                   -- optional up to 1000 chars
  verified    BOOLEAN DEFAULT false,  -- true if reviewer verifiably installed
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (listing_id, reviewer_id)    -- one review per reviewer per listing
);

CREATE INDEX IF NOT EXISTS listing_reviews_listing_id_idx
  ON listing_reviews(listing_id, created_at DESC);

-- Add denormalized counters to listings table (updated by trigger or background job)
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS used_by_count INT          DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_rating    NUMERIC(3,2);


-- ---------------------------------------------------------------------------
-- 5. Curated collections
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS collections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT UNIQUE NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  cover_emoji TEXT DEFAULT '📦',
  is_public   BOOLEAN DEFAULT true,
  created_by  UUID,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
  listing_id    UUID REFERENCES listings(id)    ON DELETE CASCADE,
  rank          INT DEFAULT 0,
  PRIMARY KEY (collection_id, listing_id)
);

-- Seed starter collections
INSERT INTO collections (slug, title, description, cover_emoji) VALUES
  ('top-payment-tools', 'Top Payment Tools',   'USDC, Stripe, and crypto payment MCPs',   '💳'),
  ('free-open-source',  'Free & Open Source',  'Community-built tools at no cost',         ' '),
  ('l4-verified',       'L4 Verified Only',    'The highest trust tier on OpenTrust',      '⌅'),
  ('getting-started',   'Getting Started Pack','Best tools for new agent builders',        '🚀')
ON CONFLICT (slug) DO NOTHING;
