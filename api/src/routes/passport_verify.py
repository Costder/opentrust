"""Differentiated verification endpoints.

Humans and agents earn trust through separate paths, all without OAuth gating
the endpoints themselves — the proof is the mechanism:

- ``POST /passports/{slug}/challenge``      issue a one-time nonce to sign
- ``POST /passports/{slug}/verify-wallet``  prove wallet control      -> L2
- ``POST /passports/{slug}/claim-owner``    human stakes GitHub id     -> L3
- ``POST /passports/{slug}/fee-verify``     $10 USDC on-chain fee       -> L4

Trust advances are written to the passport's ``trust_status`` plus two fields on
``creator_identity``: ``owner_github`` (public) and ``verification_path``.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..config import settings
from ..database import Database, get_db
from ..schemas.passport import PassportRead
from ..services.marketplace_store import store
from ..services.onchain import OnchainVerificationError, verify_usdc_transfer

router = APIRouter(prefix="/passports", tags=["verification"])

# ── In-memory verification state ───────────────────────────────────────────────
# Active wallet challenges keyed by slug (one at a time), and a set of consumed
# fee-payment tx hashes so a single $10 payment can't verify two passports.
_CHALLENGES: dict[str, dict] = {}
_CONSUMED_FEE_TX: set[str] = set()

_CHALLENGE_TTL_SECONDS = 300


def _reset_verification_state() -> None:
    """Test hook — clears challenges and consumed tx hashes."""
    _CHALLENGES.clear()
    _CONSUMED_FEE_TX.clear()


# ── Request models ─────────────────────────────────────────────────────────────

class WalletVerifyRequest(BaseModel):
    wallet_id: str
    signature: str = Field(min_length=4)


class OwnerClaimRequest(BaseModel):
    github_handle: str = Field(min_length=1)
    oauth_token: str = Field(min_length=1)


class FeeVerifyRequest(BaseModel):
    wallet_id: str
    tx_hash: str = Field(min_length=66, max_length=66, pattern=r"^0x[0-9a-fA-F]{64}$")


class GithubClaimRequest(BaseModel):
    code: str = Field(min_length=1)
    redirect_uri: str = Field(min_length=1)


class ChallengeResponse(BaseModel):
    challenge: str
    expires_at: str


class GithubStartResponse(BaseModel):
    auth_url: str
    state: str


class FeeInfoResponse(BaseModel):
    treasury_address: str
    amount_usdc: str
    usdc_contract: str
    chain_id: int
    chain: str = "base"


# ── Helpers ─────────────────────────────────────────────────────────────────────

async def _load_passport(slug: str, db: Database):
    row = await db.get_by_slug(slug)
    if row is None:
        raise HTTPException(status_code=404, detail="Passport not found")
    return row


async def _set_trust(
    slug: str,
    db: Database,
    *,
    trust_status: str,
    verification_path: str,
    owner_github: str | None = None,
):
    """Advance a passport's trust_status and stamp verification metadata."""
    row = await db.get_by_slug(slug)
    creator = dict(getattr(row, "creator_identity", None) or {})
    creator["verification_path"] = verification_path
    if owner_github is not None:
        creator["owner_github"] = owner_github
    updated = await db.update(slug, {
        "trust_status": trust_status,
        "creator_identity": creator,
    })
    return PassportRead.from_model(updated)


def validate_github_token(oauth_token: str) -> str | None:
    """Return the GitHub login for a valid OAuth token, or None if invalid.

    Isolated so tests can patch it without hitting the GitHub API.
    """
    try:
        resp = httpx.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {oauth_token}", "Accept": "application/vnd.github+json"},
            timeout=10.0,
        )
    except httpx.HTTPError:
        return None
    if resp.status_code != 200:
        return None
    return resp.json().get("login")


def exchange_code_for_login(code: str, redirect_uri: str) -> str | None:
    """Exchange a GitHub OAuth ``code`` for the authenticated user's login.

    Performs the server-side code->token exchange (the client secret never
    leaves the backend), then resolves the token to a GitHub login. Returns
    None on any failure. Isolated so tests can patch it.
    """
    try:
        token_resp = httpx.post(
            "https://github.com/login/oauth/access_token",
            headers={"Accept": "application/json"},
            data={
                "client_id": settings.github_client_id,
                "client_secret": settings.github_client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            },
            timeout=10.0,
        )
    except httpx.HTTPError:
        return None
    if token_resp.status_code != 200:
        return None
    access_token = token_resp.json().get("access_token")
    if not access_token:
        return None
    return validate_github_token(access_token)


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/{slug}/challenge", response_model=ChallengeResponse)
async def issue_challenge(slug: str, db: Database = Depends(get_db)):
    """Issue a one-time, short-lived nonce for the passport owner to sign."""
    await _load_passport(slug, db)
    nonce = secrets.token_hex(16)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=_CHALLENGE_TTL_SECONDS)
    challenge = f"opentrust-verify:{slug}:{nonce}:{expires_at.isoformat()}"
    _CHALLENGES[slug] = {"challenge": challenge, "expires_at": expires_at}
    return ChallengeResponse(challenge=challenge, expires_at=expires_at.isoformat())


