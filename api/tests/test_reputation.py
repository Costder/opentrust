"""Reputation accrual, scoring, and bidirectional rating tests.

Reputation is registry-computed from escrow terminal outcomes the registry
observed (release / refund / dispute) plus bidirectional counterparty ratings.
Store-level tests here; API-level read surface is covered separately.
"""
from decimal import Decimal

import pytest

from api.src.schemas.marketplace import (
    DeliveryProofRequirement,
    EscrowCreateRequest,
    MarketplaceListingRequest,
    VerifiedRepo,
    WalletConnectRequest,
)
from api.src.schemas.reputation import (
    CounterpartyRatingRequest,
    ReputationRecord,
    SubjectKind,
)
from api.src.services.escrow_provider import MockEscrowProvider
from api.src.services.marketplace_store import store

BUYER_ADDRESS = "0x" + "1" * 40
SELLER_ADDRESS = "0x" + "2" * 40
DEPOSIT_TX = "0x" + "a" * 64


@pytest.fixture(autouse=True)
def reset_store():
    store.reset()
    yield
    store.reset()


def _connect_wallets():
    buyer = store.connect_wallet(WalletConnectRequest(owner="buyer", address=BUYER_ADDRESS, kind="byo"))
    seller = store.connect_wallet(WalletConnectRequest(owner="seller", address=SELLER_ADDRESS, kind="byo"))
    return buyer, seller


def _seed_repo():
    store.repos["repo_test"] = VerifiedRepo(
        repo_id="repo_test",
        installation_id=1,
        repo_full_name="acme/tool",
        branch="main",
        commit_sha="abc1234",
    )


def _create_listing(seller, *, price="10.00"):
    _seed_repo()
    return store.create_listing(
        MarketplaceListingRequest(
            seller_wallet_id=seller.wallet_id,
            repo_id="repo_test",
            title="Test Tool",
            price_usdc=price,
            provider_kind="tool",
            seller_trust_level=5,
            seller_trust_status="seller_confirmed",
            escrow_required=True,
            delivery_proof=DeliveryProofRequirement(
                type="http_endpoint",
                standard="opentrust/delivery-proof@v1",
                timeout_seconds=3600,
                result_hash_required=False,
            ),
        )
    )


def _funded_escrow(buyer, listing):
    escrow = store.create_escrow(
        EscrowCreateRequest(listing_id=listing.listing_id, buyer_wallet_id=buyer.wallet_id),
        token_contract="0x" + "f" * 40,
        provider=MockEscrowProvider(),
    )
    store.verify_escrow_deposit(escrow.escrow_id, DEPOSIT_TX)
    return escrow


def _delivered_escrow(buyer, listing):
    escrow = _funded_escrow(buyer, listing)
    store.mark_escrow_delivered(escrow.escrow_id, result_hash=None, artifact_uri=None)
    return escrow


# ── Accrual ───────────────────────────────────────────────────────────────────

def test_release_accrues_seller_and_client_reputation():
    buyer, seller = _connect_wallets()
    listing = _create_listing(seller)
    escrow = _delivered_escrow(buyer, listing)

    store.release_escrow(escrow.escrow_id, provider=MockEscrowProvider())

    seller_rep = store.get_reputation(seller.wallet_id, SubjectKind.server)
    client_rep = store.get_reputation(buyer.wallet_id, SubjectKind.client)
    assert seller_rep.deals_released == 1
    assert seller_rep.deals_total == 1
    assert seller_rep.settled_volume_usdc == Decimal("10.00")
    assert client_rep.deals_released == 1
    assert client_rep.deals_total == 1


def test_refund_accrues_refunded_outcome():
    buyer, seller = _connect_wallets()
    listing = _create_listing(seller)
    escrow = _funded_escrow(buyer, listing)

    store.refund_escrow(escrow.escrow_id, provider=MockEscrowProvider())

    seller_rep = store.get_reputation(seller.wallet_id, SubjectKind.server)
    assert seller_rep.deals_refunded == 1
    assert seller_rep.deals_released == 0
    assert seller_rep.deals_total == 1


