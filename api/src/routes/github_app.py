from fastapi import APIRouter, Depends, HTTPException

from ..database import Database, get_db
from ..schemas.marketplace import GitHubInstallationRequest, VerifiedRepo, VerifyRepoRequest
from ..services.marketplace_store import store
from ._durable import hydrate_installations, persist_installation, persist_repo

router = APIRouter(prefix="/github/app", tags=["github-app"])
github_router = APIRouter(prefix="/github", tags=["github-app"])
repos_router = APIRouter(prefix="/repos", tags=["github-app"])


@router.post("/installations/callback", response_model=GitHubInstallationRequest)
async def record_installation(request: GitHubInstallationRequest, db: Database = Depends(get_db)):
    result = store.record_installation(request)
    await persist_installation(db, result)
    return result


@router.post("/repos/verify", response_model=VerifiedRepo)
async def verify_repo(request: VerifyRepoRequest, db: Database = Depends(get_db)):
    await hydrate_installations(db)  # installation may live only in the DB (cold start)
    try:
        repo = store.verify_repo(request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    await persist_repo(db, repo)
    return repo


@github_router.get("/repos")
async def list_installed_repos():
    repos = []
    for installation in store.installations.values():
        repos.extend(
            {
                "installation_id": installation.installation_id,
                "account": installation.account,
                "repo_full_name": repo,
            }
            for repo in installation.repos
        )
    return {"repos": repos}


@repos_router.post("/{repo_id:path}/verify", response_model=VerifiedRepo)
async def verify_repo_alias(repo_id: str, request: VerifyRepoRequest, db: Database = Depends(get_db)):
    if repo_id != request.repo_full_name:
        raise HTTPException(status_code=400, detail="repo_id must match repo_full_name")
    return await verify_repo(request, db)
