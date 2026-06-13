import re


def normalize_slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "tool"


def build_github_oauth_url(client_id: str, redirect_uri: str, state: str | None = None) -> str:
    url = f"https://github.com/login/oauth/authorize?client_id={client_id}&redirect_uri={redirect_uri}&scope=read:user"
    if state:
        url += f"&state={state}"
    return url
