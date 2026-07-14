from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException
from manifest_validator import ValidationResult, validate_passport
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from api.src.database import get_session
from api.src.models.passport import Passport
from api.src.schemas.passport import PassportCreate, PassportRead, PassportUpdate

router = APIRouter(prefix="/tools", tags=["tools"])
_API_METADATA_FIELDS = frozenset({"description", "billing_plan", "fee_schedule"})


def require_valid_protocol(
    payload: PassportCreate | PassportUpdate,
) -> tuple[dict, dict, ValidationResult]:
    """Separate API metadata transport checks from canonical protocol validation."""
    document = payload.protocol_document()
    metadata = {key: document.pop(key) for key in _API_METADATA_FIELDS if key in document}
    transport_errors = []
    if "description" in metadata and not isinstance(metadata["description"], str):
        transport_errors.append(
            {"code": "transport.invalid_description", "path": "/description", "message": "description must be a string"}
        )
    for field in ("billing_plan", "fee_schedule"):
        if field in metadata and metadata[field] is not None and not isinstance(metadata[field], dict):
            transport_errors.append(
                {"code": f"transport.invalid_{field}", "path": f"/{field}", "message": f"{field} must be an object or null"}
            )
    if transport_errors:
        raise HTTPException(status_code=422, detail={"type": "transport_validation", "errors": transport_errors})

    result = validate_passport(document)
    if not result.valid:
        raise HTTPException(
            status_code=422,
            detail={"type": "protocol_validation", "validation": result.to_dict()},
        )
    return document, metadata, result


def apply_protocol_document(passport: Passport, document: dict, metadata: dict) -> None:
    """Persist the complete accepted protocol document and indexed projections."""
    identity = document["tool_identity"]
    passport.protocol_document = document
    passport.slug = identity["slug"]
    passport.name = identity["name"]
    passport.description = metadata.get("description", "")
    passport.spec_version = document["spec_version"]
    passport.trust_status = document["trust_status"]
    passport.tool_identity = identity
    passport.creator_identity = document.get("creator_identity")
    passport.version_hash = document["version_hash"]
    passport.capabilities = document["capabilities"]
    passport.permission_manifest = document["permission_manifest"]
    passport.source_formats = document["source_formats"]
    passport.risk_summary = document.get("risk_summary")
    passport.review_history = document.get("review_history", [])
    passport.commercial_status = document.get("commercial_status", {})
    passport.billing_plan = metadata.get("billing_plan")
    passport.fee_schedule = metadata.get("fee_schedule")
    passport.agent_access = document.get("agent_access", {})


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
    document, metadata, _ = require_valid_protocol(payload)
    identity = document["tool_identity"]
    passport = Passport(
        id=str(uuid4()),
        slug=identity["slug"],
        name=identity["name"],
    )
    apply_protocol_document(passport, document, metadata)
    session.add(passport)
    await session.commit()
    await session.refresh(passport)
    return PassportRead.from_model(passport)


@router.put("/{slug}", response_model=PassportRead)
async def update_tool(slug: str, payload: PassportUpdate, session: AsyncSession = Depends(get_session)):
    document, metadata, _ = require_valid_protocol(payload)
    result = await session.execute(select(Passport).where(Passport.slug == slug))
    passport = result.scalar_one_or_none()
    if passport is None:
        raise HTTPException(status_code=404, detail="Passport not found")
    apply_protocol_document(passport, document, metadata)
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
