"""Usage-based (metered) billing endpoints.

Prepaid balance model: a buyer funds a balance for a listing with a real on-chain
USDC transfer (verified here), and each call meters the balance down by the
listing's unit price. Insufficient balance returns 402. Accounts + events persist
via the marketplace_objects table so they survive serverless cold starts.
"""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from ..config import settings
from ..database import Database, get_db
from ..middleware.auth import current_wallet
from ..schemas.marketplace import (
    FundUsageRequest,
    MeterUsageRequest,
    UsageAccount,
    UsageEvent,
)
from ..services.marketplace_store import store
from ..services.onchain import OnchainVerificationError, verify_usdc_transfer
from ._durable import claim_tx_hash, tx_hash_consumed

logger = logging.getLogger("opentrust.security")

router = APIRouter(prefix="/usage", tags=["usage"])


def _jsonable(model) -> dict:
    return json.loads(model.model_dump_json())


async def _persist_account(db: Database, account: UsageAccount) -> None:
    await db.save_object("usage_account", account.account_id, _jsonable(account))


async def _hydrate_account(db: Database, account_id: str) -> UsageAccount | None:
    """Return an account from the working set, loading from DB on a cold start."""
    acct = store.usage_accounts.get(account_id)
    if acct is not None:
        return acct
    data = await db.get_object("usage_account", account_id)
    if data is None:
        return None
    acct = UsageAccount(**data)
    store.usage_accounts[acct.account_id] = acct
    return acct


async def _hydrate_all_accounts(db: Database) -> None:
    for data in await db.load_objects("usage_account"):
        aid = data.get("account_id")
        if aid and aid not in store.usage_accounts:
            try:
                store.usage_accounts[aid] = UsageAccount(**data)
            except Exception:
                continue


@router.post("/fund", response_model=UsageAccount)
async def fund_usage(
    request: FundUsageRequest,
    wallet_id: str = Depends(current_wallet),
    db: Database = Depends(get_db),
):
    """Fund (or top up) a prepaid balance with an on-chain-verified USDC transfer."""
    if request.buyer_wallet_id != wallet_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    listing = store.listings.get(request.listing_id)
    if listing is None:
        # cold start: the listing may only be in the DB
        from ..routes.marketplace import _hydrate_listings
        await _hydrate_listings(db)
        listing = store.listings.get(request.listing_id)
    if listing is None:
        raise HTTPException(status_code=404, detail="Not found")

    buyer = store.wallets.get(request.buyer_wallet_id)
    seller = store.wallets.get(listing.seller_wallet_id)
    if buyer is None or seller is None:
        # cold start: wallets may live only in the DB
        from ..routes.marketplace import _hydrate_wallets
        await _hydrate_wallets(db)
        buyer = store.wallets.get(request.buyer_wallet_id)
        seller = store.wallets.get(listing.seller_wallet_id)
    if buyer is None or seller is None:
        raise HTTPException(status_code=404, detail="Not found")

    if await tx_hash_consumed(db, request.transaction_hash):
        raise HTTPException(status_code=409, detail="Conflict")

    # Verify the funding transfer landed in the seller's wallet on-chain.
    try:
        transfer = verify_usdc_transfer(
            tx_hash=request.transaction_hash,
            expected_sender=buyer.address,
            expected_recipient=seller.address,
            expected_amount_usdc=request.amount_usdc,
            rpc_url=settings.base_rpc_url,
            usdc_contract=settings.base_usdc_contract,
        )
    except OnchainVerificationError as exc:
        raise HTTPException(status_code=402, detail=f"funding verification failed: {exc}") from exc

    # Atomically claim the funding tx hash before crediting so a single transfer
    # can't be replayed (incl. concurrently across instances) to top up twice.
    if not await claim_tx_hash(db, request.transaction_hash, {"listing_id": request.listing_id}):
        raise HTTPException(status_code=409, detail="Conflict")

    # Credit exactly what the chain confirms, not the client-asserted amount.
    credited = getattr(transfer, "amount_usdc", None) or request.amount_usdc
    try:
        account = store.fund_usage(
            request.listing_id,
            request.buyer_wallet_id,
            credited,
            tx_hash=request.transaction_hash,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await _persist_account(db, account)
    return account


@router.post("/meter")
async def meter_usage(
    request: MeterUsageRequest,
    wallet_id: str = Depends(current_wallet),
    db: Database = Depends(get_db),
):
    """Draw down a prepaid balance. 402 when the balance can't cover the call."""
    account = await _hydrate_account(db, request.account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Not found")
    if account.buyer_wallet_id != wallet_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        result = store.meter_usage(
            request.account_id,
            quantity=request.quantity,
            idempotency_key=request.idempotency_key,
            note=request.note,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if not result["allowed"]:
        raise HTTPException(
            status_code=402,
            detail=f"insufficient balance: need {result['amount_usdc']} USDC, have {result['balance_after_usdc']} USDC",
        )

    # Persist the updated account + the new event.
    await _persist_account(db, store.usage_accounts[request.account_id])
    if not result.get("replayed") and result.get("event_id"):
        ev = store.usage_events.get(result["event_id"])
        if ev is not None:
            await db.save_object("usage_event", ev.event_id, _jsonable(ev))
    # Decimals -> strings for consistent, JSON-safe output.
    return {
        **result,
        "amount_usdc": str(result["amount_usdc"]),
        "balance_after_usdc": str(result["balance_after_usdc"]),
    }


@router.get("/accounts/{account_id}", response_model=UsageAccount)
async def get_account(
    account_id: str,
    wallet_id: str = Depends(current_wallet),
    db: Database = Depends(get_db),
):
    acct = await _hydrate_account(db, account_id)
    if acct is None:
        raise HTTPException(status_code=404, detail="Not found")
    if acct.buyer_wallet_id != wallet_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return acct


@router.get("/accounts", response_model=UsageAccount)
async def find_account(
    listing_id: str = Query(...),
    buyer_wallet_id: str = Query(...),
    wallet_id: str = Depends(current_wallet),
    db: Database = Depends(get_db),
):
    if buyer_wallet_id != wallet_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    await _hydrate_all_accounts(db)
    acct = store.find_usage_account(listing_id, buyer_wallet_id)
    if acct is None:
        raise HTTPException(status_code=404, detail="Not found")
    return acct


@router.get("/accounts/{account_id}/events", response_model=list[UsageEvent])
async def get_events(
    account_id: str,
    wallet_id: str = Depends(current_wallet),
    db: Database = Depends(get_db),
):
    # ensure account exists (hydrate), events live alongside it in memory once metered
    account = await _hydrate_account(db, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Not found")
    if account.buyer_wallet_id != wallet_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    in_mem = store.list_usage_events(account_id)
    if in_mem:
        return in_mem
    # cold start: load events from DB
    out = []
    for data in await db.load_objects("usage_event"):
        if data.get("account_id") == account_id:
            try:
                out.append(UsageEvent(**data))
            except Exception:
                continue
    return sorted(out, key=lambda e: e.created_at)


@router.get("/earnings")
async def earnings(
    seller_wallet_id: str = Query(...),
    wallet_id: str = Depends(current_wallet),
    db: Database = Depends(get_db),
):
    if seller_wallet_id != wallet_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    await _hydrate_all_accounts(db)
    result = store.seller_earnings(seller_wallet_id)
    # Decimals -> strings for JSON safety
    for k in ("funded_usdc", "consumed_usdc", "outstanding_balance_usdc"):
        result[k] = str(result[k])
    return result
