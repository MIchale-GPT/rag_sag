"""近期动态 —— 知识库时间线：最近文档（会话不属于知识库动态）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sag_api.core.db import get_session
from sag_api.core.deps import get_current_user
from sag_api.db.models import Document, Source, User

router = APIRouter(prefix="/activity", tags=["activity"])


@router.get("")
async def list_activity(
    limit: int = Query(default=20, ge=1, le=50),
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    docs = (
        await session.execute(
            select(Document, Source.name)
            .join(Source, Source.id == Document.source_id)
            .order_by(Document.created_at.desc())
            .limit(limit)
        )
    ).all()
    items: list[dict] = [
        {
            "type": "document",
            "id": d.id,
            "source_id": d.source_id,
            "title": d.filename,
            "subtitle": source_name,
            "status": d.status.value,
            "at": d.created_at.isoformat(),
        }
        for d, source_name in docs
    ]
    items.sort(key=lambda x: x["at"], reverse=True)
    return items[:limit]
