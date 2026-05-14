from .github_verifier import normalize_slug
from api.src.schemas.passport import AUTO_DRAFT_WARNING


def draft_passport_from_metadata(name: str, source_url: str, description: str = "") -> dict:
    slug = normalize_slug(name)
    return {
        "tool_identity": {"name": name, "slug": slug, "type": "unknown", "category": "unknown", "source_url": source_url},
        "trust_status": "auto_generated_draft",
        "version_hash": {"version": "unknown"},
        "capabilities": [description or "unknown"],
        "permission_manifest": {},
        "risk_summary": {"ai_generated_notes": description, "warning": AUTO_DRAFT_WARNING},
        "commercial_status": {"status": "free", "fee_schedule": {"kind": "free"}},
        "billing_plan": None,
        "fee_schedule": {"kind": "free"},
        "agent_access": {"api_url": f"/api/v1/tools/{slug}", "mcp_readable": True},
    }
