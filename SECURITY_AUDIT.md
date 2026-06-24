# OpenTrust Security Audit Report
**Date:** 2026-06-23
**Scope:** Full OWASP Top 10:2025 + Agentic AI Security (2026) + LLM Top 10 (2025)
**Target:** /home/joshua/opentrust (FastAPI backend, Next.js frontend, MCP server)
**Auditor:** Hermes Agent (z-ai/glm-5.2) using OWASP Security Skill

---

## Executive Summary

**Overall Risk: MEDIUM-HIGH** — The codebase demonstrates strong security fundamentals in several areas (JWT validation, admin auth fail-closed, webhook signature verification, parameterized queries) but has notable gaps in security logging, dependency pinning, swallowed-error patterns, and missing authentication on financial endpoints.

| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| HIGH     | 5 |
| MEDIUM   | 8 |
| LOW      | 6 |
| **Total** | **21** |

---

## Findings

### CRITICAL-1: No Authentication on Usage/Financial Endpoints (A01 — Broken Access Control)
**File:** `api/src/routes/usage.py` (lines 58, 119, 155, 163, 176, 194)
**Severity:** CRITICAL
**Verified:** YES — confirmed no auth dependency on any route in this file
**Code:**
```python
@router.post("/fund", response_model=UsageAccount)
async def fund_usage(request: FundUsageRequest, db: Database = Depends(get_db)):
    # No Depends(current_wallet) or Depends(decode_bearer) — anyone can call this

@router.post("/meter", response_model=...)
async def meter_usage(request: MeterUsageRequest, db: Database = Depends(get_db)):
    # No auth — anyone can draw down any account's balance

@router.get("/accounts/{account_id}", response_model=UsageAccount)
async def get_account(account_id: str, db: Database = Depends(get_db)):
    # No auth — anyone can read any account's balance and details

@router.get("/earnings")
async def earnings(seller_wallet_id: str = Query(...), db: Database = Depends(get_db)):
    # No auth — anyone can query any seller's earnings
```
**Issue:** Every endpoint in the usage router has zero authentication. Anyone can:
- Fund any account with USDC (by providing a valid tx hash)
- Meter/draw down any account's balance
- Read any account's balance and transaction history
- View any seller's earnings

The `buyer_wallet_id` is accepted as a request body field, not derived from an authenticated session. This means an attacker can impersonate any wallet.
**Fix:** Add `Depends(current_wallet)` to all state-changing endpoints and verify ownership:
```python
@router.post("/fund", response_model=UsageAccount)
async def fund_usage(request: FundUsageRequest, wallet_id: str = Depends(current_wallet), db: Database = Depends(get_db)):
    if request.buyer_wallet_id != wallet_id:
        raise HTTPException(status_code=403, detail="not your wallet")
```

### CRITICAL-2: Rate Limiter Silently Disables on Config Error (A10 — Exception Handling)
**File:** `api/src/middleware/rate_limit.py:39-46`
**Severity:** CRITICAL
**Verified:** YES — confirmed the code path
**Code:**
```python
except (ValueError, IndexError):
    self.max_requests = 0
    self.window_seconds = 0
    self.enabled = False  # Rate limiting silently disabled!
```
**Issue:** If `RATE_LIMIT` is misconfigured (e.g., `RATE_LIMIT=abc/60` or `RATE_LIMIT=100/`), the rate limiter silently disables itself instead of failing closed. This means a simple env var typo removes all brute-force protection. In production, this should abort startup, not degrade to no protection.
**Fix:** Fail closed in production:
```python
except (ValueError, IndexError):
    if os.environ.get("ENVIRONMENT") == "production":
        raise RuntimeError(f"Invalid RATE_LIMIT config: {raw}")
    self.enabled = False
```

---

