"""expand passages.topic to 255 chars

Revision ID: 005
Revises: 004
Create Date: 2026-05-20
"""
from alembic import op
import sqlalchemy as sa


revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        "passages",
        "topic",
        existing_type=sa.String(100),
        type_=sa.String(255),
        existing_nullable=True,
    )


def downgrade():
    op.alter_column(
        "passages",
        "topic",
        existing_type=sa.String(255),
        type_=sa.String(100),
        existing_nullable=True,
    )
