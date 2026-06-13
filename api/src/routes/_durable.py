"""Cold-start durability for mutable marketplace entities.

routes.marketplace persists + hydrates wallets and listings. Escrows, jobs,
reputation and ratings move through a lifecycle, so they are re-persisted after
each transition and hydrated on demand (by id, or in full for list/score views).
The in-memory store stays the working set; the DB is the source of truth across
serverless cold starts.
"""
import json

from ..database import Database
from ..schemas.jobs import JobPosting
from ..schemas.marketplace import EscrowRecord
from ..schemas.reputation import CounterpartyRating, ReputationRecord
from ..services.marketplace_store import store


def _jsonable(model) -> dict:
    return json.loads(model.model_dump_json())


# ── Durable on-chain tx-hash replay protection ───────────────────────────────
# The in-memory store dedups within a single process; this DB-backed layer makes
# it correct across workers and serverless cold starts so one real transfer can
# never fund two escrows/orders/accounts on different instances.

async def tx_hash_consumed(db: Database, tx_hash: str) -> bool:
    return await db.get_object("consumed_tx", tx_hash) is not None


async def consume_tx_hash(db: Database, tx_hash: str, context: dict) -> None:
    await db.save_object("consumed_tx", tx_hash, context)


def _rep_key(record: ReputationRecord) -> str:
    kind = record.subject_kind
    return f"{record.subject_id}::{kind.value if hasattr(kind, 'value') else kind}"


# ── Escrows (always read by id; never listed in bulk) ────────────────────────
async def persist_escrow(db: Database, escrow: EscrowRecord) -> None:
    await db.save_object("escrow", escrow.escrow_id, _jsonable(escrow))


async def hydrate_escrow(db: Database, escrow_id: str) -> EscrowRecord | None:
    """Return an escrow from the working set, loading from DB on a cold start."""
    escrow = store.escrows.get(escrow_id)
    if escrow is not None:
        return escrow
    data = await db.get_object("escrow", escrow_id)
    if data is None:
        return None
    try:
        escrow = EscrowRecord(**data)
    except Exception:
        return None
    store.escrows[escrow.escrow_id] = escrow
    return escrow


# ── Jobs ─────────────────────────────────────────────────────────────────────
async def persist_job(db: Database, job: JobPosting) -> None:
    await db.save_object("job", job.job_id, _jsonable(job))


async def hydrate_job(db: Database, job_id: str) -> JobPosting | None:
    job = store.jobs.get(job_id)
    if job is not None:
        return job
    data = await db.get_object("job", job_id)
    if data is None:
        return None
    try:
        job = JobPosting(**data)
    except Exception:
        return None
    store.jobs[job.job_id] = job
    return job


async def hydrate_jobs(db: Database) -> None:
    for data in await db.load_objects("job"):
        jid = data.get("job_id")
        if jid and jid not in store.jobs:
            try:
                store.jobs[jid] = JobPosting(**data)
            except Exception:
                continue


# ── Reputation + ratings (small sets; persisted in full after a change) ──────
async def persist_reputation_all(db: Database) -> None:
    for record in store.reputation.values():
        await db.save_object("reputation", _rep_key(record), _jsonable(record))


async def hydrate_reputation(db: Database) -> None:
    for data in await db.load_objects("reputation"):
        try:
            record = ReputationRecord(**data)
        except Exception:
            continue
        key = (record.subject_id, record.subject_kind)
        if key not in store.reputation:
            store.reputation[key] = record


async def persist_rating(db: Database, rating: CounterpartyRating) -> None:
    await db.save_object("rating", rating.rating_id, _jsonable(rating))


async def hydrate_ratings(db: Database) -> None:
    for data in await db.load_objects("rating"):
        rid = data.get("rating_id")
        if rid and rid not in store.ratings:
            try:
                store.ratings[rid] = CounterpartyRating(**data)
            except Exception:
                continue


# ── Settlement: release/refund/dispute mutate escrow + linked job + reputation ─
async def persist_settlement(db: Database, escrow: EscrowRecord) -> None:
    """Persist the full graph a settlement touches: the escrow, the job it may
    have completed, and every reputation record it accrued to."""
    await persist_escrow(db, escrow)
    ref = escrow.client_reference_id
    if ref and ref in store.jobs:
        await persist_job(db, store.jobs[ref])
    await persist_reputation_all(db)