@router.post("/{slug}/verify-wallet", response_model=PassportRead)
async def verify_wallet(slug: str, request: WalletVerifyRequest, db: Database = Depends(get_db)):
    """Prove control of the connected wallet by signing the challenge -> L2."""
    await _load_passport(slug, db)

    active = _CHALLENGES.get(slug)
    if active is None:
        raise HTTPException(status_code=400, detail="no active challenge — request one first")
    if datetime.now(timezone.utc) > active["expires_at"]:
        _CHALLENGES.pop(slug, None)
        raise HTTPException(status_code=400, detail="challenge expired — request a new one")

    wallet = store.wallets.get(request.wallet_id)
    if wallet is None:
        raise HTTPException(status_code=404, detail="wallet is not connected")

    message = encode_defunct(text=active["challenge"])
    try:
        recovered = Account.recover_message(message, signature=request.signature)
    except Exception as exc:  # malformed signature
        raise HTTPException(status_code=400, detail=f"invalid signature encoding: {exc}") from exc

    if recovered.lower() != wallet.address.lower():
        raise HTTPException(status_code=403, detail="signature does not match the connected wallet")

    # Consume the challenge (one-time use)
    _CHALLENGES.pop(slug, None)
    return await _set_trust(
        slug, db, trust_status="creator_claimed", verification_path="wallet_signed"
    )


@router.post("/{slug}/claim-owner", response_model=PassportRead)
async def claim_owner(slug: str, request: OwnerClaimRequest, db: Database = Depends(get_db)):
    """A human stakes their GitHub identity on their own agent -> L3.

    The GitHub handle is recorded publicly on the passport's creator_identity.
    """
    await _load_passport(slug, db)

    login = validate_github_token(request.oauth_token)
    if login is None:
        raise HTTPException(status_code=401, detail="invalid GitHub OAuth token")
    if login.lower() != request.github_handle.lower():
        raise HTTPException(
            status_code=403,
            detail=f"token belongs to '{login}', not '{request.github_handle}'",
        )

    return await _set_trust(
        slug,
        db,
        trust_status="seller_confirmed",
        verification_path="human_claimed",
        owner_github=login,
    )


@router.get("/{slug}/claim-github/start", response_model=GithubStartResponse)
async def claim_github_start(
    slug: str,
    redirect_uri: str = "http://localhost:3000/register/github",
    db: Database = Depends(get_db),
):
    """Begin the GitHub OAuth redirect flow for owner-claim.

    Returns the GitHub authorize URL the browser should redirect to, plus an
    opaque ``state`` that encodes the slug so the callback knows what to claim.
    The client secret is never exposed — only the public client_id.
    """
    await _load_passport(slug, db)
    if not settings.github_client_id:
        raise HTTPException(status_code=503, detail="GitHub OAuth is not configured")

    nonce = secrets.token_urlsafe(12)
    state = f"{slug}:{nonce}"
    auth_url = (
        "https://github.com/login/oauth/authorize"
        f"?client_id={settings.github_client_id}"
        f"&redirect_uri={redirect_uri}"
        "&scope=read:user"
        f"&state={state}"
    )
    return GithubStartResponse(auth_url=auth_url, state=state)


@router.post("/{slug}/claim-github", response_model=PassportRead)
async def claim_github(slug: str, request: GithubClaimRequest, db: Database = Depends(get_db)):
    """Complete the GitHub OAuth redirect flow -> L3.

    The browser sends the ``code`` GitHub returned to the callback page. The
    backend exchanges it for a token (server-side, secret never exposed),
    resolves the login, and stakes it on the passport publicly.
    """
    await _load_passport(slug, db)

    login = exchange_code_for_login(request.code, request.redirect_uri)
    if login is None:
        raise HTTPException(status_code=401, detail="GitHub authorization failed")

    return await _set_trust(
        slug,
        db,
        trust_status="seller_confirmed",
        verification_path="human_claimed",
        owner_github=login,
    )


@router.get("/{slug}/fee-info", response_model=FeeInfoResponse)
async def fee_info(slug: str, db: Database = Depends(get_db)):
    """Public payment details for the $10 verification fee.

    Lets the browser build a USDC transfer (treasury address, amount, token
    contract, chain) without hardcoding any of it client-side.
    """
    await _load_passport(slug, db)
    treasury = settings.opentrust_registry_treasury_address
    if not treasury:
        raise HTTPException(status_code=503, detail="registry treasury address not configured")
    return FeeInfoResponse(
        treasury_address=treasury,
        amount_usdc=settings.opentrust_verification_fee_usdc,
        usdc_contract=settings.base_usdc_contract,
        chain_id=8453,  # Base mainnet
    )


@router.post("/{slug}/fee-verify", response_model=PassportRead)
async def fee_verify(slug: str, request: FeeVerifyRequest, db: Database = Depends(get_db)):
    """Verify a $10 USDC fee paid to the registry treasury on Base L2 -> L4."""
    await _load_passport(slug, db)

    treasury = settings.opentrust_registry_treasury_address
    if not treasury:
        raise HTTPException(status_code=503, detail="registry treasury address not configured")

    # Replay check is durable: the in-memory set is a fast path, the DB object is
    # authoritative so a restart (e.g. serverless cold start) can't let the same
    # $10 payment verify a second passport.
    if request.tx_hash in _CONSUMED_FEE_TX or await db.get_object("fee_tx", request.tx_hash):
        raise HTTPException(status_code=409, detail="this transaction has already been used for verification")

    wallet = store.wallets.get(request.wallet_id)
    if wallet is None:
        raise HTTPException(status_code=404, detail="wallet is not connected")

    fee = Decimal(settings.opentrust_verification_fee_usdc)
    try:
        verify_usdc_transfer(
            tx_hash=request.tx_hash,
            expected_sender=wallet.address,
            expected_recipient=treasury,
            expected_amount_usdc=fee,
            rpc_url=settings.base_rpc_url,
            usdc_contract=settings.base_usdc_contract,
        )
    except OnchainVerificationError as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc

    _CONSUMED_FEE_TX.add(request.tx_hash)
    await db.save_object("fee_tx", request.tx_hash, {"slug": slug})
    return await _set_trust(
        slug, db, trust_status="community_reviewed", verification_path="fee_verified"
    )
