import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Paper(Base):
    __tablename__ = "papers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    time_limit_min: Mapped[int | None] = mapped_column(Integer)
    total_score: Mapped[float | None] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|running|completed|partial|failed
    blueprint_request: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    sections: Mapped[list["PaperSection"]] = relationship(
        "PaperSection", back_populates="paper", cascade="all, delete-orphan", order_by="PaperSection.created_at"
    )


class PaperSection(Base):
    __tablename__ = "paper_sections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    paper_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("papers.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    skill: Mapped[str | None] = mapped_column(String(50))
    cefr: Mapped[str | None] = mapped_column(String(5))
    topic: Mapped[str | None] = mapped_column(String(200))
    passage_length: Mapped[str | None] = mapped_column(String(50))
    question_types: Mapped[list | None] = mapped_column(JSONB)
    item_count: Mapped[int | None] = mapped_column(Integer)
    section_score: Mapped[float | None] = mapped_column(Float)
    section_time_min: Mapped[int | None] = mapped_column(Integer)
    difficulty_mix: Mapped[dict | None] = mapped_column(JSONB)
    passage_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("passages.id"), nullable=True)
    job_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|running|completed|failed
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    paper: Mapped["Paper"] = relationship("Paper", back_populates="sections")
