from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, Field, field_validator


class ProductCode(str, Enum):
    trust_report = "trust_report"
    verified_badge = "verified_badge"
    monitoring_monthly = "monitoring_monthly"


class PaymentStatus(str, Enum):
    created = "created"
    paid = "paid"
    failed = "failed"
    expired = "expired"


class WalletKind(str, Enum):
    byo = "byo"
    embedded = "embedded"


class ProviderKind(str, Enum):
    mcp_server = "mcp_server"
    skill = "skill"
    tool = "tool"
    agent_service = "agent_service"
    human_service = "human_service"


class PricingModel(str, Enum):
    flat = "flat"                # one-time price per purchase (default)
    per_call = "per_call"        # price per call
    per_token = "per_token"      # price per 1k tokens
    per_unit = "per_unit"        # price per seller-defined unit
    subscription = "subscription"  # price per period


class EscrowStatus(str, Enum):
    created = "created"
    funded = "funded"
    delivered = "delivered"
    disputed = "disputed"
    release_pending = "release_pending"
    released = "released"
    refund_pending = "refund_pending"
    refunded = "refunded"
    expired = "expired"
    cancelled = "cancelled"


class EvidenceSource(str, Enum):
    github_code_scanning = "github_code_scanning"
    github_dependabot = "github_dependabot"
    sarif = "sarif"
    socket = "socket"
    aikido = "aikido"
    semgrep = "semgrep"
    snyk = "snyk"


class SeverityCounts(BaseModel):
    critical: int = Field(default=0, ge=0)
    high: int = Field(default=0, ge=0)
    medium: int = Field(default=0, ge=0)
    low: int = Field(default=0, ge=0)
    info: int = Field(default=0, ge=0)


class GitHubInstallationRequest(BaseModel):
    installation_id: int = Field(gt=0)
    account: str = Field(min_length=1)
    repos: list[str] = Field(min_length=1)


class VerifyRepoRequest(BaseModel):
    installation_id: int = Field(gt=0)
    repo_full_name: str = Field(pattern=r"^[^/\s]+/[^/\s]+$")
    branch: str = Field(default="main", min_length=1)
    commit_sha: str = Field(min_length=7)


class VerifiedRepo(BaseModel):
    repo_id: str
    installation_id: int
    repo_full_name: str
    branch: str
    commit_sha: str
    verified: bool = True


class CheckoutRequest(BaseModel):
    product_code: ProductCode
    repo_id: str | None = None


class CheckoutResponse(BaseModel):
    checkout_id: str
    provider: str
    product_code: ProductCode
    amount_usdc: Decimal
    status: PaymentStatus
    checkout_url: str


class PaymentVerificationRequest(BaseModel):
    checkout_id: str


class PaymentVerificationResponse(BaseModel):
    checkout_id: str
    verified: bool
    status: PaymentStatus
    amount_usdc: Decimal
    provider: str


class WalletConnectRequest(BaseModel):
    owner: str = Field(min_length=1)
    address: str = Field(min_length=1)
    kind: WalletKind = WalletKind.byo
    # EIP-191 signature of the canonical ownership-proof message. Required to be
    # issued a party session token; absent → wallet is registered without one.
    signature: str | None = None

    @field_validator("address")
    @classmethod
    def validate_evm_address(cls, value: str) -> str:
        if not value.startswith("0x") or len(value) != 42:
            raise ValueError("wallet address must be a 42-character EVM address")
        int(value[2:], 16)
        return value


class WalletAccount(BaseModel):
    wallet_id: str
    owner: str
    address: str
    kind: WalletKind
    custody: str = "customer"


class WalletConnectResponse(WalletAccount):
    # Party session token, present only when wallet ownership was proven (connect
    # with a valid signature) or the registry owns the key (generated wallet).
    session_token: str | None = None


class DeliveryProofRequirement(BaseModel):
    type: str = Field(min_length=1)
    standard: str = Field(min_length=1)
    timeout_seconds: int = Field(ge=60)
    verification_endpoint: str | None = None
    result_hash_required: bool = False


class MarketplaceListingRequest(BaseModel):
    seller_wallet_id: str
    repo_id: str | None = None
    title: str = Field(min_length=1)
    price_usdc: Decimal = Field(gt=0)
    provider_kind: ProviderKind = ProviderKind.tool
    seller_passport_id: str | None = None
    seller_trust_level: int | None = Field(default=None, ge=1, le=7)
    seller_trust_status: str | None = None
    escrow_required: bool = False
    delivery_proof: DeliveryProofRequirement | None = None
    # Metered pricing (optional; defaults to flat = today's behavior)
    pricing_model: PricingModel = PricingModel.flat
    unit_price_usdc: Decimal | None = Field(default=None, gt=0)
    unit_label: str | None = None
    min_topup_usdc: Decimal = Field(default=Decimal("1.00"), gt=0)


