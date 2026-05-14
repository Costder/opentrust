from datetime import datetime
from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import JSON


class Base(DeclarativeBase):
    pass


def json_type():
    return JSON().with_variant(JSONB, "postgresql")


class Passport(Base):
    __tablename__ = "passports"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    slug: Mapped[str] = mapped_column(String, unique=True, index=True)
    name: Mapped[str] = mapped_column(String, index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    trust_status: Mapped[str] = mapped_column(String, index=True, default="auto_generated_draft")
    tool_identity: Mapped[dict] = mapped_column(json_type())
    creator_identity: Mapped[dict | None] = mapped_column(json_type(), nullable=True)
    version_hash: Mapped[dict] = mapped_column(json_type())
    capabilities: Mapped[list[str]] = mapped_column(json_type())
    permission_manifest: Mapped[dict] = mapped_column(json_type())
    risk_summary: Mapped[dict | None] = mapped_column(json_type(), nullable=True)
    review_history: Mapped[list[dict]] = mapped_column(json_type(), default=list)
    commercial_status: Mapped[dict] = mapped_column(json_type())
    billing_plan: Mapped[dict | None] = mapped_column(json_type(), nullable=True)
    fee_schedule: Mapped[dict | None] = mapped_column(json_type(), nullable=True)
    agent_access: Mapped[dict] = mapped_column(json_type())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
