"""papers, sessions, and item metadata

Revision ID: 004
Revises: 003
Create Date: 2026-05-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade():
    # --- papers --------------------------------------------------------------
    op.create_table(
        "papers",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("time_limit_min", sa.Integer),
        sa.Column("total_score", sa.Float),
        sa.Column("status", sa.String(20), server_default="pending"),
        sa.Column("blueprint_request", JSONB),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )

    op.create_table(
        "paper_sections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("paper_id", UUID(as_uuid=True), sa.ForeignKey("papers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("skill", sa.String(50)),
        sa.Column("cefr", sa.String(5)),
        sa.Column("topic", sa.String(200)),
        sa.Column("passage_length", sa.String(50)),
        sa.Column("question_types", JSONB),
        sa.Column("item_count", sa.Integer),
        sa.Column("section_score", sa.Float),
        sa.Column("section_time_min", sa.Integer),
        sa.Column("difficulty_mix", JSONB),
        sa.Column("passage_id", UUID(as_uuid=True), sa.ForeignKey("passages.id"), nullable=True),
        sa.Column("job_id", UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(20), server_default="pending"),
        sa.Column("error_message", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_paper_sections_paper", "paper_sections", ["paper_id"])

    # --- test sessions -------------------------------------------------------
    op.create_table(
        "test_sessions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("paper_id", UUID(as_uuid=True), sa.ForeignKey("papers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("candidate_name", sa.String(200)),
        sa.Column("status", sa.String(20), server_default="in_progress"),
        sa.Column("responses", JSONB, server_default=sa.text("'{}'::jsonb")),
        sa.Column("item_order", JSONB),
        sa.Column("total_score", sa.Float),
        sa.Column("max_score", sa.Float),
        sa.Column("overall_cefr", sa.String(10)),
        sa.Column("skill_cefr", JSONB),
        sa.Column("verdict", sa.Text),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.Column("scored_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_test_sessions_paper", "test_sessions", ["paper_id"])

    op.create_table(
        "session_grades",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("session_id", UUID(as_uuid=True), sa.ForeignKey("test_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("item_id", UUID(as_uuid=True), sa.ForeignKey("question_items.id"), nullable=False),
        sa.Column("response", sa.Text),
        sa.Column("is_correct", sa.Boolean),
        sa.Column("score_earned", sa.Float),
        sa.Column("score_max", sa.Float),
        sa.Column("judge_detail", JSONB),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_session_grades_session", "session_grades", ["session_id"])

    # --- question_items metadata columns -------------------------------------
    op.add_column("question_items", sa.Column("difficulty_band", sa.String(10)))
    op.add_column("question_items", sa.Column("score_weight", sa.Float, server_default="1.0"))
    op.add_column("question_items", sa.Column("objective", sa.Text))
    op.add_column("question_items", sa.Column("explanation", sa.Text))
    op.add_column("question_items", sa.Column("tags", JSONB))
    op.add_column("question_items", sa.Column("paper_id", UUID(as_uuid=True), sa.ForeignKey("papers.id", ondelete="SET NULL"), nullable=True))
    op.add_column("question_items", sa.Column("section_name", sa.String(100)))
    op.create_index("ix_question_items_paper_section", "question_items", ["paper_id", "section_name"])


def downgrade():
    op.drop_index("ix_question_items_paper_section", table_name="question_items")
    for col in ("section_name", "paper_id", "tags", "explanation", "objective", "score_weight", "difficulty_band"):
        op.drop_column("question_items", col)

    op.drop_index("ix_session_grades_session", table_name="session_grades")
    op.drop_table("session_grades")
    op.drop_index("ix_test_sessions_paper", table_name="test_sessions")
    op.drop_table("test_sessions")

    op.drop_index("ix_paper_sections_paper", table_name="paper_sections")
    op.drop_table("paper_sections")
    op.drop_table("papers")
