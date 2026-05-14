import os
import httpx


class APIClient:
    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or os.getenv("OPENTRUST_API_URL") or "http://localhost:8000").rstrip("/")

    def get(self, path: str, **params):
        response = httpx.get(f"{self.base_url}/api/v1{path}", params=params, timeout=10)
        response.raise_for_status()
        return response.json()

    def post(self, path: str, json: dict | None = None):
        response = httpx.post(f"{self.base_url}/api/v1{path}", json=json, timeout=10)
        response.raise_for_status()
        return response.json()
