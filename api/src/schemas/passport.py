from enum import Enum
from pydantic import BaseModel, Field


AUTO_DRAFT_WARNING = (
    "This passport was generated automatically and has not been verified by the creator, "
    "community reviewers, security reviewers, or the platform. It may contain errors or omissions. "
    "Do not rely on it for security, financial, legal, or production decisions. Request verification "
    "or perform your own review before installing, funding, purchasing, or granting permissions."
)


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
            risk_summary=model.risk_summary,
            review_history=model.review_history,
            commercial_status=model.commercial_status,
            billing_plan=model.billing_plan,
            fee_schedule=model.fee_schedule,
            agent_access=model.agent_access,
            warning=warning,
        )
