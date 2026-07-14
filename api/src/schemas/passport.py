from copy import deepcopy
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, RootModel


AUTO_DRAFT_WARNING = (
    "This passport was generated automatically and has not been verified by the creator, "
    "community reviewers, security reviewers, or the platform. It may contain errors or omissions. "
    "Do not rely on it for security, financial, legal, or production decisions. Request verification "
    "or perform your own review before installing, funding, purchasing, or granting permissions."
)


class TrustStatus(str, Enum):
    auto_generated_draft = "auto_generated_draft"
    creator_claimed = "creator_claimed"
    owner_confirmed = "owner_confirmed"
    community_reviewed = "community_reviewed"
    reviewer_signed = "reviewer_signed"
    security_checked = "security_checked"
    continuously_monitored = "continuously_monitored"
    disputed = "disputed"


class PassportDocument(RootModel[dict[str, Any]]):
    """Transport-only model; protocol rules are owned by manifest-validator."""

    def protocol_document(self) -> dict[str, Any]:
        return deepcopy(self.root)


class PassportCreate(PassportDocument):
    pass


class PassportUpdate(PassportDocument):
    pass


class PassportRead(BaseModel):
    """A stored protocol document plus registry-owned response metadata."""

    model_config = ConfigDict(extra="allow")

    id: str
    slug: str
    name: str
    warning: str | None = None

    @classmethod
    def from_model(cls, model):
        document = deepcopy(model.protocol_document)
        document.update(
            {
                "id": model.id,
                "slug": model.slug,
                "name": model.name,
                "description": model.description,
                "billing_plan": model.billing_plan,
                "fee_schedule": model.fee_schedule,
                "warning": (
                    AUTO_DRAFT_WARNING
                    if document.get("trust_status") == TrustStatus.auto_generated_draft.value
                    else None
                ),
            }
        )
        return cls.model_validate(document)