### HIGH-1: Unpinned Python Dependencies (A03 — Supply Chain)
**File:** `api/requirements.txt`
**Severity:** HIGH
**Code:**
```
fastapi>=0.115
uvicorn
aiosqlite
httpx
pydantic-settings
python-jose
passlib
python-multipart
pytest
pytest-asyncio
cryptography
web3>=7.0,<8.0
eth-account>=0.13,<0.14
```
**Issue:** 8 of 13 dependencies have no version pin at all. `uvicorn`, `aiosqlite`, `httpx`, `pydantic-settings`, `python-jose`, `passlib`, `python-multipart`, `cryptography` are all floating. A compromised or breaking upstream release would be silently pulled on next `pip install`. `python-jose` specifically has had CVEs around algorithm confusion.
**Fix:** Pin all dependencies to exact versions. Use `pip-compile` to generate a locked `requirements.txt` with hashes. Add `pip-audit` to CI.

### HIGH-2: Swallowed Errors in Data Hydration (A10 — Exception Handling)
**Files:** 
- `api/src/routes/_durable.py:104` — `except Exception: pass` when hydrating reports
- `api/src/routes/_durable.py:120` — `except Exception: pass` when hydrating another object  
- `api/src/database.py:82-83` — `except (json.JSONDecodeError, TypeError): pass` silently swallows corrupt JSON

**Severity:** HIGH
**Issue:** These silently swallow errors during data hydration. If a passport's JSON data is corrupted (by bug, attack, or migration failure), the system silently drops it instead of logging the issue. This could mask data integrity attacks or silent data loss.
**Fix:** Replace `pass` with `logger.warning(f"Failed to hydrate: {e}", exc_info=True)` and continue. Don't crash, but DO log.

### HIGH-3: No Security Event Logging (A09 — Security Logging Failures)
**Files:** Entire `api/src/` directory
**Severity:** HIGH
**Issue:** The entire API has **zero security logging**. There are only 4 logging calls in the entire codebase, all in `config.py` for startup validation. No logging of:
- Login attempts (success or failure)
- Admin token authentication
- Payment transactions
- Passport trust level changes
- Wallet ownership verification
- Rate limit hits
- Webhook signature verification failures

This means a brute-force attack on admin endpoints, a payment fraud attempt, or a trust-level manipulation would be completely invisible.
**Fix:** Add structured logging to all auth paths:
```python
import logging
logger = logging.getLogger("opentrust.security")

# In _require_admin:
logger.info(f"ADMIN_AUTH user={actor} endpoint={request.url.path}")
# On failure:
logger.warning(f"ADMIN_AUTH_FAILED ip={request.client.host} reason=invalid_token")
```

### HIGH-4: No OAuth State Attempt Limiting (A07 — Authentication Failures)
**File:** `api/src/routes/auth.py:45-55`
**Severity:** HIGH
**Issue:** The OAuth `state` parameter is generated and consumed, but there's no limit on how many times an attacker can hit `/callback` with different codes for the same state. While the state is single-use (consumed on first call), there's no rate limit per-state before consumption. An attacker could brute-force OAuth codes within the state's validity window.
**Fix:** Add per-IP and per-state attempt tracking. Invalidate state after 3 failed attempts.

### HIGH-5: No JWT Token Revocation Mechanism (A07 — Authentication Failures)
**File:** `api/src/middleware/auth.py:54-66`
**Severity:** HIGH
**Issue:** Wallet session tokens are minted with `jwt.encode()` and have a 24-hour TTL. Once issued, they cannot be revoked — no revocation list, no JWKS rotation, no token blacklisting. If a wallet's session is compromised, the attacker has access for 24 hours with no way to invalidate the token short of rotating `JWT_SECRET` (which invalidates ALL sessions).
**Fix:** Implement a token revocation list (Redis-backed or DB-backed). Add a `jti` claim to tokens and check it against revoked tokens on each request.

---

### MEDIUM-7: Global Rate Limit Too Lax for Sensitive Endpoints (A06 — Insecure Design)
**File:** `api/src/config.py:75` (`rate_limit: str = "100/60"`)
**Severity:** MEDIUM
**Issue:** The global rate limit of 100 requests per 60 seconds applies uniformly to all endpoints. Sensitive endpoints (passport creation, payment checkout, wallet connect, OAuth callback) should have much stricter limits. 100 requests/minute on the payment endpoint could allow rapid payment manipulation attempts.
**Fix:** Add per-endpoint rate limit overrides:
```python
RATE_LIMIT_AUTH = "5/60"       # auth callback
RATE_LIMIT_PAYMENT = "10/60"   # payment endpoints
RATE_LIMIT_PASSPORT = "10/60"  # passport creation
```

