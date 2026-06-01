from enum import Enum
from pydantic import BaseModel, Field


AUTO_DRAFT_WARNING = (
    "This passport was generated automatically and has not been verified by the creator, "
    "community reviewers, security reviewers, or the platform. It may contain errors or omissions. "
    "Do not rely on it for security, financial, legal, or production decisions. Request verification "
    "or perform your own review before installing, funding, purchasing, or granting permissions."
)


class SeverityCounts(BaseModel):
    critical: int = Field(default=0, ge=0)
    high: int = Field(default=0, ge=0)
    medium: int = Field(default=0, ge=0)
    low: int = Field(default=0, ge=0)
    info: int = Field(default=0, ge=0)


class ScannerOutput(BaseModel):
    source: str
    scanner_version: str | None = None
    run_at: str
    severity_counts: SeverityCounts
    report_url: str | None = None
    notes: str | None = None


class ReviewerIdentity(BaseModel):
    name: str = Field(min_length=1)
    github: str | None = None
    key_id: str | None = None
    reviewed_at: str
    scope: str | None = None


class SignedAttestation(BaseModel):
    key_id: str
    algorithm: str
    signature: str
    payload_hash: str


class SecurityEvidenceBlock(BaseModel):
    scanner_output: ScannerOutput
    reviewer_identity: ReviewerIdentity
    commit_hash: str = Field(min_length=7)
    dependency_snapshot: dict[str, str] = Field(min_length=1)
    signed_attestation: SignedAttestation


class TrustStatus(str, Enum):
    auto_generated_draft = "auto_generated_draft"
    creator_claimed = "creator_claimed"
    seller_confirmed = "seller_confirmed"
    community_reviewed = "community_reviewed"
    reviewer_signed = "reviewer_signed"
    security_checked = "security_checked"
    continuously_monitored = "continuously_monitored"
    disputed = "disputed"


class PassportBase(BaseModel):
    tool_identity: dict
    creator_identity: dict | None = None
    trust_status: TrustStatus = TrustStatus.auto_generated_draft
    version_hash: dict
    capabilities: list[str] = Field(min_length=1)
    permission_manifest: dict
    evidence: SecurityEvidenceBlock | None = None
    risk_summary: dict | None = None
    review_history: list[dict] = []
    commercial_status: dict
    billing_plan: dict | None = None
    fee_schedule: dict | None = None
    agent_access: dict
    description: str = ""


class PassportCreate(PassportBase):
    pass


class PassportRead(PassportBase):
    id: str
    slug: str
    name: str
    warning: str | None = None
    is_demo: bool = False

    @classmethod
    def from_model(cls, model):
        warning = AUTO_DRAFT_WARNING if model.trust_status == TrustStatus.auto_generated_draft.value else None
        return cls(
            id=model.id,
            slug=model.slug,
            name=model.name,
            description=model.description,
            tool_identity=model.tool_identity,
            creator_identity=model.creator_identity,
            trust_status=model.trust_status,
            version_hash=model.version_hash,
            capabilities=model.capabilities,
            permission_manifest=model.permission_manifest,
            evidence=getattr(model, "evidence", None),
            risk_summary=model.risk_summary,
            review_history=model.review_history,
            commercial_status=model.commercial_status,
            billing_plan=model.billing_plan,
            fee_schedule=model.fee_schedule,
            agent_access=model.agent_access,
            warning=warning,
            is_demo=bool(getattr(model, "is_demo", 0)),
        )
