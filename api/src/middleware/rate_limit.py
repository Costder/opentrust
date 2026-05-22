"""Rate limiting middleware for OpenTrust API.

Supports per-IP sliding window rate limiting with env-driven configuration.
When RATE_LIMIT is not set or set to "0/0", rate limiting is disabled (dev mode).
"""

import os
import time
from collections import defaultdict
from collections.abc import Awaitable, Callable


class RateLimitMiddleware:
    """ASGI middleware for per-IP rate limiting using a sliding window.

    Configuration via RATE_LIMIT env var: "<max_requests>/<window_seconds>"
    Example: RATE_LIMIT=100/60 allows 100 requests per 60 seconds per IP.
    Set to "0/0" or leave unset to disable rate limiting.
    """

    def __init__(self, app):
        self.app = app
        self._windows: dict[str, list[float]] = defaultdict(list)
        # Parse RATE_LIMIT from env
        raw = os.environ.get("RATE_LIMIT", "").strip()
        if raw and "/" in raw:
            try:
                parts = raw.split("/")
                self.max_requests = int(parts[0])
                self.window_seconds = int(parts[1])
                self.enabled = self.max_requests > 0 and self.window_seconds > 0
            except (ValueError, IndexError):
                self.max_requests = 0
                self.window_seconds = 0
                self.enabled = False
        else:
            self.max_requests = 0
            self.window_seconds = 0
            self.enabled = False

    def _client_ip(self, scope: dict) -> str:
        """Extract the client IP from the ASGI scope."""
        # Try X-Forwarded-For client header (set by reverse proxy)
        headers = dict(scope.get("headers", []))
        forwarded = headers.get(b"x-forwarded-for", b"").decode()
        if forwarded:
            return forwarded.split(",")[0].strip()
        # Fall back to direct connection address
        client = scope.get("client")
        if client:
            return client[0]
        return "127.0.0.1"

    def _check(self, ip: str) -> bool:
        """Check if request from this IP is allowed. Returns True if allowed."""
        now = time.time()
        window_start = now - self.window_seconds
        # Prune old entries
        timestamps = self._windows[ip]
        self._windows[ip] = [t for t in timestamps if t > window_start]
        # Check limit
        if len(self._windows[ip]) >= self.max_requests:
            return False
        self._windows[ip].append(now)
        return True

    async def rate_limit_exceeded(self, scope, receive, send):
        """Send a 429 Too Many Requests response."""
        await send({
            "type": "http.response.start",
            "status": 429,
            "headers": [
                (b"content-type", b"application/json"),
                (b"retry-after", b"60"),
            ],
        })
        await send({
            "type": "http.response.body",
            "body": b'{"detail":"Rate limit exceeded. Try again later."}',
        })

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not self.enabled:
            await self.app(scope, receive, send)
            return
        ip = self._client_ip(scope)
        if not self._check(ip):
            await self.rate_limit_exceeded(scope, receive, send)
            return
        await self.app(scope, receive, send)