### MEDIUM-8: No Per-Wallet Lockout on Failed Signature Verification (A07 — Authentication Failures)
**File:** `api/src/routes/marketplace.py:110-113` and `api/src/middleware/auth.py:38-51`
**Severity:** MEDIUM
**Issue:** The wallet ownership verification (`verify_wallet_ownership`) fails closed on exception, but there's no per-address attempt counter. An attacker can try 100 different signatures per minute against the `/connect` endpoint trying to forge wallet ownership. While EIP-191 recovery makes this computationally expensive, the lack of lockout still allows unlimited attempts.
**Fix:** Track failed verification attempts per `address` and lock out after 5 failures for 15 minutes.

### MEDIUM-1: Admin Token Uses Non-Constant-Time Comparison (A04 — Cryptographic Failures)
**File:** `api/src/routes/well_known.py:57`
**Code:**
```python
if parts[1] != token:
    raise HTTPException(status_code=403, detail="Invalid admin token")
```
**Severity:** MEDIUM
**Issue:** The admin bearer token is compared with `!=` (standard string comparison), which is vulnerable to timing attacks. An attacker could theoretically determine the token character-by-character by measuring response times.
**Note:** The Coinbase webhook handler correctly uses `hmac.compare_digest()` — this pattern should be applied everywhere secrets are compared.
**Fix:**
```python
import hmac
if not hmac.compare_digest(parts[1], token):
    raise HTTPException(status_code=403, detail="Invalid admin token")
```

### MEDIUM-2: Dev Mode Admin Access Open (A01 — Broken Access Control)
**File:** `api/src/routes/well_known.py:43-48`
**Code:**
```python
if not token:
    if settings.environment == "production":
        raise HTTPException(status_code=503, detail="admin access is not configured")
    return None  # Dev mode — allow all, record as anonymous
```
**Severity:** MEDIUM
**Issue:** In development mode (default), all admin endpoints are completely open with no authentication. If the API is accidentally deployed without setting `ENVIRONMENT=production`, admin endpoints (revoke passports, delete tools, create admin entries) are accessible to anyone.
**Fix:** Require a token in all environments. For dev, auto-generate a random token and print it to console on startup, rather than leaving endpoints open.

### MEDIUM-3: Default Postgres Credentials in Docker Compose (A02 — Misconfiguration)
**File:** `docker-compose.yml`
**Code:**
```yaml
POSTGRES_USER: ${POSTGRES_USER:-opentrust}
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-opentrust_dev}
```
**Severity:** MEDIUM
**Issue:** Default Postgres credentials (`opentrust`/`opentrust_dev`) are hardcoded as fallback. If `.env` is missing or incomplete, the database starts with known credentials. Also, the DB password appears in the `DB_URL` connection string in the `environment` block, which could leak in container inspection.
**Fix:** Remove defaults — require explicit env vars. Use Docker secrets instead of environment variables for credentials.

### MEDIUM-4: innerHTML XSS Risk in HBF Control Panel UI (A05 — Injection / XSS)
**File:** `packages/hands-body-and-feet/src/control-panel/ui/app.js` (lines 54, 78, 194, 220, 224, 233, 506, 544, 652, 669)
**Severity:** MEDIUM
**Issue:** The HBF control panel UI uses `innerHTML` extensively to render dynamic content including mission names, event descriptions, and agent data. If any of this data originates from user input or agent-generated content, it's vulnerable to XSS.
**Fix:** Use `textContent` for text content. If HTML rendering is needed, sanitize with DOMPurify or use a framework's built-in escaping.

### MEDIUM-5: Escrow Wallet Private Key in Config (A04 — Cryptographic Failures)
**File:** `api/src/config.py`
**Code:**
```python
escrow_wallet_private_key: str = ""
```
**Severity:** MEDIUM
**Issue:** The escrow wallet private key is loaded from an environment variable into a Pydantic settings object. While not hardcoded, the private key will be stored in memory as a plain string and could be exposed in memory dumps or error tracebacks. The `wallet_encryption_secret` follows the same pattern.
**Fix:** Use a secret manager (HashiCorp Vault, AWS Secrets Manager) or at minimum use `SecretStr` from Pydantic:
```python
from pydantic import SecretStr
escrow_wallet_private_key: SecretStr = SecretStr("")
```

