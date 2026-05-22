from fastapi import APIRouter, Depends, HTTPException, Response
from ..database import Database, get_db
from ..services.badge_service import trust_badge_svg

router = APIRouter(prefix="/badge", tags=["badges"])


@router.get("/{slug}.svg")
async def badge(slug: str, db: Database = Depends(get_db)):
    row = await db.get_by_slug(slug)
    if row is None:
        raise HTTPException(status_code=404, detail="Passport not found")
    return Response(content=trust_badge_svg(row.trust_status), media_type="image/svg+xml")
