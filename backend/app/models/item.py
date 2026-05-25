import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Passage(Base):
    __tablename__ = "passages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    word_count: Mapped[int | None] = mapped_column(Integer)
    cefr_level: Mapped[str | None] = mapped_column(String(5))
    topic: Mapped[str | None] = mapped_column(Text)
    skill: Mapped[str | None] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    questions: Mapped[list["QuestionItem"]] = relationship("QuestionItem", back_populates="passage")


class QuestionItem(Base):
    __tablename__ = "question_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    passage_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("passages.id"), nullable=True)
    stem: Mapped[str] = mapped_column(Text, nullable=False)
    question_type: Mapped[str | None] = mapped_column(String(50))
    correct_answer: Mapped[str | None] = mapped_column(Text)
    options: Mapped[dict | None] = mapped_column(JSONB)
    cefr_level: Mapped[str | None] = mapped_column(String(5))
    difficulty: Mapped[float | None] = mapped_column(Float)
    judge_score: Mapped[float | None] = mapped_column(Float)
    judge_detail: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(30), default="draft")
    revision_count: Mapped[int] = mapped_column(Integer, default=0)
    difficulty_band: Mapped[str | None] = mapped_column(String(10))
    score_weight: Mapped[float | None] = mapped_column(Float, default=1.0)
    objective: Mapped[str | None] = mapped_column(Text)
    explanation: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list | None] = mapped_column(JSONB)
    paper_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("papers.id", ondelete="SET NULL"), nullable=True)
    section_name: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    passage: Mapped["Passage | None"] = relationship("Passage", back_populates="questions")
