"""Work venue (job board) tests.

A client posts work wanted; a provider engages it; engaging mints an escrow
(reusing the escrow rail verbatim); settling the escrow completes the job and
accrues two-way reputation. Store-level + API-level.
"""
import pytest

from api.src.schemas.jobs import JobEngageRequest, JobPostingRequest, JobStatus
from api.src.schemas.marketplace import DeliveryProofRequirement, WalletConnectRequest
from api.src.schemas.reputation import SubjectKind
from api.src.services.escrow_provider import MockEscrowProvider
from api.src.services.marketplace_store import store

CLIENT_ADDRESS = "0x" + "1" * 40
PROVIDER_ADDRESS = "0x" + "2" * 40
DEPOSIT_TX = "0x" + "a" * 64


@pytest.fixture(autouse=True)
def reset_store():
    store.reset()
    yield
    store.reset()


def _connect():
    client = store.connect_wallet(WalletConnectRequest(owner="client", address=CLIENT_ADDRESS, kind="byo"))
    provider = store.connect_wallet(WalletConnectRequest(owner="provider", address=PROVIDER_ADDRESS, kind="byo"))
    return client, provider


def _proof():
    return DeliveryProofRequirement(
        type="http_endpoint",
        standard="opentrust/delivery-proof@v1",
        timeout_seconds=3600,
        result_hash_required=False,
    )


def _post_job(client, *, budget="25.00", provider_kind="agent_service", min_score=None):
    return store.create_job(
        JobPostingRequest(
            client_wallet_id=client.wallet_id,
            title="Summarize 100 PDFs",
            description="Need an agent to summarize a corpus.",
            budget_usdc=budget,
            provider_kind=provider_kind,
            delivery_proof=_proof(),
            min_provider_trust_score=min_score,
        )
    )


def _engage(job, provider):
    return store.engage_job(
        job.job_id,
        JobEngageRequest(
            provider_wallet_id=provider.wallet_id,
            provider_trust_level=5,
            provider_trust_status="seller_confirmed",
            agent_passport_id="passport_agent_42",
        ),
    )


# ── Lifecycle ───────────────────────────────────────────────────────────────────

def test_post_job_is_open():
    client, _ = _connect()
    job = _post_job(client)
    assert job.status == JobStatus.open
    assert job.escrow_id is None


def test_engage_creates_escrow_and_marks_engaged():
    client, provider = _connect()
    job = _post_job(client)
    result = _engage(job, provider)
    assert result.job.status == JobStatus.engaged
    assert result.escrow.escrow_id is not None
    assert result.job.escrow_id == result.escrow.escrow_id
    # escrow inherits job economics
    assert str(result.escrow.amount_usdc) == "25.00"
    assert result.escrow.seller_wallet_id == provider.wallet_id
    assert result.escrow.buyer_wallet_id == client.wallet_id


def test_full_flow_completes_job_and_accrues_two_way_reputation():
    client, provider = _connect()
    job = _post_job(client)
    result = _engage(job, provider)
    escrow_id = result.escrow.escrow_id

    store.verify_escrow_deposit(escrow_id, DEPOSIT_TX)
    store.mark_escrow_delivered(escrow_id, result_hash=None, artifact_uri=None)
    store.release_escrow(escrow_id, provider=MockEscrowProvider())

    job_after = store.get_job(job.job_id)
    assert job_after.status == JobStatus.completed

    provider_rep = store.get_reputation(provider.wallet_id, SubjectKind.server)
    client_rep = store.get_reputation(client.wallet_id, SubjectKind.client)
    agent_rep = store.get_reputation("passport_agent_42", SubjectKind.agent)
    assert provider_rep.deals_released == 1
    assert client_rep.deals_released == 1
    assert agent_rep.deals_released == 1


def test_cancel_open_job():
    client, _ = _connect()
    job = _post_job(client)
    cancelled = store.cancel_job(job.job_id)
    assert cancelled.status == JobStatus.cancelled


