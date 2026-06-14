import re
import sqlite3
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from ..database import Database, get_db
from ..schemas.passport import PassportCreate, PassportRead, SecurityEvidenceBlock  # noqa: F401 — type reference
from ..services.passport_generator import draft_passport_from_metadata
from .well_known import _require_admin

router = APIRouter(prefix="/tools", tags=["tools"])
admin_router = APIRouter(prefix="/admin/tools", tags=["admin"])


# ── GitHub submission on-ramp ────────────────────────────────────────────────


_GITHUB_URL_RE = re.compile(
    r"^(?:https?://)?(?:www\.)?github\.com/([^/\s]+)/([^/\s#?]+?)(?:\.git)?/?$"
)
_BARE_REPO_RE = re.compile(r"^([^/\s]+)/([^/\s#?]+)$")


def parse_github_repo(url: str) -> str | None:
    """Normalize a GitHub URL or bare owner/repo to 'owner/repo', or None."""
    url = url.strip()
    m = _GITHUB_URL_RE.match(url)
    if m:
        return f"{m.group(1)}/{m.group(2)}"
    m = _BARE_REPO_RE.match(url)
    if m and "." not in m.group(1):  # avoid matching domains like example.com/x
        return f"{m.group(1)}/{m.group(2)}"
    return None


def fetch_github_repo(full_name: str) -> dict | None:
    """Fetch public repo metadata from the GitHub API. None if not found.

    Isolated so tests can patch it without network access.
    """
    try:
        resp = httpx.get(
            f"https://api.github.com/repos/{full_name}",
            headers={"Accept": "application/vnd.github+json"},
            timeout=10.0,
        )
    except httpx.HTTPError:
        return None
    if resp.status_code != 200:
        return None
    return resp.json()


class SubmitGithubRequest(BaseModel):
    github_url: str


@router.post("/submit", response_model=PassportRead, status_code=201)
async def submit_github(request: SubmitGithubRequest, db: Database = Depends(get_db)):
    """Public on-ramp: paste a GitHub repo -> auto-create an L1 draft passport.

    This is how the registry bootstraps. The draft starts at auto_generated_draft
    (L1) and can later be claimed and advanced by the owner. Re-submitting an
    existing repo returns the existing passport.
    """
    full_name = parse_github_repo(request.github_url)
    if full_name is None:
        raise HTTPException(status_code=422, detail="not a valid GitHub repo URL or owner/repo")

    meta = fetch_github_repo(full_name)
    if meta is None:
        raise HTTPException(status_code=404, detail=f"GitHub repo '{full_name}' not found")

    name = meta.get("name") or full_name.split("/")[-1]
    source_url = meta.get("html_url") or f"https://github.com/{full_name}"
    description = meta.get("description") or ""
    draft = draft_passport_from_metadata(name=name, source_url=source_url, description=description)
    slug = draft["tool_identity"]["slug"]

    existing = await db.get_by_slug(slug)
    if existing is not None:
        # Idempotent: return the existing passport rather than erroring.
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=200, content=PassportRead.from_model(existing).model_dump())

    row = await db.create({
        "id": str(uuid4()),
        "slug": slug,
        "name": name,
        "description": description,
        "trust_status": "auto_generated_draft",
        "tool_identity": draft["tool_identity"],
        "creator_identity": None,
        "version_hash": draft["version_hash"],
        "capabilities": draft["capabilities"],
        "permission_manifest": draft["permission_manifest"],
        "evidence": None,
        "risk_summary": draft["risk_summary"],
        "review_history": [],
        "commercial_status": draft["commercial_status"],
        "billing_plan": draft.get("billing_plan"),
        "fee_schedule": draft.get("fee_schedule"),
        "agent_access": draft["agent_access"],
    })
    return PassportRead.from_model(row)

_HIGH_RISK_PERMISSIONS = frozenset({"file", "network", "terminal", "wallet", "private_data"})
# "disputed" is intentionally excluded: a disputed passport is under investigation
# and its trust level will be reassessed. Granular scope enforcement targets the
# three levels where a reviewer or registry has actively validated the passport.
_TRUST_LEVELS_REQUIRING_GRANULAR = frozenset({
    "reviewer_signed", "security_checked", "continuously_monitored"
})


