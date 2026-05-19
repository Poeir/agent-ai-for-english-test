import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ExampleItem(Base):
    """Curated reference questions used as few-shot examples for the generator."""

    __tablename__ = "example_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    skill: Mapped[str] = mapped_column(String(50), nullable=False)
    cefr_level: Mapped[str] = mapped_column(String(5), nullable=False)
    question_type: Mapped[str | None] = mapped_column(String(50))
    topic: Mapped[str | None] = mapped_column(String(200))
    passage: Mapped[str | None] = mapped_column(Text)
    stem: Mapped[str] = mapped_column(Text, nullable=False)
    options: Mapped[dict | None] = mapped_column(JSONB)
    correct_answer: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
