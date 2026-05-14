from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column
from .passport import Base, json_type


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    tool_id: Mapped[str] = mapped_column(String, ForeignKey("passports.id"))
    plan: Mapped[dict] = mapped_column(json_type())
    status: Mapped[str] = mapped_column(String, default="stub")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