def _check_permission_scope(payload: PassportCreate) -> None:
    """Reject boolean true on high-risk permissions when trust_status requires granular scopes."""
    trust = payload.trust_status.value
    if trust not in _TRUST_LEVELS_REQUIRING_GRANULAR:
        return
    manifest = payload.permission_manifest or {}
    violations = [key for key in _HIGH_RISK_PERMISSIONS if manifest.get(key) is True]
    if violations:
        raise HTTPException(
            status_code=422,
            detail=(
                f"trust_status '{trust}' requires granular permission scopes (v0.2) for: "
                f"{', '.join(sorted(violations))}. Replace boolean true with a structured scope object. "
                f"See https://opentrust.sh/schemas/v0.2/permissions.schema.json"
            ),
        )


def _check_evidence_block(payload: PassportCreate) -> None:
    """Require a complete SecurityEvidenceBlock for security_checked and continuously_monitored trust levels."""
    if payload.trust_status.value not in {"security_checked", "continuously_monitored"}:
        return
    if payload.evidence is None:
        raise HTTPException(
            status_code=422,
            detail=(
                "trust_status 'security_checked' requires a complete evidence block. "
                "Provide scanner_output, reviewer_identity, commit_hash, "
                "dependency_snapshot, and signed_attestation."
            ),
        )


def _safe_reads(rows) -> list[PassportRead]:
    """Serialize rows to PassportRead, skipping any malformed row.

    A single corrupt/legacy row (e.g. a leftover demo passport missing required
    fields) must not 500 the whole listing — skip it and return the rest.
    """
    out: list[PassportRead] = []
    for row in rows:
        try:
            out.append(PassportRead.from_model(row))
        except Exception:
            continue
    return out


@router.get("")
async def list_tools(
    q: str | None = Query(default=None, description="Search query (name, description, capabilities)"),
    trust_status: str | None = Query(default=None, description="Filter by trust_status"),
    page: int = Query(default=1, ge=1, description="Page number"),
    limit: int = Query(default=20, ge=1, le=100, description="Results per page"),
    include_demo: bool = Query(default=False, description="Include demo/example tools"),
    demo_only: bool = Query(default=False, description="Return only demo/example tools"),
    db: Database = Depends(get_db),
):
    # demo: False = real only (default), True = demo only, None = both
    demo: bool | None = True if demo_only else (None if include_demo else False)
    offset = (page - 1) * limit
    items = await db.list_filtered(q=q, trust_status=trust_status, offset=offset, limit=limit, demo=demo)
    # Count via SELECT COUNT(*) rather than fetching every matching row (which a
    # single unfiltered request could turn into an O(n) full-table scan).
    total = await db.count_filtered(q=q, trust_status=trust_status, demo=demo)
    return {
        "items": _safe_reads(items),
        "total": total,
        "page": page,
        "limit": limit,
    }


@router.get("/{slug}", response_model=PassportRead)
async def get_tool(slug: str, db: Database = Depends(get_db)):
    row = await db.get_by_slug(slug)
    if row is None:
        raise HTTPException(status_code=404, detail="Passport not found")
    return PassportRead.from_model(row)


def _npx_args_for(slug: str, source_url: str | None) -> list[str]:
    """Best-effort npx args for an MCP server (community packages vary).

    For the official modelcontextprotocol-* reference servers we know the
    canonical package; otherwise we point at the source repo via the registry's
    own naming. Humans can adjust, agents get a sensible default.
    """
    if slug.startswith("modelcontextprotocol-"):
        short = slug.replace("modelcontextprotocol-", "")
        return ["-y", f"@modelcontextprotocol/server-{short}"]
    return ["-y", slug]


