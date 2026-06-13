from dataclasses import dataclass


@dataclass
class VerifyResult:
    slug: str
    trust_status: str       # e.g. "community_reviewed"
    trust_level: int        # 1–7; 0 if trust_status == "disputed"
    is_disputed: bool       # True when trust_status == "disputed"
    recommendation: str     # plain-English guidance
    risk: str               # "low" | "medium" | "high"
    passport: dict          # full raw passport
    permissions: dict       # permission_manifest
    # None  = passport carried no signature block (not verified)
    # True  = signature present and cryptographically valid
    # (an invalid signature raises in verify(); it never reaches a result)
    verified_signature: bool | None = None


@dataclass
class ToolsPage:
    items: list[dict]
    total: int
    page: int
    limit: int
