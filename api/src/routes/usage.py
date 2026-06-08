"""Usage-based (metered) billing endpoints.

Prepaid balance model: a buyer funds a balance for a listing with a real on-chain
USDC transfer (verified here), and each call meters the balance down by the
listing's unit price. Insufficient balance returns 402. Accounts + events persist
via the marketplace_objects table so they survive serverless cold starts.
"""
import json

from fastapi import APIRouter, Depends, HTTPException, Query

from ..config import settings
from ..database import Database, get_db
from ..schemas.marketplace import (
    FundUsageRequest,
    MeterUsageRequest,
    UsageAccount,
    UsageEvent,
)
from ..services.marketplace_store import store
from ..services.onchain import OnchainVerificationError, verify_usdc_transfer

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
async def fund_usage(request: FundUsageRequest, db: Database = Depends(get_db)):
    """Fund (or top up) a prepaid balance with an on-chain-verified USDC transfer."""
    listing = store.listings.get(request.listing_id)
    if listing is None:
        # cold start: the listing may only be in the DB
        from ..routes.marketplace import _hydrate_listings
        await _hydrate_listings(db)
        listing = store.listings.get(request.listing_id)
    if listing is None:
        raise HTTPException(status_code=404, detail="listing not found")

    buyer = store.wallets.get(request.buyer_wallet_id)
    seller = store.wallets.get(listing.seller_wallet_id)
    if buyer is None or seller is None:
        # cold start: wallets may live only in the DB
        from ..routes.marketplace import _hydrate_wallets
        await _hydrate_wallets(db)
        buyer = store.wallets.get(request.buyer_wallet_id)
        seller = store.wallets.get(listing.seller_wallet_id)
    if buyer is None or seller is None:
        raise HTTPException(status_code=404, detail="wallet not found")

    # Verify the funding transfer landed in the seller's wallet on-chain.
    try:
        verify_usdc_transfer(
            tx_hash=request.transaction_hash,
            expected_sender=buyer.address,
            expected_recipient=seller.address,
            expected_amount_usdc=request.amount_usdc,
            rpc_url=settings.base_rpc_url,
            usdc_contract=settings.base_usdc_contract,
        )
    except OnchainVerificationError as exc:
        raise HTTPException(status_code=402, detail=f"funding verification failed: {exc}") from exc

    try:
        account = store.fund_usage(request.listing_id, request.buyer_wallet_id, request.amount_usdc)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await _persist_account(db, account)
    return account


@router.post("/meter")
async def meter_usage(request: MeterUsageRequest, db: Database = Depends(get_db)):
    """Draw down a prepaid balance. 402 when the balance can't cover the call."""
    account = await _hydrate_account(db, request.account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="usage account not found")
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
async def get_account(account_id: str, db: Database = Depends(get_db)):
    acct = await _hydrate_account(db, account_id)
    if acct is None:
        raise HTTPException(status_code=404, detail="usage account not found")
    return acct


@router.get("/accounts", response_model=UsageAccount)
async def find_account(
    listing_id: str = Query(...),
    buyer_wallet_id: str = Query(...),
    db: Database = Depends(get_db),
):
    await _hydrate_all_accounts(db)
    acct = store.find_usage_account(listing_id, buyer_wallet_id)
    if acct is None:
        raise HTTPException(status_code=404, detail="no usage account for this listing + buyer")
    return acct


@router.get("/accounts/{account_id}/events", response_model=list[UsageEvent])
async def get_events(account_id: str, db: Database = Depends(get_db)):
    # ensure account exists (hydrate), events live alongside it in memory once metered
    await _hydrate_account(db, account_id)
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
async def earnings(seller_wallet_id: str = Query(...), db: Database = Depends(get_db)):
    await _hydrate_all_accounts(db)
    result = store.seller_earnings(seller_wallet_id)
    # Decimals -> strings for JSON safety
    for k in ("funded_usdc", "consumed_usdc", "outstanding_balance_usdc"):
        result[k] = str(result[k])
    return result
