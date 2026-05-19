"""add example_items table

Revision ID: 003
Revises: 002
Create Date: 2026-05-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "example_items",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("skill", sa.String(50), nullable=False),
        sa.Column("cefr_level", sa.String(5), nullable=False),
        sa.Column("question_type", sa.String(50)),
        sa.Column("topic", sa.String(200)),
        sa.Column("passage", sa.Text),
        sa.Column("stem", sa.Text, nullable=False),
        sa.Column("options", JSONB),
        sa.Column("correct_answer", sa.Text),
        sa.Column("notes", sa.Text),
        sa.Column("source", sa.String(200)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_example_items_lookup", "example_items", ["skill", "cefr_level", "question_type"])


def downgrade():
    op.drop_index("ix_example_items_lookup", table_name="example_items")
    op.drop_table("example_items")
