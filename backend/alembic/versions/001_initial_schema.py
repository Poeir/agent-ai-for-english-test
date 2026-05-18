"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-05-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"")

    op.create_table(
        "passages",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("word_count", sa.Integer),
        sa.Column("cefr_level", sa.String(5)),
        sa.Column("topic", sa.String(100)),
        sa.Column("skill", sa.String(50)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "question_items",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("passage_id", UUID(as_uuid=True), sa.ForeignKey("passages.id"), nullable=True),
        sa.Column("stem", sa.Text, nullable=False),
        sa.Column("question_type", sa.String(50)),
        sa.Column("correct_answer", sa.String(1)),
        sa.Column("options", JSONB),
        sa.Column("cefr_level", sa.String(5)),
        sa.Column("difficulty", sa.Float),
        sa.Column("judge_score", sa.Float),
        sa.Column("judge_detail", JSONB),
        sa.Column("status", sa.String(30), server_default="draft"),
        sa.Column("revision_count", sa.Integer, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "generation_jobs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("status", sa.String(20), server_default="pending"),
        sa.Column("request", JSONB),
        sa.Column("result", JSONB),
        sa.Column("current_node", sa.String(50)),
        sa.Column("error_message", sa.Text),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table("generation_jobs")
    op.drop_table("question_items")
    op.drop_table("passages")
