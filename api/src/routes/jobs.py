"""Work venue (job board) endpoints.

Clients post work wanted; providers engage open jobs, which mints an escrow on
the existing rail. Engagement requires escrow to be enabled, since it moves funds
into escrow exactly like the direct escrow flow.
"""
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query

from ..config import settings
from ..schemas.jobs import (
    JobEngagement,
    JobEngageRequest,
    JobPosting,
    JobPostingRequest,
    JobStatus,
)
from ..schemas.marketplace import ProviderKind
from ..services.marketplace_store import store

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _map_job_error(exc: Exception) -> HTTPException:
    if isinstance(exc, KeyError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=500, detail="unexpected job error")


@router.post("", response_model=JobPosting)
async def create_job(request: JobPostingRequest):
    if not settings.opentrust_marketplace_enabled:
        raise HTTPException(status_code=403, detail="marketplace is disabled")
    try:
        return store.create_job(request)
    except (KeyError, PermissionError, ValueError) as exc:
        raise _map_job_error(exc) from exc


@router.get("", response_model=list[JobPosting])
async def list_jobs(
    status: JobStatus | None = Query(default=None),
    provider_kind: ProviderKind | None = Query(default=None),
    max_budget: Decimal | None = Query(default=None),
):
    return store.list_jobs(status=status, provider_kind=provider_kind, max_budget=max_budget)


@router.get("/{job_id}", response_model=JobPosting)
async def get_job(job_id: str):
    job = store.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job does not exist")
    return job


@router.post("/{job_id}/engage", response_model=JobEngagement)
async def engage_job(job_id: str, request: JobEngageRequest):
    if not settings.opentrust_escrow_enabled:
        raise HTTPException(status_code=403, detail="escrow is disabled")
    try:
        return store.engage_job(job_id, request)
    except (KeyError, PermissionError, ValueError) as exc:
        raise _map_job_error(exc) from exc


@router.post("/{job_id}/cancel", response_model=JobPosting)
async def cancel_job(job_id: str):
    try:
        return store.cancel_job(job_id)
    except (KeyError, PermissionError, ValueError) as exc:
        raise _map_job_error(exc) from exc
