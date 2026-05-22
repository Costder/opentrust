from fastapi import APIRouter, Depends
from ..database import Database, get_db
from ..schemas.passport import PassportRead

router = APIRouter(prefix="/search", tags=["search"])


@router.get("", response_model=list[PassportRead])
async def search(q: str, db: Database = Depends(get_db)):
    return [PassportRead.from_model(row) for row in await db.search(q)]
