# Trust-Verified Escrow and Work Marketplace Design

**Date:** 2026-05-31
**Status:** Draft for sign-off
**Scope:** FastAPI escrow API, marketplace listing metadata, public payment-contract interfaces, and tests

---

## Decision

Build a trust-verified escrow state machine in the public OpenTrust API, and keep actual settlement behind an escrow provider interface.

This replaces the current `POST /api/v1/escrow/create` 501 with a real agent-readable flow:

1. Create escrow from an eligible marketplace work listing.
2. Return deposit instructions for Base USDC.
3. Verify the buyer's on-chain USDC deposit with `verify_usdc_transfer()`.
4. Record delivery proof.
5. Release to the provider or refund to the client through an `EscrowProvider` boundary.

OpenTrust itself must not become a default custodian. The public repo should define escrow metadata, verify escrow state, enforce passport trust, and expose provider interfaces. A smart contract or private trusted service moves money. The public implementation can include a mock settlement provider for tests and local demos, but live release/refund transaction signing remains out of the reference registry until a reviewed contract or provider implementation exists.

## Why This Design

The repo already says direct marketplace payments are not enough for real work, and `passport-schema/escrow.schema.json` says the actual escrow logic belongs in smart contracts or trusted services. The current marketplace order flow verifies that a buyer paid a seller, but that is not escrow because funds are never held against delivery. The missing piece is a first-class escrow lifecycle that agents can reason about before spending.

This design uses the primitives that are already real:

- `api/src/services/onchain.py` verifies actual Base USDC `Transfer` events.
- `api/src/routes/passport_auth.py` validates passport JWT claims and rejects revoked or disputed passports.
- `payment-contracts/payment_contracts/interfaces/escrow_interface.py` defines the public provider shape.
- `passport-schema/escrow.schema.json` defines delivery proof, dispute, refund, and revenue split metadata.

It does not use `custody.py` for live escrow settlement in the first pass. EOA escrow wallets require gas management, private-key persistence, hot-wallet controls, legal review, and loss recovery. That is a separate security project. `custody.py` remains useful for wallet generation and future provider implementations, but the reference escrow API should not pretend that encrypted key generation alone makes production custody safe.

## Participants

**Client:** A human or organization paying for work. A client connects a wallet and funds escrow. The client may also delegate payment authority to an AI agent.

**Agent:** A passport-bearing runtime acting for a client or provider. Agents can create escrows, verify funding, deliver work, or release funds only when their passport is valid, not disputed, not revoked, and within spend caps.

**Provider:** A server, MCP server maker, skill/tool maker, or agent service that sells work. Providers must have a passport at `seller_confirmed` / level 3 or higher before a listing can accept escrow.

**OpenTrust registry:** The verifier and coordinator. It validates passports, verifies on-chain deposits, records delivery/dispute state, and calls a settlement provider. It does not default to custodying user funds.

**Escrow provider:** A pluggable settlement implementation. In production this should be a reviewed smart contract or trusted third-party service. In tests and local demo, it is a mock provider that records release/refund requests.

## Marketplace Venue Model

The existing marketplace remains, but listings become work listings instead of only repo/tool listings. A listing can represent:

- `mcp_server`
- `skill`
- `tool`
- `agent_service`
- `human_service`

`MarketplaceListingRequest` and `MarketplaceListing` gain optional escrow metadata:

```python
class ProviderKind(str, Enum):
    mcp_server = "mcp_server"
    skill = "skill"
    tool = "tool"
    agent_service = "agent_service"
    human_service = "human_service"


class DeliveryProofRequirement(BaseModel):
    type: str
    standard: str
    timeout_seconds: int = Field(ge=60)
    verification_endpoint: str | None = None
    result_hash_required: bool = False


class MarketplaceListingRequest(BaseModel):
    seller_wallet_id: str
    repo_id: str
    title: str
    price_usdc: Decimal = Field(gt=0)
    provider_kind: ProviderKind = ProviderKind.tool
    seller_passport_id: str | None = None
    seller_trust_level: int | None = Field(default=None, ge=1, le=7)
    seller_trust_status: str | None = None
    escrow_required: bool = False
    delivery_proof: DeliveryProofRequirement | None = None
```

Escrow eligibility requires:

- `escrow_required=True` or the client explicitly chooses escrow.
- `delivery_proof` is present and has a non-empty `standard`.
- `seller_trust_level >= 3`.
- `seller_trust_status != "disputed"`.
- Seller wallet exists.
- Listing price is positive USDC.

Direct `POST /api/v1/marketplace/orders` remains available for direct BYO-wallet payments. If a listing has `escrow_required=True`, direct orders without an escrow ID are rejected. This prevents high-risk work from bypassing escrow after the listing declares escrow as required.

