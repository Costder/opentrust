-- Align pre-existing registries with the canonical protocol spelling.
ALTER TYPE trust_status ADD VALUE IF NOT EXISTS 'owner_confirmed';

UPDATE passports
SET trust_status = 'owner_confirmed'
WHERE trust_status::text = 'seller_confirmed';

ALTER TABLE passports
  ADD COLUMN IF NOT EXISTS spec_version TEXT NOT NULL DEFAULT '0.1.0',
  ADD COLUMN IF NOT EXISTS source_formats JSONB NOT NULL DEFAULT '["custom"]'::jsonb;
