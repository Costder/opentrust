from .github_verifier import normalize_slug
from api.src.schemas.passport import AUTO_DRAFT_WARNING


def draft_passport_from_metadata(name: str, source_url: str, description: str = "") -> dict:
    slug = normalize_slug(name)
    return {
        "spec_version": "0.1.0",
        "tool_identity": {"name": name, "slug": slug, "type": "unknown", "category": "custom", "source_url": source_url},
        "trust_status": "auto_generated_draft",
        "version_hash": {"version": "unknown"},
        "capabilities": [description or "unknown"],
        "permission_manifest": {},
        "source_formats": ["custom"],
        "risk_summary": {"ai_generated_notes": description, "warning": AUTO_DRAFT_WARNING},
        "commercial_status": {"status": "free"},
        "agent_access": {"api_url": f"/api/v1/tools/{slug}", "mcp_readable": True},
    }
