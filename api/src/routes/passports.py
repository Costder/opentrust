from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from api.src.database import get_session
from api.src.models.passport import Passport
from api.src.schemas.passport import PassportCreate, PassportRead

router = APIRouter(prefix="/tools", tags=["tools"])


@router.get("", response_model=list[PassportRead])
async def list_tools(session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(Passport).order_by(Passport.name))
    return [PassportRead.from_model(row) for row in result.scalars()]


@router.get("/{slug}", response_model=PassportRead)
async def get_tool(slug: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(Passport).where(Passport.slug == slug))
    passport = result.scalar_one_or_none()
    if passport is None:
        raise HTTPException(status_code=404, detail="Passport not found")
    return PassportRead.from_model(passport)


@router.post("", response_model=PassportRead, status_code=201)
async def create_tool(payload: PassportCreate, session: AsyncSession = Depends(get_session)):
    identity = payload.tool_identity
    passport = Passport(
        id=str(uuid4()),
        slug=identity["slug"],
        name=identity["name"],
        description=payload.description,
        trust_status=payload.trust_status.value,
        tool_identity=payload.tool_identity,
        creator_identity=payload.creator_identity,
        version_hash=payload.version_hash,
        capabilities=payload.capabilities,
        permission_manifest=payload.permission_manifest,
        risk_summary=payload.risk_summary,
        review_history=payload.review_history,
        commercial_status=payload.commercial_status,
        billing_plan=payload.billing_plan,
        fee_schedule=payload.fee_schedule,
        agent_access=payload.agent_access,
    )
    session.add(passport)
    await session.commit()
    await session.refresh(passport)
    return PassportRead.from_model(passport)


@router.put("/{slug}", response_model=PassportRead)
async def update_tool(slug: str, payload: PassportCreate, session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(Passport).where(Passport.slug == slug))
    passport = result.scalar_one_or_none()
    if passport is None:
        raise HTTPException(status_code=404, detail="Passport not found")
    for field, value in payload.model_dump().items():
        if field == "trust_status":
            value = payload.trust_status.value
        setattr(passport, field, value)
    passport.slug = payload.tool_identity["slug"]
    passport.name = payload.tool_identity["name"]
    await session.commit()
    await session.refresh(passport)
    return PassportRead.from_model(passport)


@router.get("/{slug}/badge")
async def badge_redirect(slug: str):
    return {"badge": f"/api/v1/badge/{slug}.svg", "trust_status": "lookup_required"}


@router.get("/search/local", response_model=list[PassportRead])
async def search_tools(q: str, session: AsyncSession = Depends(get_session)):
    like = f"%{q}%"
    result = await session.execute(
        select(Passport).where(or_(Passport.name.ilike(like), Passport.description.ilike(like)))
    )
    return [PassportRead.from_model(row) for row in result.scalars()]
