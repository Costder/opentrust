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
from ..schemas.marketplace import (
    CheckoutResponse,
    EscrowRecord,
    EvidenceRun,
    GitHubInstallationRequest,
    TrustReport,
    VerifiedBadge,
    VerifiedRepo,
)
from ..schemas.reputation import CounterpartyRating, ReputationRecord
from ..services.marketplace_store import store


def _jsonable(model) -> dict:
    return json.loads(model.model_dump_json())


# ── Trust-report / badge flow durability ─────────────────────────────────────
# checkouts, repos, installations, evidence, reports and badges were in-memory
# only, so on serverless the purchase flow broke across instances (a checkout
# created on one worker was invisible to create_report on another). Persist on
# write, hydrate on read, mirroring the escrow/listing pattern.

async def persist_installation(db: Database, inst: GitHubInstallationRequest) -> None:
    await db.save_object("installation", str(inst.installation_id), _jsonable(inst))


async def hydrate_installations(db: Database) -> None:
    for data in await db.load_objects("installation"):
        try:
            inst = GitHubInstallationRequest(**data)
        except Exception:
            continue
        store.installations.setdefault(inst.installation_id, inst)


async def persist_repo(db: Database, repo: VerifiedRepo) -> None:
    await db.save_object("repo", repo.repo_id, _jsonable(repo))


async def hydrate_repos(db: Database) -> None:
    for data in await db.load_objects("repo"):
        try:
            repo = VerifiedRepo(**data)
        except Exception:
            continue
        store.repos.setdefault(repo.repo_id, repo)


async def persist_checkout(db: Database, checkout: CheckoutResponse) -> None:
    await db.save_object("checkout", checkout.checkout_id, _jsonable(checkout))


async def hydrate_checkout(db: Database, checkout_id: str) -> None:
    if checkout_id in store.checkouts:
        return
    data = await db.get_object("checkout", checkout_id)
    if data is None:
        return
    try:
        store.checkouts[checkout_id] = CheckoutResponse(**data)
    except Exception:
        pass


async def persist_evidence(db: Database, evidence: EvidenceRun) -> None:
    await db.save_object("evidence", evidence.evidence_id, _jsonable(evidence))


async def hydrate_evidence(db: Database) -> None:
    for data in await db.load_objects("evidence"):
        try:
            ev = EvidenceRun(**data)
        except Exception:
            continue
        store.evidence_runs.setdefault(ev.evidence_id, ev)


async def persist_report(db: Database, report: TrustReport) -> None:
    await db.save_object("report", report.report_id, _jsonable(report))


async def hydrate_report(db: Database, report_id: str) -> None:
    if report_id in store.reports:
        return
    data = await db.get_object("report", report_id)
    if data is None:
        return
    try:
        store.reports[report_id] = TrustReport(**data)
    except Exception:
        pass


async def persist_badge(db: Database, badge: VerifiedBadge) -> None:
    await db.save_object("badge", badge.badge_id, _jsonable(badge))


async def hydrate_badge(db: Database, badge_id: str) -> None:
    if badge_id in store.badges:
        return
    data = await db.get_object("badge", badge_id)
    if data is None:
        return
    try:
        store.badges[badge_id] = VerifiedBadge(**data)
    except Exception:
        pass


async def claim_checkout(db: Database, checkout_id: str) -> bool:
    """Atomically claim a paid checkout for report redemption. False if reused."""
    return await db.claim_object("consumed_checkout", checkout_id, {})


# ── Durable on-chain tx-hash replay protection ───────────────────────────────
# The in-memory store dedups within a single process; this DB-backed layer makes
# it correct across workers and serverless cold starts so one real transfer can
# never fund two escrows/orders/accounts on different instances.

async def tx_hash_consumed(db: Database, tx_hash: str) -> bool:
    """Fast-path read check (rejects obvious replays before doing on-chain work)."""
    return await db.get_object("consumed_tx", tx_hash) is not None


async def claim_tx_hash(db: Database, tx_hash: str, context: dict) -> bool:
    """Atomically claim a tx hash. Returns False if it was already claimed.

    This is the authoritative guard: the atomic insert closes the check-then-act
    race that a separate read+write would leave open under concurrency.
    """
    return await db.claim_object("consumed_tx", tx_hash, context)


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