def test_dispute_takes_precedence_and_counts_once():
    buyer, seller = _connect_wallets()
    listing = _create_listing(seller)
    escrow = _funded_escrow(buyer, listing)

    store.mark_escrow_disputed(escrow.escrow_id, "did not deliver")
    store.refund_escrow(escrow.escrow_id, provider=MockEscrowProvider())  # resolves dispute

    seller_rep = store.get_reputation(seller.wallet_id, SubjectKind.server)
    assert seller_rep.deals_disputed == 1
    assert seller_rep.deals_refunded == 0  # dispute already accounted this escrow
    assert seller_rep.deals_total == 1  # counted exactly once


def test_agent_reputation_accrues_when_present():
    buyer, seller = _connect_wallets()
    listing = _create_listing(seller)
    escrow = store.create_escrow(
        EscrowCreateRequest(
            listing_id=listing.listing_id,
            buyer_wallet_id=buyer.wallet_id,
            agent_passport_id="passport_agent_007",
        ),
        token_contract="0x" + "f" * 40,
        provider=MockEscrowProvider(),
    )
    store.verify_escrow_deposit(escrow.escrow_id, DEPOSIT_TX)
    store.mark_escrow_delivered(escrow.escrow_id, result_hash=None, artifact_uri=None)
    store.release_escrow(escrow.escrow_id, provider=MockEscrowProvider())

    agent_rep = store.get_reputation("passport_agent_007", SubjectKind.agent)
    assert agent_rep.deals_released == 1


# ── Trust score formula (pure) ─────────────────────────────────────────────────

def test_trust_score_new_subject_is_zero_and_tier_new():
    rec = ReputationRecord(subject_id="x", subject_kind=SubjectKind.server)
    assert rec.trust_score == 0
    assert rec.tier == "new"
    assert rec.avg_rating is None
    assert rec.dispute_rate == 0.0


def test_trust_score_all_released_is_high():
    rec = ReputationRecord(
        subject_id="x", subject_kind=SubjectKind.server,
        deals_total=5, deals_released=5,
    )
    assert rec.trust_score == 100
    assert rec.tier == "gold"


def test_trust_score_disputes_drag_down():
    rec = ReputationRecord(
        subject_id="x", subject_kind=SubjectKind.server,
        deals_total=4, deals_released=2, deals_disputed=2,
    )
    # base = 50, penalty = 40*0.5 = 20 -> 30
    assert rec.trust_score == 30
    # released >= 1 but score < 60 -> bronze
    assert rec.tier == "bronze"


def test_rating_adjusts_score():
    rec = ReputationRecord(
        subject_id="x", subject_kind=SubjectKind.server,
        deals_total=2, deals_released=2, rating_sum=10, rating_count=2,
    )
    # base 100, rating_adj = (5-3)*10 = 20 -> clamp 100
    assert rec.avg_rating == 5.0
    assert rec.trust_score == 100
    assert rec.tier == "silver"  # released==2, score>=60


# ── Bidirectional ratings ──────────────────────────────────────────────────────

def test_buyer_rates_seller_after_release():
    buyer, seller = _connect_wallets()
    listing = _create_listing(seller)
    escrow = _delivered_escrow(buyer, listing)
    store.release_escrow(escrow.escrow_id, provider=MockEscrowProvider())

    rating = store.add_rating(
        escrow.escrow_id,
        CounterpartyRatingRequest(rater_role="buyer", score=5, comment="great"),
    )
    assert rating.subject_id == seller.wallet_id
    assert rating.subject_kind == SubjectKind.server
    seller_rep = store.get_reputation(seller.wallet_id, SubjectKind.server)
    assert seller_rep.rating_count == 1
    assert seller_rep.avg_rating == 5.0


def test_seller_rates_buyer_after_release():
    buyer, seller = _connect_wallets()
    listing = _create_listing(seller)
    escrow = _delivered_escrow(buyer, listing)
    store.release_escrow(escrow.escrow_id, provider=MockEscrowProvider())

    rating = store.add_rating(
        escrow.escrow_id,
        CounterpartyRatingRequest(rater_role="seller", score=4),
    )
    assert rating.subject_id == buyer.wallet_id
    assert rating.subject_kind == SubjectKind.client


