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
        # Peer IPs that are trusted to set X-Forwarded-For (comma-separated).
        # When the direct connection comes from one of these, the rightmost
        # X-Forwarded-For entry (appended by that proxy) is used as the client
        # IP. Otherwise the header is ignored so clients cannot spoof their IP
        # to bypass per-IP rate limiting. Leave unset in local dev.
        trusted_raw = os.environ.get("TRUSTED_PROXIES", "").strip()
        self.trusted_proxies = {ip.strip() for ip in trusted_raw.split(",") if ip.strip()}
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
        """Extract the client IP from the ASGI scope.

        X-Forwarded-For is only honored when the direct peer is a configured
        trusted proxy, and then the *rightmost* entry (the one the trusted proxy
        appended) is used — never the leftmost, which is fully client-controlled.
        """
        client = scope.get("client")
        peer_ip = client[0] if client else None

        if peer_ip and peer_ip in self.trusted_proxies:
            headers = dict(scope.get("headers", []))
            forwarded = headers.get(b"x-forwarded-for", b"").decode()
            ips = [ip.strip() for ip in forwarded.split(",") if ip.strip()]
            if ips:
                return ips[-1]

        if peer_ip:
            return peer_ip
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