### MEDIUM-6: No Input Length Validation on GitHub URL Submission (A06 — Insecure Design)
**File:** `api/src/routes/passports.py:60-70`
**Code:**
```python
@router.post("/submit", response_model=PassportRead, status_code=201)
async def submit_github(request: SubmitGithubRequest, db: Database = Depends(get_db)):
    full_name = parse_github_repo(request.github_url)
```
**Severity:** MEDIUM
**Issue:** `SubmitGithubRequest` only has `github_url: str` with no length limit or URL validation beyond `parse_github_repo`. An attacker could send extremely long URLs or malformed input that might cause unexpected behavior in `fetch_github_repo`.
**Fix:** Add `max_length` validation:
```python
class SubmitGithubRequest(BaseModel):
    github_url: str = Field(..., max_length=500)
```

---

### LOW-1: No HSTS in Development (A02 — Misconfiguration)
**File:** `api/src/config.py`
**Code:**
```python
security_hsts_enabled: bool = False
```
**Severity:** LOW
**Issue:** HSTS is disabled by default. While `SecurityHeadersMiddleware` exists, HSTS only activates when explicitly enabled. In production, this should be on.
**Fix:** Enable HSTS automatically when `ENVIRONMENT=production` (the config validation already checks for this — verify it's enforced).

### LOW-2: JWT Token Expiration Not Validated Explicitly (A07 — Authentication Failures)
**File:** `api/src/middleware/auth.py`
**Severity:** LOW
**Issue:** The JWT decode call uses `jose.jwt.decode()` which validates `exp` by default, but there's no explicit check that the token hasn't expired. The `jose` library will raise `ExpiredSignatureError` (a subclass of `JWTError`), so this is caught, but it's better practice to be explicit.
**Fix:** This is functional but could be more explicit. Consider adding `options={"verify_exp": True}` to the decode call for clarity.

### LOW-3: No Account Lockout on Wallet Auth (A07 — Authentication Failures)
**File:** `api/src/routes/marketplace.py:102-113` (wallet connect endpoint)
**Severity:** LOW
**Issue:** The wallet ownership verification endpoint has no brute-force protection beyond the global rate limiter (100 req/60s). An attacker could attempt 100 signature verifications per minute.
**Fix:** Add per-address rate limiting on the `/connect` endpoint (e.g., 5 attempts per address per 10 minutes).

### LOW-4: @babel/core Vulnerability in Frontend (A03 — Supply Chain)
**File:** `web/package.json` (via `npm audit`)
**Severity:** LOW
**Issue:** `@babel/core <=7.29.0` has a known vulnerability (Arbitrary File Read via sourceMappingURL Comment — GHSA-4x5r-pxfx-6jf8).
**Fix:** Run `npm audit fix` to update `@babel/core`.

### LOW-5: No CI/CD Integrity Verification (A08 — Software Integrity)
**Severity:** LOW
**Issue:** No evidence of SBOM generation, dependency locking with hashes, or build pipeline integrity verification. The `renovate.json` exists for dependency updates but no signing/verification of updates.
**Fix:** Add `pip-compile` with `--generate-hashes`, enable Dependabot/Renovate security alerts, and add SRI hashes for any CDN resources.

### LOW-6: Rate Limiter Does Not Log 429 Responses (A09 — Security Logging)
**File:** `api/src/middleware/rate_limit.py:82-95`
**Severity:** LOW
**Issue:** When the rate limiter rejects a request with 429, it does not log the event. Repeated rate limit hits from the same IP could indicate a brute-force or DoS attempt, but without logging these are invisible.
**Fix:** Add a `logger.warning(f"RATE_LIMIT_HIT ip={ip}")` in the `rate_limit_exceeded` method.

---

## Agentic AI Security Assessment (OWASP 2026 / LLM Top 10)

### ASI01 — Agent Goal Hijacking: LOW RISK
The gateway policy engine (`api/src/services/gateway_policy.py`) properly validates trust levels before allowing tool execution. Disputed tools are blocked. However, there's no input sanitization layer between agent requests and the policy engine itself.

### ASI02 — Tool Misuse: LOW RISK  
The permission manifest system (`_check_permission_scope` in `passports.py`) enforces granular scopes for high-risk permissions at `reviewer_signed` and above. The gateway policy blocks permissions explicitly. This is well-designed.

### ASI03 — Identity & Privilege Abuse: MEDIUM RISK
Wallet session tokens are scoped (`WALLET_SCOPE`) and have 24-hour TTL. However, there's no token revocation mechanism — once minted, a wallet token is valid until expiry. No refresh token rotation either.

### ASI04 — Agentic Supply Chain: MEDIUM RISK
Passports can be submitted from any GitHub repo via the public `/submit` endpoint. The `auto_generated_draft` trust level (L1) is appropriately low, but the system fetches external GitHub API data without verifying the repo's integrity beyond existence.

### LLM01 — Prompt Injection: N/A
OpenTrust doesn't directly call LLMs in the API backend. The passport data is structured JSON, not free-form LLM input.

### LLM05 — Improper Output Handling: LOW RISK
Passport data (including descriptions from GitHub) is stored and served. The frontend renders this via React (auto-escaped), but the HBF control panel uses `innerHTML` (see MEDIUM-4).

### LLM06 — Excessive Agency: WELL HANDLED
The gateway policy system has spend caps, permission blocking, approval requirements, and trust-level enforcement. This is a strong implementation.

### LLM10 — Unbounded Consumption: LOW RISK
Global rate limiting exists (100/60s). No per-user or per-tool cost budgets beyond the gateway policy spend caps.

---

## What's Done Well

1. **JWT Validation** — Empty secret is rejected, insecure placeholders are blocked, minimum length enforced. `HS256` is used correctly.
2. **Admin Auth Fail-Closed** — Production mode refuses to serve admin endpoints without a configured token. Dev mode is open but documented.
3. **Webhook Signature Verification** — Coinbase webhooks use `hmac.compare_digest()` with SHA-256. Constant-time comparison. Correct.
4. **Parameterized SQL** — All database queries use `?` placeholders. The f-strings in `database.py` only interpolate column names from `_COLUMNS` (a hardcoded frozenset), not user input. User input always goes through `?` parameters. This is safe.
5. **CORS Configuration** — Restricted to `http://localhost:3000` by default, not wildcard `*`. Configurable via env.
6. **Production Config Validation** — `run_config_validation()` checks JWT secret strength, admin token presence, CORS origins, and HSTS on startup in production mode.
7. **Wallet Ownership Verification** — Uses EIP-191 signature verification via `eth_account`. Properly fails closed on any exception.
8. **No Dangerous Deserialization** — No `pickle.loads()`, `yaml.load()`, or `eval()` in the source code.
9. **No Hardcoded Secrets** — All secrets loaded from environment variables. `.env` files are gitignored.
10. **Security Headers Middleware** — Custom middleware exists for HSTS and other security headers.

---

## Recommendations (Priority Order)

1. **Add auth to usage endpoints** — `/usage/*` has zero authentication (CRITICAL-1)
2. **Fix rate limiter fail-open** — must fail closed in production (CRITICAL-2)
3. **Add security logging** to all auth/admin/payment paths (HIGH-3)
4. **Pin all Python dependencies** with exact versions and hashes (HIGH-1)
5. **Fix swallowed errors** — log instead of silently passing (HIGH-2)
6. **Add JWT token revocation** mechanism (HIGH-5)
7. **Add OAuth state attempt limiting** (HIGH-4)
8. **Use constant-time comparison** for admin token (MEDIUM-1)
9. **Remove default Postgres credentials** from docker-compose (MEDIUM-3)
10. **Fix innerHTML XSS** in HBF control panel (MEDIUM-4)
11. **Add per-endpoint rate limits** for sensitive operations (MEDIUM-7)
12. **Run `npm audit fix`** for @babel/core (LOW-4)
13. **Generate SBOM** and add dependency scanning to CI (LOW-5)

---

*Audit performed using the OWASP Security Best Practices skill covering OWASP Top 10:2025, ASVS 5.0, LLM Top 10 (2025), and Agentic AI Security (2026).*
