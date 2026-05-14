from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from api.src.database import get_session
from api.src.models.passport import Passport
from api.src.schemas.passport import PassportRead

router = APIRouter(prefix="/search", tags=["search"])


@router.get("", response_model=list[PassportRead])
async def search(q: str, session: AsyncSession = Depends(get_session)):
    like = f"%{q}%"
    result = await session.execute(
        select(Passport).where(
            or_(Passport.name.ilike(like), Passport.description.ilike(like), Passport.capabilities.as_string().ilike(like))
        )
    )
    return [PassportRead.from_model(row) for row in result.scalars()]