class MarketplaceListing(BaseModel):
    listing_id: str
    seller_wallet_id: str
    repo_id: str | None = None
    title: str
    price_usdc: Decimal
    currency: str = "USDC"
    custody: str = "none"
    provider_kind: ProviderKind = ProviderKind.tool
    seller_passport_id: str | None = None
    seller_trust_level: int | None = None
    seller_trust_status: str | None = None
    escrow_required: bool = False
    delivery_proof: DeliveryProofRequirement | None = None
    pricing_model: PricingModel = PricingModel.flat
    unit_price_usdc: Decimal | None = None
    unit_label: str | None = None
    min_topup_usdc: Decimal = Decimal("1.00")


class UsageAccount(BaseModel):
    account_id: str
    listing_id: str
    buyer_wallet_id: str
    seller_wallet_id: str
    balance_usdc: Decimal = Decimal("0")
    funded_total_usdc: Decimal = Decimal("0")
    consumed_usdc: Decimal = Decimal("0")
    calls_count: int = 0
    units_count: int = 0
    status: str = "active"  # active | depleted | closed
    created_at: str
    updated_at: str


class UsageEvent(BaseModel):
    event_id: str
    account_id: str
    listing_id: str
    quantity: int
    amount_usdc: Decimal
    balance_after_usdc: Decimal
    idempotency_key: str
    note: str | None = None
    created_at: str


class FundUsageRequest(BaseModel):
    listing_id: str
    buyer_wallet_id: str
    amount_usdc: Decimal = Field(gt=0)
    transaction_hash: str = Field(min_length=66, max_length=66, pattern=r"^0x[0-9a-fA-F]{64}$")


class MeterUsageRequest(BaseModel):
    account_id: str
    quantity: int = Field(default=1, ge=1)
    idempotency_key: str = Field(min_length=1)
    note: str | None = None


class MarketplaceOrderRequest(BaseModel):
    listing_id: str
    buyer_wallet_id: str
    escrow_id: str | None = None
    transaction_hash: str | None = Field(
        default=None,
        min_length=66,
        max_length=66,
        pattern=r"^0x[0-9a-fA-F]{64}$",
    )


class MarketplaceOrder(BaseModel):
    order_id: str
    listing_id: str
    buyer_wallet_id: str
    seller_wallet_id: str
    amount_usdc: Decimal
    currency: str = "USDC"
    transaction_hash: str | None = None
    escrow_id: str | None = None
    custody: str = "none"
    platform_fee_usdc: Decimal = Decimal("0.00")
    seller_receives_usdc: Decimal = Decimal("0.00")
    fee_waived: bool = False


class EscrowCreateRequest(BaseModel):
    listing_id: str
    buyer_wallet_id: str
    client_reference_id: str | None = None
    agent_passport_id: str | None = None


class EscrowDepositInstructions(BaseModel):
    network: str = "base"
    token: str = "USDC"
    token_contract: str
    recipient_address: str
    amount_usdc: Decimal
    expires_at: str


class EscrowRecord(BaseModel):
    escrow_id: str
    listing_id: str
    buyer_wallet_id: str
    seller_wallet_id: str
    seller_passport_id: str | None = None
    amount_usdc: Decimal
    currency: str = "USDC"
    status: EscrowStatus
    deposit: EscrowDepositInstructions
    funding_tx_hash: str | None = None
    delivery_proof: DeliveryProofRequirement
    delivered_at: str | None = None
    result_hash: str | None = None
    artifact_uri: str | None = None
    release_available_at: str | None = None
    settlement_tx_hash: str | None = None
    refund_tx_hash: str | None = None
    dispute_reason: str | None = None
    client_reference_id: str | None = None
    agent_passport_id: str | None = None
    reputation_accrued: bool = False
    platform_fee_usdc: Decimal = Decimal("0.00")
    seller_receives_usdc: Decimal | None = None
    fee_waived: bool = False


class EscrowDepositVerificationRequest(BaseModel):
    tx_hash: str = Field(min_length=66, max_length=66, pattern=r"^0x[0-9a-fA-F]{64}$")


class EscrowDeliveryRequest(BaseModel):
    result_hash: str | None = None
    artifact_uri: str | None = None
    notes: str | None = None


class EscrowDisputeRequest(BaseModel):
    reason: str = Field(min_length=1)


class EvidenceImportRequest(BaseModel):
    repo_id: str
    source: EvidenceSource
    scanner_version: str | None = None
    severity_counts: SeverityCounts = Field(default_factory=SeverityCounts)


class EvidenceRun(BaseModel):
    evidence_id: str
    repo_id: str
    source: EvidenceSource
    scanner_version: str | None = None
    severity_counts: SeverityCounts
    status: str


class TrustReportRequest(BaseModel):
    repo_id: str
    checkout_id: str


class TrustReport(BaseModel):
    report_id: str
    repo_id: str
    checkout_id: str
    status: str
    summary: str
    evidence_count: int


class VerifiedBadge(BaseModel):
    badge_id: str
    repo_id: str
    report_id: str
    status: str
    label: str = "OpenTrust Verified"


class OnchainPaymentVerificationRequest(BaseModel):
    order_id: str
    transaction_hash: str = Field(min_length=66, max_length=66, pattern=r"^0x[0-9a-fA-F]{64}$")


class OnchainPaymentVerificationResponse(BaseModel):
    order_id: str
    verified: bool
    transaction_hash: str
    amount_usdc: str  # Decimal as string for JSON safety
    message: str
