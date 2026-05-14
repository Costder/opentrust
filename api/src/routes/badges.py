from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from api.src.database import get_session
from api.src.models.passport import Passport
from api.src.services.badge_service import trust_badge_svg

router = APIRouter(prefix="/badge", tags=["badges"])


@router.get("/{slug}.svg")
async def badge(slug: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(Passport).where(Passport.slug == slug))
    passport = result.scalar_one_or_none()
    if passport is None:
        raise HTTPException(status_code=404, detail="Passport not found")
    return Response(content=trust_badge_svg(passport.trust_status), media_type="image/svg+xml")
