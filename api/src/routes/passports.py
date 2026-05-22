import sqlite3
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException
from ..database import Database, get_db
from ..schemas.passport import PassportCreate, PassportRead

router = APIRouter(prefix="/tools", tags=["tools"])


@router.get("", response_model=list[PassportRead])
async def list_tools(db: Database = Depends(get_db)):
    return [PassportRead.from_model(row) for row in await db.list_passports()]


@router.get("/{slug}", response_model=PassportRead)
async def get_tool(slug: str, db: Database = Depends(get_db)):
    row = await db.get_by_slug(slug)
    if row is None:
        raise HTTPException(status_code=404, detail="Passport not found")
    return PassportRead.from_model(row)


@router.post("", response_model=PassportRead, status_code=201)
async def create_tool(payload: PassportCreate, db: Database = Depends(get_db)):
    identity = payload.tool_identity
    try:
        row = await db.create({
            "id": str(uuid4()),
            "slug": identity["slug"],
            "name": identity["name"],
            "description": payload.description,
            "trust_status": payload.trust_status.value,
            "tool_identity": payload.tool_identity,
            "creator_identity": payload.creator_identity,
            "version_hash": payload.version_hash,
            "capabilities": payload.capabilities,
            "permission_manifest": payload.permission_manifest,
            "risk_summary": payload.risk_summary,
            "review_history": payload.review_history,
            "commercial_status": payload.commercial_status,
            "billing_plan": payload.billing_plan,
            "fee_schedule": payload.fee_schedule,
            "agent_access": payload.agent_access,
        })
    except (sqlite3.IntegrityError, RuntimeError) as exc:
        msg = str(exc)
        if "UNIQUE" in msg or "unique" in msg.lower():
            raise HTTPException(status_code=409, detail=f"A passport with slug '{identity['slug']}' already exists.")
        raise HTTPException(status_code=500, detail="Database error.")
    return PassportRead.from_model(row)


@router.put("/{slug}", response_model=PassportRead)
async def update_tool(slug: str, payload: PassportCreate, db: Database = Depends(get_db)):
    existing = await db.get_by_slug(slug)
    if existing is None:
        raise HTTPException(status_code=404, detail="Passport not found")
    data = payload.model_dump()
    data["trust_status"] = payload.trust_status.value
    data["slug"] = payload.tool_identity["slug"]
    data["name"] = payload.tool_identity["name"]
    row = await db.update(slug, data)
    return PassportRead.from_model(row)


@router.get("/{slug}/badge")
async def badge_redirect(slug: str):
    return {"badge": f"/api/v1/badge/{slug}.svg", "trust_status": "lookup_required"}


@router.get("/search/local", response_model=list[PassportRead])
async def search_tools(q: str, db: Database = Depends(get_db)):
    return [PassportRead.from_model(row) for row in await db.search(q)]
