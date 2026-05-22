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

        # Build base headers
        self.base_headers = [
            (b"x-content-type-options", b"nosniff"),
            (b"x-frame-options", b"DENY"),
            (b"x-xss-protection", b"1; mode=block"),
            (b"referrer-policy", b"strict-origin-when-cross-origin"),
            (b"permissions-policy", b"camera=(), microphone=(), geolocation=(), interest-cohort=()"),
            (b"content-security-policy", b"default-src 'self'; frame-ancestors 'none'; base-uri 'self'"),
        ]

        if hsts_enabled:
            hsts_value = f"max-age={self.hsts_max_age}"
            if hsts_include_sub:
                hsts_value += "; includeSubDomains"
            if hsts_preload:
                hsts_value += "; preload"
            self.base_headers.append((b"strict-transport-security", hsts_value.encode()))

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        original_send = send

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                existing_headers = dict(message.get("headers", []))
                # Merge our headers, not overriding any that the app set explicitly
                for key, value in self.base_headers:
                    if key not in existing_headers:
                        existing_headers[key] = value
                message["headers"] = list(existing_headers.items())
            await original_send(message)

        await self.app(scope, receive, send_with_headers)