## Escrow Data Model

Add escrow models to `api/src/schemas/marketplace.py` or split them into `api/src/schemas/escrow.py` if the file grows too large.

```python
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
    expires_at: datetime


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
    delivered_at: datetime | None = None
    result_hash: str | None = None
    release_available_at: datetime | None = None
    settlement_tx_hash: str | None = None
    refund_tx_hash: str | None = None
    dispute_reason: str | None = None
```

The initial store can live beside the existing in-memory `MarketplaceStore` because the current marketplace, checkout, reports, and badges are already in-memory for local development and tests. The model should be intentionally shaped so it can move to SQLAlchemy later without changing the route contract.

## API Flow

### Create

`POST /api/v1/escrow/create`

Validates the listing, buyer wallet, seller wallet, seller trust, delivery proof, and feature flag.

Response includes the escrow record plus deposit instructions. The recipient address comes from the configured escrow provider, not from the seller wallet. For the public mock provider, this is a deterministic test address.

Failure cases:

- `403` if `OPENTRUST_ESCROW_ENABLED=false`.
- `404` if listing or wallet is missing.
- `403` if seller trust is below level 3 or disputed.
- `422` if the listing has no delivery proof.

### Verify Funding

`POST /api/v1/escrow/{escrow_id}/verify-deposit`

Request:

```python
class EscrowDepositVerificationRequest(BaseModel):
    tx_hash: str = Field(min_length=66, max_length=66, pattern=r"^0x[0-9a-fA-F]{64}$")
```

The route calls `verify_usdc_transfer()` with:

- expected sender = buyer wallet address
- expected recipient = escrow deposit recipient
- expected amount = escrow amount
- token contract = configured Base USDC contract

On success, status becomes `funded`, `funding_tx_hash` is recorded, and a marketplace order can be created with `custody="escrow"`.

### Mark Delivered

`POST /api/v1/escrow/{escrow_id}/deliver`

Request:

```python
class EscrowDeliveryRequest(BaseModel):
    result_hash: str | None = None
    artifact_uri: str | None = None
    notes: str | None = None
```

Only funded escrows can be delivered. If the listing requires a result hash, `result_hash` is required. The route records delivery and sets `release_available_at` from the proof/dispute window.

If `verification_endpoint` is present, implementation should call it in a later phase. The first pass records the endpoint and result hash but does not trust remote callbacks as release authority without HMAC signing.

### Release

`POST /api/v1/escrow/{escrow_id}/release`

Allowed when:

- status is `delivered`
- there is no open dispute
- the caller is the client, a valid delegated agent, or the auto-release job after `release_available_at`

The API sets `release_pending`, calls `EscrowProvider.release_funds(escrow_id)`, and then sets `released` with `settlement_tx_hash` when the provider confirms settlement. The mock provider confirms immediately with a mock settlement ID.

### Refund

`POST /api/v1/escrow/{escrow_id}/refund`

Allowed when:

- escrow is funded
- delivery timeout expired without delivery, or a dispute resolves for the client

The API sets `refund_pending`, calls the provider refund path, and then sets `refunded` with `refund_tx_hash` when confirmed.

### Dispute

`POST /api/v1/escrow/{escrow_id}/disputes`

Records a dispute reason and moves status to `disputed`. A disputed escrow cannot release until the dispute resolves. Tier 1 and Tier 2 automatic outcomes should be represented as explicit resolution reasons, not hidden state mutation. Tier 3 human arbitration remains a later admin workflow.

### Read

`GET /api/v1/escrow/{escrow_id}`

Returns the escrow record. Agents need this to poll payment/delivery status without scraping marketplace orders.

## Trust and Authorization Rules

The first implementation should extract common passport validation into a reusable helper so escrow routes do not duplicate `passport_auth.py` logic.

```python
class PassportClaims(BaseModel):
    passport_id: str
    agent_id: str
    trust_level: int
    trust_status: str
    flags: list[str] = []
    spend_caps: dict | None = None
    is_disputed: bool = False
    version: str = "1"
```

Rules:

- Any passport with `trust_status="disputed"` or `is_disputed=True` is denied.
- Revoked passport IDs are denied through the existing revocation list.
- Provider listings that use escrow require seller trust level 3 or higher.
- Agent-initiated escrow creation requires a valid token if the request includes `agent_passport_id`.
- If passport `spendCaps.maxPerCallUsdc` exists, escrow amount must be less than or equal to it.
- Payment operations fail closed if passport validation cannot run.
- Clients without agent passports can still fund from a connected wallet, but provider trust gates still apply.

This keeps OpenTrust usable for human clients while making the agent path stricter.

## Provider Interface

Extend the public `EscrowProvider` contract without binding it to any one payment company:

```python
class EscrowProvider(ABC):
    @abstractmethod
    def create_escrow(self, buyer_id: str, seller_id: str, amount: Decimal) -> EscrowId:
        raise NotImplementedError

    @abstractmethod
    def deposit_address(self, escrow_id: str) -> str:
        raise NotImplementedError

    @abstractmethod
    def release_funds(self, escrow_id: str) -> Resolution:
        raise NotImplementedError

    @abstractmethod
    def refund_buyer(self, escrow_id: str) -> Resolution:
        raise NotImplementedError

    @abstractmethod
    def dispute(self, escrow_id: str, reason: str) -> DisputeCase:
        raise NotImplementedError
```

The public API implementation should use a tiny adapter service:

- `MockEscrowProvider` for tests and local demos.
- `ConfiguredEscrowProvider` disabled adapter that returns `503` unless explicitly configured.
- Future `SmartContractEscrowProvider` or private provider can implement the same methods.

This preserves the public/private boundary: OpenTrust defines the contract and validates state; private payment providers or audited contracts perform settlement.

## State Machine

```text
created
  -> funded
  -> delivered
  -> release_pending
  -> released

funded
  -> disputed
  -> refund_pending
  -> refunded

created
  -> expired

funded
  -> refund_pending
  -> refunded

created
  -> cancelled
```

Invalid transitions should return `409 Conflict`, not silently no-op.

Examples:

- `release` before `delivered` returns `409`.
- `refund` after `released` returns `409`.
- `deliver` before `funded` returns `409`.
- `verify-deposit` after `released` returns `409`.

## Approaches Considered

### 1. Keep direct payment verification only

This is what marketplace orders almost do today: buyer pays seller, OpenTrust verifies the tx hash. It is useful proof-of-payment, but it is not escrow. Funds cannot be returned automatically if delivery fails. Rejected.

### 2. Reference escrow state machine with provider settlement

This is the chosen approach. It creates a real escrow lifecycle, makes agents interact with clear states, enforces trust and delivery proof, and leaves settlement to a smart contract or trusted provider. It fits the public repo boundary and can be implemented safely in small steps.

### 3. Add hot-wallet custody and sign release/refund transactions now

This would look more complete in a demo but is the wrong default for a public trust-standard repo. It requires gas management, loss recovery, KMS or HSM design, legal review, sanctions/KYC policy for high-value payments, and operational hot-wallet limits. Rejected for the first pass.

## Implementation Units

The implementation plan should be split into these units:

1. Escrow schemas and store methods.
2. Provider interface extension and mock provider.
3. Reusable passport claims/trust helper.
4. `/escrow/create` and `GET /escrow/{escrow_id}`.
5. `/verify-deposit` wired to `verify_usdc_transfer()`.
6. Delivery, release, refund, and dispute transitions.
7. Marketplace listing escrow metadata and direct-payment bypass protection.
8. OpenAPI/docs updates.

## Tests

Add `api/tests/test_escrow.py` with focused integration tests:

- Creating escrow is disabled when `opentrust_escrow_enabled` is false.
- Creating escrow fails when listing is missing.
- Creating escrow fails when buyer wallet is missing.
- Creating escrow fails when seller trust is below level 3.
- Creating escrow fails when seller status is disputed.
- Creating escrow fails when delivery proof is missing.
- Creating escrow succeeds for an eligible listing and returns deposit instructions.
- Deposit verification calls `verify_usdc_transfer()` with buyer address, escrow address, and exact amount.
- Failed on-chain verification returns `402`.
- Delivery before funding returns `409`.
- Delivery after funding records result hash and release window.
- Release before delivery returns `409`.
- Release after delivery calls the provider and marks escrow released.
- Refund after timeout or dispute calls the provider and marks escrow refunded.
- Direct marketplace orders are rejected when the listing requires escrow.

Run targets:

```bash
pytest api/tests/test_escrow.py -v
pytest api/tests/test_marketplace.py -v
pytest api/tests/test_passport_auth.py -v
```

## Out of Scope

- Writing or deploying a Solidity escrow contract.
- Live hot-wallet signing from the reference registry.
- Circle, Coinbase, or any private payment API integration.
- Tier 3 human arbitration UI.
- Reputation accrual and two-way agent-to-client trust scoring.
- Web frontend changes beyond any minimal API compatibility updates required by existing tests.

## Sign-Off Criteria

This design is ready for implementation when the following are accepted:

- OpenTrust remains non-custodial by default.
- The 501 escrow route becomes a real state-machine API.
- Funding uses real on-chain USDC transfer verification.
- Release/refund uses a provider interface, with mock settlement only in public tests/demo.
- Marketplace listings can represent work from MCP servers, skills, tools, and agent services.
- Escrow eligibility is gated by seller passport trust and delivery proof.
