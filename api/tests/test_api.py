import pytest
from fastapi import HTTPException
from api.src.main import health
from api.src.routes.payments import checkout, create_subscription, verify
from api.src.routes.github_app import list_installed_repos, record_installation, verify_repo, verify_repo_alias
from api.src.routes.marketplace import (
    connect_wallet,
    create_coinbase_checkout,
    create_listing,
    create_order,
    create_report,
    get_badge_alias,
    import_evidence,
)
from api.src.schemas.marketplace import (
    CheckoutRequest,
    EvidenceImportRequest,
    GitHubInstallationRequest,
    MarketplaceListingRequest,
    MarketplaceOrderRequest,
    PaymentVerificationRequest,
    ProductCode,
    SeverityCounts,
    TrustReportRequest,
    VerifyRepoRequest,
    WalletConnectRequest,
)
from api.src.services.marketplace_store import store


@pytest.mark.asyncio
async def test_health():
    assert (await health())["status"] == "ok"


@pytest.mark.asyncio
async def test_public_demo_payment_checkout_and_verify():
    store.reset()
    payment = await checkout(CheckoutRequest(product_code=ProductCode.trust_report))
    assert payment.provider == "mock"
    assert payment.status == "paid"
    verified = await verify(PaymentVerificationRequest(checkout_id=payment.checkout_id))
    assert verified.verified is True
    assert verified.amount_usdc == payment.amount_usdc


@pytest.mark.asyncio
async def test_public_demo_subscription_checkout():
    store.reset()
    payment = await create_subscription()
    assert payment.product_code == ProductCode.monitoring_monthly
    assert payment.status == "paid"


@pytest.mark.asyncio
async def test_mock_verified_badge_flow_without_live_secrets():
    store.reset()
    await record_installation(
        GitHubInstallationRequest(
            installation_id=123,
            account="octo",
            repos=["octo/tool"],
        )
    )
    repo = await verify_repo(
        VerifyRepoRequest(
            installation_id=123,
            repo_full_name="octo/tool",
            branch="main",
            commit_sha="abc1234567",
        )
    )
    checkout_response = await create_coinbase_checkout(
        CheckoutRequest(product_code=ProductCode.verified_badge, repo_id=repo.repo_id)
    )
    assert checkout_response.status == "paid"
    evidence = await import_evidence(
        EvidenceImportRequest(
            repo_id=repo.repo_id,
            source="github_code_scanning",
            severity_counts=SeverityCounts(low=1),
        )
    )
    assert evidence.status == "pass"
    report = await create_report(TrustReportRequest(repo_id=repo.repo_id, checkout_id=checkout_response.checkout_id))
    assert report.status == "verified"
    assert report.evidence_count == 1
    assert len(store.badges) == 1
    badge = await get_badge_alias(next(iter(store.badges)))
    assert badge.report_id == report.report_id


@pytest.mark.asyncio
async def test_repo_verification_rejects_uninstalled_repo():
    store.reset()
    await record_installation(GitHubInstallationRequest(installation_id=123, account="octo", repos=["octo/tool"]))
    with pytest.raises(HTTPException) as exc:
        await verify_repo(
            VerifyRepoRequest(
                installation_id=123,
                repo_full_name="other/tool",
                branch="main",
                commit_sha="abc1234567",
            )
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_documented_github_repo_routes_have_mock_behavior():
    store.reset()
    await record_installation(GitHubInstallationRequest(installation_id=123, account="octo", repos=["octo/tool"]))
    repos = await list_installed_repos()
    assert repos["repos"][0]["repo_full_name"] == "octo/tool"
    repo = await verify_repo_alias(
        "octo/tool",
        VerifyRepoRequest(installation_id=123, repo_full_name="octo/tool", branch="main", commit_sha="abc1234567"),
    )
    assert repo.repo_full_name == "octo/tool"


@pytest.mark.asyncio
async def test_marketplace_order_uses_customer_wallets_without_custody():
    store.reset()
    await record_installation(GitHubInstallationRequest(installation_id=123, account="octo", repos=["octo/tool"]))
    repo = await verify_repo(
        VerifyRepoRequest(installation_id=123, repo_full_name="octo/tool", branch="main", commit_sha="abc1234567")
    )
    seller = await connect_wallet(
        WalletConnectRequest(owner="seller", address="0x1111111111111111111111111111111111111111")
    )
    buyer = await connect_wallet(
        WalletConnectRequest(owner="buyer", address="0x2222222222222222222222222222222222222222")
    )
    listing = await create_listing(
        MarketplaceListingRequest(
            seller_wallet_id=seller.wallet_id,
            repo_id=repo.repo_id,
            title="Verified automation package",
            price_usdc="12.50",
        )
    )
    order = await create_order(
        MarketplaceOrderRequest(
            listing_id=listing.listing_id,
            buyer_wallet_id=buyer.wallet_id,
            transaction_hash="0xabc",
        )
    )
    assert order.seller_wallet_id == seller.wallet_id
    assert order.custody == "none"
