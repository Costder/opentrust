"""Security headers middleware for OpenTrust API.

Adds security-related HTTP response headers including:
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- X-XSS-Protection: 1; mode=block
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: restricted defaults
- Content-Security-Policy: restrictive defaults
- Strict-Transport-Security (HSTS) — only when SECURITY_HSTS_ENABLED=true
"""

import os


class SecurityHeadersMiddleware:
    """ASGI middleware that adds security headers to every HTTP response.

    HSTS is controlled by env vars (see config.py / .env):
        SECURITY_HSTS_ENABLED=true|false
        SECURITY_HSTS_MAX_AGE=31536000
        SECURITY_HSTS_INCLUDE_SUBDOMAINS=true
        SECURITY_HSTS_PRELOAD=true
    """

    def __init__(self, app):
        self.app = app

        # Parse HSTS settings
        hsts_enabled = os.environ.get("SECURITY_HSTS_ENABLED", "").strip().lower() == "true"
        self.hsts_max_age = int(os.environ.get("SECURITY_HSTS_MAX_AGE", "31536000"))
        hsts_include_sub = os.environ.get("SECURITY_HSTS_INCLUDE_SUBDOMAINS", "true").strip().lower() == "true"
        hsts_preload = os.environ.get("SECURITY_HSTS_PRELOAD", "true").strip().lower() == "true"

        self._strict_csp = b"default-src 'self'; frame-ancestors 'none'; base-uri 'self'"

        # Relaxed CSP for the auto-generated API docs (Swagger UI / ReDoc), which
        # load assets from jsdelivr and inject an inline init script. Without this
        # the strict default-src 'self' blocks the CDN and the docs render blank.
        self._docs_csp = (
            b"default-src 'self'; "
            b"script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            b"style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            b"img-src 'self' data: https://cdn.jsdelivr.net https://fastapi.tiangolo.com; "
            b"worker-src 'self' blob:; "
            b"frame-ancestors 'none'; base-uri 'self'"
        )

        # Build base headers (CSP is added per-request based on the path)
        self.base_headers = [
            (b"x-content-type-options", b"nosniff"),
            (b"x-frame-options", b"DENY"),
            (b"x-xss-protection", b"1; mode=block"),
            (b"referrer-policy", b"strict-origin-when-cross-origin"),
            (b"permissions-policy", b"camera=(), microphone=(), geolocation=(), interest-cohort=()"),
            (b"content-security-policy", self._strict_csp),
        ]

        if hsts_enabled:
            hsts_value = f"max-age={self.hsts_max_age}"
            if hsts_include_sub:
                hsts_value += "; includeSubDomains"
            if hsts_preload:
                hsts_value += "; preload"
            self.base_headers.append((b"strict-transport-security", hsts_value.encode()))

    _DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Docs/spec routes need the relaxed CSP so Swagger UI / ReDoc can load.
        path = scope.get("path", "")
        is_docs = path.startswith(self._DOCS_PATHS)
        csp = self._docs_csp if is_docs else self._strict_csp

        original_send = send

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                existing_headers = dict(message.get("headers", []))
                for key, value in self.base_headers:
                    if key == b"content-security-policy":
                        value = csp
                    if key not in existing_headers:
                        existing_headers[key] = value
                message["headers"] = list(existing_headers.items())
            await original_send(message)

        await self.app(scope, receive, send_with_headers)
