from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/payments", tags=["payments"])
subscriptions_router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])
escrow_router = APIRouter(prefix="/escrow", tags=["escrow"])

MESSAGE = "Payment is a private add-on. Install and configure opentrust-private to enable this endpoint."


@router.post("/checkout")
async def checkout():
    raise HTTPException(status_code=501, detail=MESSAGE)


@router.post("/verify")
async def verify():
    raise HTTPException(status_code=501, detail=MESSAGE)


@subscriptions_router.post("/create")
async def create_subscription():
    raise HTTPException(status_code=501, detail=MESSAGE)


@escrow_router.post("/create")
async def create_escrow():
    raise HTTPException(status_code=501, detail=MESSAGE)
