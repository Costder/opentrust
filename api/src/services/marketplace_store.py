from decimal import Decimal
from uuid import uuid4

from api.src.config import settings
from api.src.schemas.marketplace import (
    CheckoutRequest,
    CheckoutResponse,
    EvidenceImportRequest,
    EvidenceRun,
    GitHubInstallationRequest,
    MarketplaceListing,
    MarketplaceListingRequest,
    MarketplaceOrder,
    MarketplaceOrderRequest,
    PaymentStatus,
    ProductCode,
    TrustReport,
    TrustReportRequest,
    VerifiedBadge,
    VerifiedRepo,
    VerifyRepoRequest,
    WalletAccount,
    WalletConnectRequest,
    WalletKind,
)


PRODUCT_PRICES = {
    ProductCode.trust_report: lambda: Decimal(settings.opentrust_price_trust_report_usdc),
    ProductCode.verified_badge: lambda: Decimal(settings.opentrust_price_verified_badge_usdc),
    ProductCode.monitoring_monthly: lambda: Decimal(settings.opentrust_price_monitoring_monthly_usdc),
}


class MarketplaceStore:
    def __init__(self) -> None:
        self.installations: dict[int, GitHubInstallationRequest] = {}
        self.repos: dict[str, VerifiedRepo] = {}
        self.checkouts: dict[str, CheckoutResponse] = {}
        self.wallets: dict[str, WalletAccount] = {}
        self.listings: dict[str, MarketplaceListing] = {}
        self.orders: dict[str, MarketplaceOrder] = {}
        self.evidence_runs: dict[str, EvidenceRun] = {}
        self.reports: dict[str, TrustReport] = {}
        self.badges: dict[str, VerifiedBadge] = {}

    def reset(self) -> None:
        self.__init__()

    def record_installation(self, request: GitHubInstallationRequest) -> GitHubInstallationRequest:
        self.installations[request.installation_id] = request
        return request

    def verify_repo(self, request: VerifyRepoRequest) -> VerifiedRepo:
        installation = self.installations.get(request.installation_id)
        if installation is None:
            raise KeyError("github installation has not been recorded")
        if request.repo_full_name not in installation.repos:
            raise PermissionError("repo is not available to this GitHub App installation")
        repo = VerifiedRepo(
            repo_id=f"repo_{uuid4().hex}",
            installation_id=request.installation_id,
            repo_full_name=request.repo_full_name,
            branch=request.branch,
            commit_sha=request.commit_sha,
        )
        self.repos[repo.repo_id] = repo
        return repo

    def create_checkout(self, request: CheckoutRequest) -> CheckoutResponse:
        if request.repo_id is not None and request.repo_id not in self.repos:
            raise KeyError("repo has not been verified")
        amount = PRODUCT_PRICES[request.product_code]()
        checkout_id = f"chk_{uuid4().hex}"
        checkout = CheckoutResponse(
            checkout_id=checkout_id,
            provider=settings.payment_provider or "mock",
            product_code=request.product_code,
            amount_usdc=amount,
            status=PaymentStatus.paid if (settings.payment_provider or "mock") == "mock" else PaymentStatus.created,
            checkout_url=f"https://mock.opentrust.local/checkouts/{checkout_id}",
        )
        self.checkouts[checkout_id] = checkout
        return checkout

    def connect_wallet(self, request: WalletConnectRequest) -> WalletAccount:
        if request.kind == WalletKind.embedded and not settings.opentrust_embedded_wallet_enabled:
            raise PermissionError("embedded wallets are disabled")
        if request.kind == WalletKind.byo and not settings.opentrust_byo_wallet_enabled:
            raise PermissionError("bring-your-own wallets are disabled")
        wallet = WalletAccount(
            wallet_id=f"wallet_{uuid4().hex}",
            owner=request.owner,
            address=request.address,
            kind=request.kind,
        )
        self.wallets[wallet.wallet_id] = wallet
        return wallet

    def create_listing(self, request: MarketplaceListingRequest) -> MarketplaceListing:
        if request.seller_wallet_id not in self.wallets:
            raise KeyError("seller wallet is not connected")
        if request.repo_id not in self.repos:
            raise KeyError("repo has not been verified")
        listing = MarketplaceListing(
            listing_id=f"listing_{uuid4().hex}",
            seller_wallet_id=request.seller_wallet_id,
            repo_id=request.repo_id,
            title=request.title,
            price_usdc=request.price_usdc,
        )
        self.listings[listing.listing_id] = listing
        return listing

    def create_order(self, request: MarketplaceOrderRequest) -> MarketplaceOrder:
        listing = self.listings.get(request.listing_id)
        if listing is None:
            raise KeyError("listing does not exist")
        if request.buyer_wallet_id not in self.wallets:
            raise KeyError("buyer wallet is not connected")
        order = MarketplaceOrder(
            order_id=f"order_{uuid4().hex}",
            listing_id=listing.listing_id,
            buyer_wallet_id=request.buyer_wallet_id,
            seller_wallet_id=listing.seller_wallet_id,
            amount_usdc=listing.price_usdc,
            transaction_hash=request.transaction_hash,
        )
        self.orders[order.order_id] = order
        return order

    def import_evidence(self, request: EvidenceImportRequest) -> EvidenceRun:
        if request.repo_id not in self.repos:
            raise KeyError("repo has not been verified")
        counts = request.severity_counts
        status = "fail" if counts.critical or counts.high else "pass"
        evidence = EvidenceRun(
            evidence_id=f"evidence_{uuid4().hex}",
            repo_id=request.repo_id,
            source=request.source,
            scanner_version=request.scanner_version,
            severity_counts=counts,
            status=status,
        )
        self.evidence_runs[evidence.evidence_id] = evidence
        return evidence

    def create_report(self, request: TrustReportRequest) -> TrustReport:
        if request.repo_id not in self.repos:
            raise KeyError("repo has not been verified")
        checkout = self.checkouts.get(request.checkout_id)
        if checkout is None:
            raise KeyError("checkout does not exist")
        if checkout.status != PaymentStatus.paid:
            raise PermissionError("checkout is not paid")
        evidence_count = sum(1 for item in self.evidence_runs.values() if item.repo_id == request.repo_id)
        status = "verified" if evidence_count else "verified_no_evidence"
        report = TrustReport(
            report_id=f"report_{uuid4().hex}",
            repo_id=request.repo_id,
            checkout_id=request.checkout_id,
            status=status,
            summary="OpenTrust verified repo ownership and attached automated evidence summaries.",
            evidence_count=evidence_count,
        )
        self.reports[report.report_id] = report
        if checkout.product_code == ProductCode.verified_badge:
            badge = VerifiedBadge(
                badge_id=f"badge_{uuid4().hex}",
                repo_id=request.repo_id,
                report_id=report.report_id,
                status=status,
            )
            self.badges[badge.badge_id] = badge
        return report


store = MarketplaceStore()