def test_rating_rejected_before_terminal_state():
    buyer, seller = _connect_wallets()
    listing = _create_listing(seller)
    escrow = _funded_escrow(buyer, listing)  # funded, not terminal
    with pytest.raises(ValueError):
        store.add_rating(
            escrow.escrow_id,
            CounterpartyRatingRequest(rater_role="buyer", score=5),
        )


def test_double_rating_same_role_rejected():
    buyer, seller = _connect_wallets()
    listing = _create_listing(seller)
    escrow = _delivered_escrow(buyer, listing)
    store.release_escrow(escrow.escrow_id, provider=MockEscrowProvider())
    store.add_rating(escrow.escrow_id, CounterpartyRatingRequest(rater_role="buyer", score=5))
    with pytest.raises(ValueError):
        store.add_rating(escrow.escrow_id, CounterpartyRatingRequest(rater_role="buyer", score=1))


def test_list_ratings_for_escrow():
    buyer, seller = _connect_wallets()
    listing = _create_listing(seller)
    escrow = _delivered_escrow(buyer, listing)
    store.release_escrow(escrow.escrow_id, provider=MockEscrowProvider())
    store.add_rating(escrow.escrow_id, CounterpartyRatingRequest(rater_role="buyer", score=5))
    store.add_rating(escrow.escrow_id, CounterpartyRatingRequest(rater_role="seller", score=4))
    ratings = store.list_ratings_for_escrow(escrow.escrow_id)
    assert len(ratings) == 2


# ── API surface ────────────────────────────────────────────────────────────────

from fastapi.testclient import TestClient  # noqa: E402

from api.src.main import app  # noqa: E402

api = TestClient(app)


def _released_escrow():
    buyer, seller = _connect_wallets()
    listing = _create_listing(seller)
    escrow = _delivered_escrow(buyer, listing)
    store.release_escrow(escrow.escrow_id, provider=MockEscrowProvider())
    return buyer, seller, escrow


def test_api_post_rating_returns_rating():
    buyer, seller, escrow = _released_escrow()
    resp = api.post(
        f"/api/v1/escrow/{escrow.escrow_id}/ratings",
        json={"rater_role": "buyer", "score": 5, "comment": "great"},
    )
    assert resp.status_code == 200
    assert resp.json()["subject_id"] == seller.wallet_id
    assert resp.json()["subject_kind"] == "server"


def test_api_post_rating_before_terminal_is_409():
    buyer, seller = _connect_wallets()
    listing = _create_listing(seller)
    escrow = _funded_escrow(buyer, listing)
    resp = api.post(
        f"/api/v1/escrow/{escrow.escrow_id}/ratings",
        json={"rater_role": "buyer", "score": 5},
    )
    assert resp.status_code == 409


def test_api_get_escrow_ratings():
    buyer, seller, escrow = _released_escrow()
    api.post(f"/api/v1/escrow/{escrow.escrow_id}/ratings", json={"rater_role": "buyer", "score": 5})
    resp = api.get(f"/api/v1/escrow/{escrow.escrow_id}/ratings")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_api_get_reputation():
    buyer, seller, escrow = _released_escrow()
    resp = api.get(f"/api/v1/reputation/{seller.wallet_id}?kind=server")
    assert resp.status_code == 200
    body = resp.json()
    assert body["deals_released"] == 1
    assert body["trust_score"] == 100
    assert body["tier"] == "bronze"


def test_api_get_reputation_not_found():
    resp = api.get("/api/v1/reputation/nobody?kind=server")
    assert resp.status_code == 404


def test_api_get_reputation_ratings():
    buyer, seller, escrow = _released_escrow()
    api.post(f"/api/v1/escrow/{escrow.escrow_id}/ratings", json={"rater_role": "buyer", "score": 5})
    resp = api.get(f"/api/v1/reputation/{seller.wallet_id}/ratings")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
