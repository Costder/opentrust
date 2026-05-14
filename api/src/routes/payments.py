from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/payments", tags=["payments"])
subscriptions_router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])
escrow_router = APIRouter(prefix="/escrow", tags=["escrow"])

MESSAGE = (
    "Payment processing is not implemented in the reference registry. "
    "Registry operators implement these endpoints against the OpenTrust payment contract schema. "
    "See passport-schema/commercial-status.schema.json and passport-schema/escrow.schema.json."
)


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
