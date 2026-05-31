"""Reputation: registry-computed, append-only trust earned from settled escrow
outcomes plus bidirectional counterparty ratings.

A reputation record is never set by the party it describes. Outcome counters are
incremented only by the registry as a side effect of escrow terminal transitions
it observed (release / refund / dispute), each of which traces to an on-chain
funding and settlement. Ratings are submitted by the *counterparty* after a deal
settles. Derived signals (avg_rating, dispute_rate, trust_score, tier) are pure
functions of the stored counters, so they are deterministic and fully testable.
"""
from decimal import Decimal
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, computed_field


class SubjectKind(str, Enum):
    client = "client"  # human paying for agent work
    server = "server"  # MCP server / tool / skill maker
    agent = "agent"    # the AI worker acting under a passport


class ReputationRecord(BaseModel):
    subject_id: str
    subject_kind: SubjectKind
    deals_total: int = 0
    deals_released: int = 0
    deals_refunded: int = 0
    deals_disputed: int = 0
    settled_volume_usdc: Decimal = Decimal("0")
    rating_sum: int = 0
    rating_count: int = 0
    updated_at: str | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def avg_rating(self) -> float | None:
        if self.rating_count == 0:
            return None
        return self.rating_sum / self.rating_count

    @computed_field  # type: ignore[prop-decorator]
    @property
    def dispute_rate(self) -> float:
        if self.deals_total == 0:
            return 0.0
        return self.deals_disputed / self.deals_total

    @computed_field  # type: ignore[prop-decorator]
    @property
    def trust_score(self) -> int:
        if self.deals_total == 0:
            base = 0.0
        else:
            base = 100.0 * self.deals_released / self.deals_total
        penalty = 40.0 * self.dispute_rate
        if self.deals_total:
            penalty += 20.0 * (self.deals_refunded / self.deals_total)
        rating_adj = 0.0
        if self.avg_rating is not None:
            rating_adj = (self.avg_rating - 3.0) * 10.0
        score = round(base - penalty + rating_adj)
        return max(0, min(100, int(score)))

    @computed_field  # type: ignore[prop-decorator]
    @property
    def tier(self) -> str:
        score = self.trust_score
        if score >= 80 and self.deals_released >= 5:
            return "gold"
        if score >= 60 and self.deals_released >= 2:
            return "silver"
        if self.deals_released >= 1:
            return "bronze"
        return "new"


class CounterpartyRating(BaseModel):
    rating_id: str
    escrow_id: str
    rater_role: str       # "buyer" | "seller"
    rater_id: str         # the rater's identity key
    subject_id: str       # who is being rated
    subject_kind: SubjectKind
    score: int
    comment: str | None = None
    created_at: str


class CounterpartyRatingRequest(BaseModel):
    rater_role: Literal["buyer", "seller"]
    score: int = Field(ge=1, le=5)
    comment: str | None = None
