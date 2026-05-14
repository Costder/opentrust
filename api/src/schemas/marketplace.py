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


class WalletConnectRequest(BaseModel):
    owner: str = Field(min_length=1)
    address: str = Field(min_length=1)
    kind: WalletKind = WalletKind.byo

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


class MarketplaceListingRequest(BaseModel):
    seller_wallet_id: str
    repo_id: str
    title: str = Field(min_length=1)
    price_usdc: Decimal = Field(gt=0)


class MarketplaceListing(BaseModel):
    listing_id: str
    seller_wallet_id: str
    repo_id: str
    title: str
    price_usdc: Decimal
    currency: str = "USDC"
    custody: str = "none"


class MarketplaceOrderRequest(BaseModel):
    listing_id: str
    buyer_wallet_id: str
    transaction_hash: str | None = None


class MarketplaceOrder(BaseModel):
    order_id: str
    listing_id: str
    buyer_wallet_id: str
    seller_wallet_id: str
    amount_usdc: Decimal
    currency: str = "USDC"
    transaction_hash: str | None = None
    custody: str = "none"


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
