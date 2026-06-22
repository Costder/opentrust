"""Work venue (job board) schemas.

A client posts work wanted (`JobPosting`); a provider engages it, which mints an
escrow on the existing rail. The job tracks the engagement and completes when the
escrow settles. This is the venue half of the two-way-trust loop: both parties
see the other's reputation before committing.
"""
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, Field

from .marketplace import DeliveryProofRequirement, EscrowRecord, ProviderKind


class JobStatus(str, Enum):
    open = "open"
    engaged = "engaged"
    completed = "completed"
    cancelled = "cancelled"


class JobPostingRequest(BaseModel):
    client_wallet_id: str
    title: str = Field(min_length=1)
    description: str = ""
    budget_usdc: Decimal = Field(gt=0)
    provider_kind: ProviderKind = ProviderKind.tool
    client_passport_id: str | None = None
    delivery_proof: DeliveryProofRequirement
    min_provider_trust_score: int | None = Field(default=None, ge=0, le=100)


class JobPosting(BaseModel):
    job_id: str
    client_wallet_id: str
    title: str
    description: str = ""
    budget_usdc: Decimal
    provider_kind: ProviderKind
    client_passport_id: str | None = None
    delivery_proof: DeliveryProofRequirement
    min_provider_trust_score: int | None = None
    status: JobStatus = JobStatus.open
    engaged_provider_wallet_id: str | None = None
    engaged_provider_passport_id: str | None = None
    escrow_id: str | None = None
    created_at: str
    listing_fee_usdc: Decimal = Decimal("0.00")


class JobEngageRequest(BaseModel):
    provider_wallet_id: str
    provider_passport_id: str | None = None
    provider_trust_level: int | None = Field(default=None, ge=1, le=7)
    provider_trust_status: str | None = None
    agent_passport_id: str | None = None


class JobEngagement(BaseModel):
    job: JobPosting
    escrow: EscrowRecord
