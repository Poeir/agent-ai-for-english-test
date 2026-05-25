"""expand generated content topic fields

Revision ID: 006
Revises: 005
Create Date: 2026-05-21
"""
from alembic import op
import sqlalchemy as sa


revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        "paper_sections",
        "topic",
        existing_type=sa.String(200),
        type_=sa.Text(),
        existing_nullable=True,
    )
    op.alter_column(
        "passages",
        "topic",
        existing_type=sa.String(255),
        type_=sa.Text(),
        existing_nullable=True,
    )


def downgrade():
    op.alter_column(
        "passages",
        "topic",
        existing_type=sa.Text(),
        type_=sa.String(255),
        existing_nullable=True,
    )
    op.alter_column(
        "paper_sections",
        "topic",
        existing_type=sa.Text(),
        type_=sa.String(200),
        existing_nullable=True,
    )
