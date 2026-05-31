from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

from ..config import settings
from ..schemas.marketplace import (
    CheckoutRequest,
    CheckoutResponse,
    EvidenceImportRequest,
    EvidenceRun,
    EscrowCreateRequest,
    EscrowDepositInstructions,
    EscrowRecord,
    EscrowStatus,
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
from .escrow_provider import MockEscrowProvider, get_escrow_provider


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
        self.escrows: dict[str, EscrowRecord] = {}
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
            provider_kind=request.provider_kind,
            seller_passport_id=request.seller_passport_id,
            seller_trust_level=request.seller_trust_level,
            seller_trust_status=request.seller_trust_status,
            escrow_required=request.escrow_required,
            delivery_proof=request.delivery_proof,
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
            escrow_id=request.escrow_id,
            custody="escrow" if request.escrow_id else "none",
        )
        self.orders[order.order_id] = order
        return order

    def create_escrow(
        self,
        request: EscrowCreateRequest,
        *,
        token_contract: str,
        provider: MockEscrowProvider | None = None,
    ) -> EscrowRecord:
        listing = self.listings.get(request.listing_id)
        if listing is None:
            raise KeyError("listing does not exist")
        if request.buyer_wallet_id not in self.wallets:
            raise KeyError("buyer wallet is not connected")
        if listing.seller_wallet_id not in self.wallets:
            raise KeyError("seller wallet is not connected")
        if listing.delivery_proof is None:
            raise ValueError("delivery proof is required for escrow")
        if listing.seller_trust_status == "disputed":
            raise PermissionError("seller passport is disputed")
        if listing.seller_trust_level is None or listing.seller_trust_level < 3:
            raise PermissionError("seller trust level must be 3 or higher")

        escrow_provider = provider or get_escrow_provider()
        escrow_id = f"escrow_{uuid4().hex}"
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=30)
        escrow = EscrowRecord(
            escrow_id=escrow_id,
            listing_id=listing.listing_id,
            buyer_wallet_id=request.buyer_wallet_id,
            seller_wallet_id=listing.seller_wallet_id,
            seller_passport_id=listing.seller_passport_id,
            amount_usdc=listing.price_usdc,
            status=EscrowStatus.created,
            deposit=EscrowDepositInstructions(
                token_contract=token_contract,
                recipient_address=escrow_provider.deposit_address(escrow_id),
                amount_usdc=listing.price_usdc,
                expires_at=expires_at.isoformat(),
            ),
            delivery_proof=listing.delivery_proof,
            client_reference_id=request.client_reference_id,
            agent_passport_id=request.agent_passport_id,
        )
        self.escrows[escrow.escrow_id] = escrow
        return escrow

    def verify_escrow_deposit(self, escrow_id: str, tx_hash: str) -> EscrowRecord:
        escrow = self.escrows.get(escrow_id)
        if escrow is None:
            raise KeyError("escrow does not exist")
        if escrow.status != EscrowStatus.created:
            raise ValueError("escrow deposit can only be verified while created")
        escrow.status = EscrowStatus.funded
        escrow.funding_tx_hash = tx_hash
        return escrow

    def mark_escrow_delivered(
        self,
        escrow_id: str,
        *,
        result_hash: str | None,
        artifact_uri: str | None,
    ) -> EscrowRecord:
        escrow = self.escrows.get(escrow_id)
        if escrow is None:
            raise KeyError("escrow does not exist")
        if escrow.status != EscrowStatus.funded:
            raise ValueError("escrow must be funded before delivery")
        if escrow.delivery_proof.result_hash_required and not result_hash:
            raise ValueError("result_hash is required for this escrow")
        now = datetime.now(timezone.utc)
        escrow.status = EscrowStatus.delivered
        escrow.delivered_at = now.isoformat()
        escrow.result_hash = result_hash
        escrow.artifact_uri = artifact_uri
        escrow.release_available_at = (now + timedelta(seconds=escrow.delivery_proof.timeout_seconds)).isoformat()
        return escrow

    def mark_escrow_disputed(self, escrow_id: str, reason: str) -> EscrowRecord:
        escrow = self.escrows.get(escrow_id)
        if escrow is None:
            raise KeyError("escrow does not exist")
        if escrow.status not in {EscrowStatus.funded, EscrowStatus.delivered}:
            raise ValueError("escrow can only be disputed after funding")
        escrow.status = EscrowStatus.disputed
        escrow.dispute_reason = reason
        return escrow

    def release_escrow(self, escrow_id: str, *, provider: MockEscrowProvider | None = None) -> EscrowRecord:
        escrow = self.escrows.get(escrow_id)
        if escrow is None:
            raise KeyError("escrow does not exist")
        if escrow.status != EscrowStatus.delivered:
            raise ValueError("escrow must be delivered before release")
        escrow.status = EscrowStatus.release_pending
        result = (provider or get_escrow_provider()).release_funds(escrow_id)
        escrow.status = EscrowStatus.released
        escrow.settlement_tx_hash = result.transaction_hash
        return escrow

    def refund_escrow(self, escrow_id: str, *, provider: MockEscrowProvider | None = None) -> EscrowRecord:
        escrow = self.escrows.get(escrow_id)
        if escrow is None:
            raise KeyError("escrow does not exist")
        if escrow.status not in {EscrowStatus.funded, EscrowStatus.disputed}:
            raise ValueError("escrow can only be refunded after funding or dispute")
        escrow.status = EscrowStatus.refund_pending
        result = (provider or get_escrow_provider()).refund_buyer(escrow_id)
        escrow.status = EscrowStatus.refunded
        escrow.refund_tx_hash = result.transaction_hash
        return escrow

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
