"""fix correct_answer column type

Revision ID: 002
Revises: 001
Create Date: 2026-05-19
"""
import sqlalchemy as sa
from alembic import op

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        "question_items",
        "correct_answer",
        existing_type=sa.String(1),
        type_=sa.Text(),
        existing_nullable=True,
    )


def downgrade():
    op.alter_column(
        "question_items",
        "correct_answer",
        existing_type=sa.Text(),
        type_=sa.String(1),
        existing_nullable=True,
    )