def test_cannot_cancel_engaged_job():
    client, provider = _connect()
    job = _post_job(client)
    _engage(job, provider)
    with pytest.raises(ValueError):
        store.cancel_job(job.job_id)


def test_cannot_engage_twice():
    client, provider = _connect()
    job = _post_job(client)
    _engage(job, provider)
    with pytest.raises(ValueError):
        _engage(job, provider)


def test_reputation_floor_blocks_low_score_provider():
    client, provider = _connect()
    # Give the provider a poor reputation: 4 deals, 3 disputed.
    rep = store.get_or_create_reputation(provider.wallet_id, SubjectKind.server)
    rep.deals_total = 4
    rep.deals_released = 1
    rep.deals_disputed = 3
    job = _post_job(client, min_score=50)
    with pytest.raises(PermissionError):
        _engage(job, provider)


# ── API surface ──────────────────────────────────────────────────────────────────

from fastapi.testclient import TestClient  # noqa: E402

from api.src.main import app  # noqa: E402

api = TestClient(app)


def _job_payload(client):
    return {
        "client_wallet_id": client.wallet_id,
        "title": "Build a scraper",
        "description": "Need a tool to scrape listings.",
        "budget_usdc": "25.00",
        "provider_kind": "tool",
        "delivery_proof": {
            "type": "http_endpoint",
            "standard": "opentrust/delivery-proof@v1",
            "timeout_seconds": 3600,
            "result_hash_required": False,
        },
    }


def test_api_post_and_list_jobs():
    client, _ = _connect()
    resp = api.post("/api/v1/jobs", json=_job_payload(client), headers=_auth(client.wallet_id))
    assert resp.status_code == 200
    job_id = resp.json()["job_id"]
    listing = api.get("/api/v1/jobs")
    assert listing.status_code == 200
    assert any(j["job_id"] == job_id for j in listing.json())


def test_api_filter_jobs_by_provider_kind():
    client, _ = _connect()
    api.post("/api/v1/jobs", json=_job_payload(client), headers=_auth(client.wallet_id))
    resp = api.get("/api/v1/jobs?provider_kind=agent_service")
    assert resp.status_code == 200
    assert resp.json() == []


from api.src.middleware.auth import mint_wallet_token  # noqa: E402


def _auth(wallet_id: str) -> dict:
    return {"Authorization": f"Bearer {mint_wallet_token(wallet_id)}"}


def test_api_cancel_requires_job_owner():
    client, other = _connect()
    job_id = api.post("/api/v1/jobs", json=_job_payload(client), headers=_auth(client.wallet_id)).json()["job_id"]

    # Unauthenticated callers are rejected.
    assert api.post(f"/api/v1/jobs/{job_id}/cancel").status_code == 401
    # A non-owner wallet cannot cancel someone else's job.
    forbidden = api.post(f"/api/v1/jobs/{job_id}/cancel", headers=_auth(other.wallet_id))
    assert forbidden.status_code == 403
    # The job creator can cancel.
    ok = api.post(f"/api/v1/jobs/{job_id}/cancel", headers=_auth(client.wallet_id))
    assert ok.status_code == 200
    assert ok.json()["status"] == "cancelled"


def test_api_engage_returns_job_and_escrow(monkeypatch):
    from api.src.config import settings

    monkeypatch.setattr(settings, "opentrust_escrow_enabled", True)
    client, provider = _connect()
    job_id = api.post("/api/v1/jobs", json=_job_payload(client), headers=_auth(client.wallet_id)).json()["job_id"]
    resp = api.post(
        f"/api/v1/jobs/{job_id}/engage",
        json={
            "provider_wallet_id": provider.wallet_id,
            "provider_trust_level": 5,
            "provider_trust_status": "seller_confirmed",
        },
        headers=_auth(provider.wallet_id),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["job"]["status"] == "engaged"
    assert body["escrow"]["escrow_id"]