@router.get("/{slug}/install")
async def install_tool(slug: str, db: Database = Depends(get_db)):
    """Machine-readable install instructions an agent or human can act on.

    Free tools are directly installable; paid tools include a note that payment
    must happen first. For MCP servers we return a ready-to-paste client config.
    """
    row = await db.get_by_slug(slug)
    if row is None:
        raise HTTPException(status_code=404, detail="Passport not found")

    access = getattr(row, "agent_access", None) or {}
    kind = access.get("kind") if isinstance(access, dict) else None
    if not kind:
        kind = "mcp_server" if "mcp" in (getattr(row, "tool_identity", {}) or {}).get("category", "") else "tool"

    commercial = getattr(row, "commercial_status", None) or {}
    model = commercial.get("status") or commercial.get("model") or ""
    free = model in ("", "free")

    tool_identity = getattr(row, "tool_identity", {}) or {}
    source_url = tool_identity.get("source_url")

    result: dict = {
        "slug": slug,
        "name": getattr(row, "name", slug),
        "kind": kind,
        "free": free,
        "trust_status": getattr(row, "trust_status", None),
        "source_url": source_url,
        "passport_url": f"/api/v1/tools/{slug}",
        "note": "Free to install and use." if free
                else "This tool requires payment before use — see the passport's pricing.",
    }

    if kind == "mcp_server":
        args = _npx_args_for(slug, source_url)
        result["install_command"] = "npx " + " ".join(args)
        result["mcp_config"] = {
            "mcpServers": {
                slug: {"command": "npx", "args": args}
            }
        }
        # Deep links where clients support them (claude code / cursor).
        result["deep_links"] = {
            "claude_code": f"claude mcp add {slug} -- npx {' '.join(args)}",
        }
    elif kind == "skill":
        result["install_command"] = f"git clone {source_url}" if source_url else None
        result["note"] = (result["note"] + " Skills are folders — clone the source and "
                          "drop the skill into your agent's skills directory.")

    return result


@router.post("", response_model=PassportRead, status_code=201)
async def create_tool(payload: PassportCreate, db: Database = Depends(get_db)):
    _check_permission_scope(payload)
    _check_evidence_block(payload)
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
            "evidence": payload.evidence,
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
async def update_tool(
    slug: str,
    payload: PassportCreate,
    db: Database = Depends(get_db),
    actor: str | None = Depends(_require_admin),
):
    _check_permission_scope(payload)
    _check_evidence_block(payload)
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
    return _safe_reads(await db.search(q))


# ── Admin: elevated registry management (Bearer REGISTRY_ADMIN_TOKEN) ───────────


class AdminCreateTool(PassportCreate):
    is_demo: bool = False


class AdminPatchTool(BaseModel):
    trust_status: str | None = None
    is_demo: bool | None = None
    hidden: bool | None = None


@admin_router.post("", response_model=PassportRead, status_code=201)
async def admin_create_tool(
    payload: AdminCreateTool,
    db: Database = Depends(get_db),
    actor: str | None = Depends(_require_admin),
):
    """Operator-vouched passport creation. Sets trust_status directly and may
    flag the entry as demo. Requires admin auth when REGISTRY_ADMIN_TOKEN is set."""
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
            "evidence": payload.evidence,
            "risk_summary": payload.risk_summary,
            "review_history": payload.review_history,
            "commercial_status": payload.commercial_status,
            "billing_plan": payload.billing_plan,
            "fee_schedule": payload.fee_schedule,
            "agent_access": payload.agent_access,
            "is_demo": 1 if payload.is_demo else 0,
            "hidden": 0,
        })
    except (sqlite3.IntegrityError, RuntimeError) as exc:
        msg = str(exc)
        if "UNIQUE" in msg or "unique" in msg.lower():
            raise HTTPException(status_code=409, detail=f"A passport with slug '{identity['slug']}' already exists.")
        raise HTTPException(status_code=500, detail="Database error.")
    return PassportRead.from_model(row)


@admin_router.delete("/{slug}")
async def admin_delete_tool(
    slug: str,
    db: Database = Depends(get_db),
    actor: str | None = Depends(_require_admin),
):
    """Soft-delete: hide the passport from all listings (recoverable via PATCH)."""
    existing = await db.get_by_slug(slug)
    if existing is None:
        raise HTTPException(status_code=404, detail="Passport not found")
    await db.update(slug, {"hidden": 1})
    return {"hidden": slug}


@admin_router.patch("/{slug}", response_model=PassportRead)
async def admin_patch_tool(
    slug: str,
    payload: AdminPatchTool,
    db: Database = Depends(get_db),
    actor: str | None = Depends(_require_admin),
):
    """Edit trust_status, demo flag, or restore a soft-deleted passport."""
    existing = await db.get_by_slug(slug)
    if existing is None:
        raise HTTPException(status_code=404, detail="Passport not found")
    updates: dict = {}
    if payload.trust_status is not None:
        updates["trust_status"] = payload.trust_status
    if payload.is_demo is not None:
        updates["is_demo"] = 1 if payload.is_demo else 0
    if payload.hidden is not None:
        updates["hidden"] = 1 if payload.hidden else 0
    if updates:
        await db.update(slug, updates)
    return PassportRead.from_model(await db.get_by_slug(slug))
