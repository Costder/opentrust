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
    UsageAccount,
    UsageEvent,
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
from ..schemas.jobs import (
    JobEngagement,
    JobEngageRequest,
    JobPosting,
    JobPostingRequest,
    JobStatus,
)
from ..schemas.reputation import (
    CounterpartyRating,
    CounterpartyRatingRequest,
    ReputationRecord,
    SubjectKind,
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
        self.usage_accounts: dict[str, UsageAccount] = {}
        self.usage_events: dict[str, UsageEvent] = {}
        self.reputation: dict[tuple[str, SubjectKind], ReputationRecord] = {}
        self.ratings: dict[str, CounterpartyRating] = {}
        self.jobs: dict[str, JobPosting] = {}

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
        # repo_id is optional: a listing may be backed by a verified repo, but a
        # general tool/service catalog does not require GitHub repo verification.
        if request.repo_id is not None and request.repo_id not in self.repos:
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
            pricing_model=request.pricing_model,
            unit_price_usdc=request.unit_price_usdc,
            unit_label=request.unit_label,
            min_topup_usdc=request.min_topup_usdc,
        )
        self.listings[listing.listing_id] = listing
        return listing

    # ── Usage-based (metered) billing ───────────────────────────────────────────

    def _unit_price(self, listing: MarketplaceListing) -> Decimal:
        """Per-unit price for a metered listing; falls back to price_usdc."""
        return listing.unit_price_usdc if listing.unit_price_usdc is not None else listing.price_usdc

    def fund_usage(self, listing_id: str, buyer_wallet_id: str, amount: Decimal) -> UsageAccount:
        """Credit a buyer's prepaid balance for a listing (creates account on first fund).

        On-chain verification of the funding transfer happens in the route; this
        records the credit. Same (buyer, listing) always maps to one account.
        """
        listing = self.listings.get(listing_id)
        if listing is None:
            raise KeyError("listing does not exist")
        if buyer_wallet_id not in self.wallets:
            raise KeyError("buyer wallet is not connected")

        now = datetime.now(timezone.utc).isoformat()
        existing = self._find_usage_account(listing_id, buyer_wallet_id)
        if existing is not None:
            existing.balance_usdc += amount
            existing.funded_total_usdc += amount
            existing.status = "active"
            existing.updated_at = now
            return existing

        account = UsageAccount(
            account_id=f"usage_{uuid4().hex}",
            listing_id=listing_id,
            buyer_wallet_id=buyer_wallet_id,
            seller_wallet_id=listing.seller_wallet_id,
            balance_usdc=amount,
            funded_total_usdc=amount,
            created_at=now,
            updated_at=now,
        )
        self.usage_accounts[account.account_id] = account
        return account

    def _find_usage_account(self, listing_id: str, buyer_wallet_id: str) -> UsageAccount | None:
        for a in self.usage_accounts.values():
            if a.listing_id == listing_id and a.buyer_wallet_id == buyer_wallet_id:
                return a
        return None

    def get_usage_account(self, account_id: str) -> UsageAccount | None:
        return self.usage_accounts.get(account_id)

    def find_usage_account(self, listing_id: str, buyer_wallet_id: str) -> UsageAccount | None:
        return self._find_usage_account(listing_id, buyer_wallet_id)

    def meter_usage(self, account_id: str, *, quantity: int, idempotency_key: str, note: str | None = None) -> dict:
        """Draw down a prepaid balance by quantity * unit price. Idempotent.

        Returns {allowed, amount_usdc, balance_after_usdc, reason?}. A repeated
        idempotency_key returns the prior result without charging again.
        """
        account = self.usage_accounts.get(account_id)
        if account is None:
            raise KeyError("usage account does not exist")

        # Idempotency: replay the prior event's outcome.
        for e in self.usage_events.values():
            if e.account_id == account_id and e.idempotency_key == idempotency_key:
                return {
                    "allowed": True,
                    "amount_usdc": e.amount_usdc,
                    "balance_after_usdc": e.balance_after_usdc,
                    "event_id": e.event_id,
                    "replayed": True,
                }

        listing = self.listings.get(account.listing_id)
        if listing is None:
            raise KeyError("listing does not exist")
        unit = self._unit_price(listing)
        amount = unit * quantity

        if account.balance_usdc < amount:
            return {
                "allowed": False,
                "reason": "insufficient_balance",
                "amount_usdc": amount,
                "balance_after_usdc": account.balance_usdc,
            }

        now = datetime.now(timezone.utc).isoformat()
        account.balance_usdc -= amount
        account.consumed_usdc += amount
        account.calls_count += 1
        account.units_count += quantity
        if account.balance_usdc <= Decimal("0"):
            account.status = "depleted"
        account.updated_at = now

        event = UsageEvent(
            event_id=f"event_{uuid4().hex}",
            account_id=account_id,
            listing_id=account.listing_id,
            quantity=quantity,
            amount_usdc=amount,
            balance_after_usdc=account.balance_usdc,
            idempotency_key=idempotency_key,
            note=note,
            created_at=now,
        )
        self.usage_events[event.event_id] = event
        return {
            "allowed": True,
            "amount_usdc": amount,
            "balance_after_usdc": account.balance_usdc,
            "event_id": event.event_id,
            "replayed": False,
        }

    def list_usage_events(self, account_id: str) -> list[UsageEvent]:
        return sorted(
            (e for e in self.usage_events.values() if e.account_id == account_id),
            key=lambda e: e.created_at,
        )

    def seller_earnings(self, seller_wallet_id: str) -> dict:
        accts = [a for a in self.usage_accounts.values() if a.seller_wallet_id == seller_wallet_id]
        return {
            "seller_wallet_id": seller_wallet_id,
            "accounts": len(accts),
            "funded_usdc": sum((a.funded_total_usdc for a in accts), Decimal("0")),
            "consumed_usdc": sum((a.consumed_usdc for a in accts), Decimal("0")),
            "outstanding_balance_usdc": sum((a.balance_usdc for a in accts), Decimal("0")),
        }

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
        if settings.opentrust_reputation_gate_enabled:
            seller_subject = listing.seller_passport_id or listing.seller_wallet_id
            rep = self.reputation.get((seller_subject, SubjectKind.server))
            if rep is not None and rep.deals_total >= 3 and rep.dispute_rate > 0.5:
                raise PermissionError("seller reputation indicates elevated dispute risk")

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
        self._accrue_outcome(escrow, "disputed")
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
        self._accrue_outcome(escrow, "released")
        self._complete_linked_job(escrow)
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
        self._accrue_outcome(escrow, "refunded")
        return escrow

    # ── Reputation ────────────────────────────────────────────────────────────

    def _subjects_for(self, escrow: EscrowRecord) -> list[tuple[str, SubjectKind]]:
        """Identity keys that accrue reputation from this escrow's outcome."""
        subjects = [
            (escrow.seller_passport_id or escrow.seller_wallet_id, SubjectKind.server),
            (escrow.buyer_wallet_id, SubjectKind.client),
        ]
        if escrow.agent_passport_id:
            subjects.append((escrow.agent_passport_id, SubjectKind.agent))
        return subjects

    def get_or_create_reputation(self, subject_id: str, subject_kind: SubjectKind) -> ReputationRecord:
        key = (subject_id, subject_kind)
        rec = self.reputation.get(key)
        if rec is None:
            rec = ReputationRecord(subject_id=subject_id, subject_kind=subject_kind)
            self.reputation[key] = rec
        return rec

    def get_reputation(
        self, subject_id: str, subject_kind: SubjectKind | None = None
    ) -> ReputationRecord | None:
        if subject_kind is not None:
            return self.reputation.get((subject_id, subject_kind))
        candidates = [rec for (sid, _kind), rec in self.reputation.items() if sid == subject_id]
        if not candidates:
            return None
        return max(candidates, key=lambda rec: rec.deals_total)

    def _accrue_outcome(self, escrow: EscrowRecord, outcome: str) -> None:
        """Accrue an escrow's terminal outcome to every involved party, once.

        The dispute signal takes precedence: an escrow disputed then refunded is
        counted once, as a dispute, so deals_total reflects the salient outcome.
        """
        if escrow.reputation_accrued:
            return
        amount = escrow.amount_usdc
        now = datetime.now(timezone.utc).isoformat()
        for subject_id, kind in self._subjects_for(escrow):
            rec = self.get_or_create_reputation(subject_id, kind)
            rec.deals_total += 1
            if outcome == "released":
                rec.deals_released += 1
                rec.settled_volume_usdc += amount
            elif outcome == "refunded":
                rec.deals_refunded += 1
            elif outcome == "disputed":
                rec.deals_disputed += 1
            rec.updated_at = now
        escrow.reputation_accrued = True

    def add_rating(self, escrow_id: str, request: CounterpartyRatingRequest) -> CounterpartyRating:
        escrow = self.escrows.get(escrow_id)
        if escrow is None:
            raise KeyError("escrow does not exist")
        if escrow.status not in {EscrowStatus.released, EscrowStatus.refunded}:
            raise ValueError("ratings are only allowed after the escrow settles")
        for existing in self.ratings.values():
            if existing.escrow_id == escrow_id and existing.rater_role == request.rater_role:
                raise ValueError("this party has already rated this escrow")
        if request.rater_role == "buyer":
            rater_id = escrow.buyer_wallet_id
            subject_id = escrow.seller_passport_id or escrow.seller_wallet_id
            subject_kind = SubjectKind.server
        else:  # seller rates the buyer
            rater_id = escrow.seller_passport_id or escrow.seller_wallet_id
            subject_id = escrow.buyer_wallet_id
            subject_kind = SubjectKind.client
        now = datetime.now(timezone.utc).isoformat()
        rating = CounterpartyRating(
            rating_id=f"rating_{uuid4().hex}",
            escrow_id=escrow_id,
            rater_role=request.rater_role,
            rater_id=rater_id,
            subject_id=subject_id,
            subject_kind=subject_kind,
            score=request.score,
            comment=request.comment,
            created_at=now,
        )
        self.ratings[rating.rating_id] = rating
        rec = self.get_or_create_reputation(subject_id, subject_kind)
        rec.rating_sum += request.score
        rec.rating_count += 1
        rec.updated_at = now
        return rating

    def list_ratings_for_escrow(self, escrow_id: str) -> list[CounterpartyRating]:
        return [r for r in self.ratings.values() if r.escrow_id == escrow_id]

    def list_ratings_for_subject(self, subject_id: str) -> list[CounterpartyRating]:
        return [r for r in self.ratings.values() if r.subject_id == subject_id]

    # ── Work venue (jobs) ───────────────────────────────────────────────────────

    def create_job(self, request: JobPostingRequest) -> JobPosting:
        if request.client_wallet_id not in self.wallets:
            raise KeyError("client wallet is not connected")
        job = JobPosting(
            job_id=f"job_{uuid4().hex}",
            client_wallet_id=request.client_wallet_id,
            title=request.title,
            description=request.description,
            budget_usdc=request.budget_usdc,
            provider_kind=request.provider_kind,
            client_passport_id=request.client_passport_id,
            delivery_proof=request.delivery_proof,
            min_provider_trust_score=request.min_provider_trust_score,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        self.jobs[job.job_id] = job
        return job

    def get_job(self, job_id: str) -> JobPosting | None:
        return self.jobs.get(job_id)

    def list_jobs(
        self,
        *,
        status: JobStatus | None = None,
        provider_kind=None,
        max_budget: Decimal | None = None,
    ) -> list[JobPosting]:
        jobs = list(self.jobs.values())
        if status is not None:
            jobs = [j for j in jobs if j.status == status]
        if provider_kind is not None:
            jobs = [j for j in jobs if j.provider_kind == provider_kind]
        if max_budget is not None:
            jobs = [j for j in jobs if j.budget_usdc <= max_budget]
        return jobs

    def cancel_job(self, job_id: str) -> JobPosting:
        job = self.jobs.get(job_id)
        if job is None:
            raise KeyError("job does not exist")
        if job.status != JobStatus.open:
            raise ValueError("only open jobs can be cancelled")
        job.status = JobStatus.cancelled
        return job

    def engage_job(
        self,
        job_id: str,
        request: JobEngageRequest,
        *,
        provider: MockEscrowProvider | None = None,
    ) -> JobEngagement:
        job = self.jobs.get(job_id)
        if job is None:
            raise KeyError("job does not exist")
        if job.status != JobStatus.open:
            raise ValueError("job is not open for engagement")
        if request.provider_wallet_id not in self.wallets:
            raise KeyError("provider wallet is not connected")
        if job.min_provider_trust_score is not None:
            subject = request.provider_passport_id or request.provider_wallet_id
            rep = self.reputation.get((subject, SubjectKind.server))
            score = rep.trust_score if rep else 0
            if score < job.min_provider_trust_score:
                raise PermissionError("provider reputation is below the job's required floor")

        # Reuse the escrow rail: synthesize a listing for this engagement, then
        # mint an escrow through the same code path marketplace orders use.
        listing = MarketplaceListing(
            listing_id=f"joblisting_{uuid4().hex}",
            seller_wallet_id=request.provider_wallet_id,
            repo_id=f"job:{job.job_id}",
            title=job.title,
            price_usdc=job.budget_usdc,
            provider_kind=job.provider_kind,
            seller_passport_id=request.provider_passport_id,
            seller_trust_level=request.provider_trust_level,
            seller_trust_status=request.provider_trust_status,
            escrow_required=True,
            delivery_proof=job.delivery_proof,
        )
        self.listings[listing.listing_id] = listing
        escrow = self.create_escrow(
            EscrowCreateRequest(
                listing_id=listing.listing_id,
                buyer_wallet_id=job.client_wallet_id,
                client_reference_id=job.job_id,
                agent_passport_id=request.agent_passport_id,
            ),
            token_contract=settings.base_usdc_contract,
            provider=provider,
        )
        job.status = JobStatus.engaged
        job.engaged_provider_wallet_id = request.provider_wallet_id
        job.engaged_provider_passport_id = request.provider_passport_id
        job.escrow_id = escrow.escrow_id
        return JobEngagement(job=job, escrow=escrow)

    def _complete_linked_job(self, escrow: EscrowRecord) -> None:
        ref = escrow.client_reference_id
        if ref and ref in self.jobs:
            job = self.jobs[ref]
            if job.escrow_id == escrow.escrow_id and job.status == JobStatus.engaged:
                job.status = JobStatus.completed

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
