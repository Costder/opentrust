ALTER TABLE passports
  ADD COLUMN IF NOT EXISTS protocol_document JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE passports
SET protocol_document = jsonb_strip_nulls(
  jsonb_build_object(
    'spec_version', spec_version,
    'tool_identity', tool_identity,
    'creator_identity', creator_identity,
    'trust_status', trust_status,
    'version_hash', version_hash,
    'capabilities', capabilities,
    'permission_manifest', permission_manifest,
    'source_formats', source_formats,
    'risk_summary', risk_summary,
    'review_history', review_history,
    'commercial_status', commercial_status,
    'agent_access', agent_access
  )
)
WHERE protocol_document = '{}'::jsonb;
