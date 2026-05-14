from fastapi import APIRouter, HTTPException

from api.src.schemas.marketplace import GitHubInstallationRequest, VerifiedRepo, VerifyRepoRequest
from api.src.services.marketplace_store import store

router = APIRouter(prefix="/github/app", tags=["github-app"])
github_router = APIRouter(prefix="/github", tags=["github-app"])
repos_router = APIRouter(prefix="/repos", tags=["github-app"])


@router.post("/installations/callback", response_model=GitHubInstallationRequest)
async def record_installation(request: GitHubInstallationRequest):
    return store.record_installation(request)


@router.post("/repos/verify", response_model=VerifiedRepo)
async def verify_repo(request: VerifyRepoRequest):
    try:
        return store.verify_repo(request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


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
async def verify_repo_alias(repo_id: str, request: VerifyRepoRequest):
    if repo_id != request.repo_full_name:
        raise HTTPException(status_code=400, detail="repo_id must match repo_full_name")
    return await verify_repo(request)
