# Two-Way Verifiable Trust & Work Venue Design

Status: **Draft — awaiting sign-off**
Author: Claude (Opus 4.8)
Date: 2026-05-31
Builds on: `de3612c feat: add trust verified escrow flow`

Addresses agent-commerce requirements **#2 (two-way verifiable trust)** and
**#4 (legitimate venue to transact)**. These are designed together because they
are one loop: a venue where clients post work, providers take it, escrow holds
funds, and a completed escrow is the event that mints reputation for **both**
sides.

---

## Decision

Add two coordinated capabilities on top of the existing escrow rail:

1. **Reputation** — a registry-computed, append-only reputation record per party
   identity (client / server / agent), accrued automatically from **escrow
   terminal outcomes** (released / refunded / disputed) and from **bidirectional
   counterparty ratings** submitted after a deal settles. Reputation is
   *verifiable* because every accrual traces back to an escrow whose funding and
   settlement are tied to on-chain transactions.

2. **Work venue (job board)** — a `JobPosting` lifecycle that lets a **client
   post work wanted** (budget, spec, required provider kind, delivery-proof
   requirement). A provider engages the job, which **creates an escrow**
   automatically. On release, the job completes and reputation accrues to both
   parties.

Both keep the same boundaries the escrow work established: in-memory store state
(`MarketplaceStore`), settlement behind the `EscrowProvider` boundary, no new
custody, no DB migration.

---

## Why This Design

- **Reputation must be earned, not asserted.** Today listings carry
  `seller_trust_level` / `seller_trust_status` as *self-asserted request fields*
  (`marketplace.py` schema lines 148–149), trusted at face value by the escrow
  gate (`marketplace_store.create_escrow`, lines 163–166). That is the gap in #2.
  Reputation here is derived from settled escrow outcomes the registry observed —
  it cannot be set by the party it describes.
- **Two-way by construction.** Every settled escrow has a buyer and a seller (and
  optionally an agent). Both accrue an outcome record; both may rate the other.
  Client→provider *and* provider→client trust both become legible.
- **#2 and #4 reinforce each other.** A job board with no reputation is a list of
  strangers; reputation with no venue has nothing to measure. Engaging a job mints
  an escrow (reusing #3 verbatim), and settling that escrow mints reputation (#2).
- **Stays inside the public-repo boundary.** No hot-wallet custody, no signing,
  no DB. Same posture the escrow MVP took.

---

## Participants

| Party | Identity key | Earns reputation as |
|---|---|---|
| **Client** (human paying for agent work) | `buyer_wallet_id` (+ optional `client_passport_id`) | `client` |
| **Server** (MCP server / tool / skill maker) | `seller_wallet_id` + `seller_passport_id` | `server` |
| **Agent** (the AI worker acting under a passport) | `agent_passport_id` | `agent` |

The escrow record already carries `buyer_wallet_id`, `seller_wallet_id`,
`seller_passport_id`, and `agent_passport_id`, so no new identity plumbing is
needed — reputation keys off fields that already travel with every escrow.

---

## Reputation Data Model

New schema in `api/src/schemas/reputation.py`:

```
class SubjectKind(str, Enum):
    client = "client"
    server = "server"
    agent  = "agent"

class ReputationRecord(BaseModel):
    subject_id: str                 # wallet_id or passport_id
    subject_kind: SubjectKind
    deals_total: int = 0            # terminal escrows involving this subject
    deals_released: int = 0         # successful settlements
    deals_refunded: int = 0
    deals_disputed: int = 0
    settled_volume_usdc: Decimal = 0
    rating_sum: int = 0             # sum of 1..5 counterparty scores
    rating_count: int = 0
    avg_rating: float | None        # rating_sum / rating_count, or None
    dispute_rate: float             # deals_disputed / deals_total, or 0
    trust_score: int                # 0..100 derived (see formula)
    tier: str                       # "new" | "bronze" | "silver" | "gold"
    updated_at: str

class CounterpartyRating(BaseModel):
    rating_id: str
    escrow_id: str
    rater_role: str                 # "buyer" | "seller"
    rater_id: str                   # the rater's identity key
    subject_id: str                 # who is being rated
    subject_kind: SubjectKind
    score: int                      # 1..5
    comment: str | None
    created_at: str

class CounterpartyRatingRequest(BaseModel):
    rater_role: Literal["buyer", "seller"]
    score: int = Field(ge=1, le=5)
    comment: str | None = None
```

Stored on `MarketplaceStore`:
```
self.reputation: dict[tuple[str, SubjectKind], ReputationRecord]
self.ratings: dict[str, CounterpartyRating]
```

### Trust score formula (deterministic, no randomness)

```
base       = 100 * deals_released / deals_total            (0 if no deals)
penalty    = 40 * dispute_rate + 20 * (deals_refunded/deals_total)
rating_adj = (avg_rating - 3) * 10                          (0 if no ratings)
trust_score = clamp(0, 100, round(base - penalty + rating_adj))

tier = gold   if trust_score >= 80 and deals_released >= 5
       silver if trust_score >= 60 and deals_released >= 2
       bronze if deals_released >= 1
       new    otherwise
```

Pure function of stored counters → fully testable, deterministic.

---

## Reputation Accrual (automatic)

Hook into the existing terminal transitions in `MarketplaceStore` — no new public
call needed for accrual:

| Escrow transition | Accrual |
|---|---|
| `release_escrow` → released | seller `deals_released++`, `settled_volume += amount`; agent (if present) `deals_released++`; both `deals_total++` |
| `refund_escrow` → refunded | seller + client `deals_refunded++`, `deals_total++` |
| `mark_escrow_disputed` → disputed | seller + client `deals_disputed++` (counted toward `deals_total` only when it reaches a terminal release/refund, to avoid double counting) |

Accrual is idempotent per escrow: a `reputation_accrued: bool` flag on the
`EscrowRecord` guards against double counting if a terminal method is called
twice.

---

## Bidirectional Rating (explicit)

`POST /escrow/{escrow_id}/ratings`

Rules:
- Allowed **only after** the escrow is in a terminal state (`released` /
  `refunded`).
- `rater_role` must match the caller's side of the escrow; buyer rates the
  seller/agent, seller rates the buyer.
- One rating per (escrow_id, rater_role) — second attempt → `409`.
- Updates the subject's `ReputationRecord` (`rating_sum`, `rating_count`,
  recompute `avg_rating` + `trust_score` + `tier`).

`GET /escrow/{escrow_id}/ratings` → list ratings for that escrow.

---

## Reputation Read Surface

New router `api/src/routes/reputation.py`, prefix `/reputation`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/reputation/{subject_id}` | Reputation record (query `?kind=` to disambiguate; defaults to highest-deal record) |
| `GET` | `/reputation/{subject_id}/ratings` | Ratings received by this subject |

Registered under `/api/v1` alongside the existing routers in `main.py`.

---

## Trust Gate Upgrade (closing the self-asserted gap)

`create_escrow` keeps the existing level-3 / not-disputed check **and** adds a
reputation-aware guard:

- If the seller (by `seller_passport_id` or `seller_wallet_id`) has a reputation
  record with `dispute_rate > 0.5` and `deals_total >= 3` → block (`403
  seller reputation indicates elevated dispute risk`).
- New sellers (no record) are allowed — first deal is how you earn reputation.
- Gate is config-flagged (`opentrust_reputation_gate_enabled`, default `True`)
  and backward compatible: existing escrow tests that don't touch reputation are
  unaffected because new sellers have no record.

---

## Work Venue (Job Board)

### Model — `api/src/schemas/jobs.py`

```
class JobStatus(str, Enum):
    open = "open"
    engaged = "engaged"
    completed = "completed"
    cancelled = "cancelled"

class JobPostingRequest(BaseModel):
    client_wallet_id: str
    title: str
    description: str
    budget_usdc: Decimal = Field(gt=0)
    provider_kind: ProviderKind            # what kind of provider is wanted
    client_passport_id: str | None = None
    delivery_proof: DeliveryProofRequirement   # reused from escrow schema
    min_provider_trust_score: int | None = None  # optional reputation floor

class JobPosting(JobPostingRequest):
    job_id: str
    status: JobStatus = JobStatus.open
    engaged_provider_wallet_id: str | None = None
    engaged_provider_passport_id: str | None = None
    escrow_id: str | None = None
    created_at: str

class JobEngageRequest(BaseModel):
    provider_wallet_id: str
    provider_passport_id: str | None = None
    provider_trust_level: int | None = None   # interim, until passport lookup lands
    provider_trust_status: str | None = None
    agent_passport_id: str | None = None
```

Stored as `self.jobs: dict[str, JobPosting]`.

### Lifecycle

```
client POST /jobs                      -> JobPosting(open)
provider POST /jobs/{id}/engage        -> validates reputation floor + trust gate,
                                          creates an internal listing + escrow,
                                          job -> engaged, escrow_id attached
... normal escrow flow (verify-deposit -> deliver -> release/refund/dispute) ...
escrow released                        -> job -> completed, reputation accrues
client/provider POST /escrow/{id}/ratings (bidirectional)
```

`engage` reuses the existing escrow machinery rather than duplicating it: it
synthesizes a `MarketplaceListing` from the job (price = budget, provider_kind,
delivery_proof, escrow_required = True) and calls `create_escrow`. This keeps a
single escrow code path and means jobs inherit every escrow guarantee for free.

### Endpoints — `api/src/routes/jobs.py`, prefix `/jobs`

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/jobs` | Client posts work wanted |
| `GET` | `/jobs` | List jobs; filters `?status=`, `?provider_kind=`, `?max_budget=` |
| `GET` | `/jobs/{id}` | Read one job |
| `POST` | `/jobs/{id}/engage` | Provider engages → creates escrow, returns `{job, escrow}` |
| `POST` | `/jobs/{id}/cancel` | Client cancels while `open` |

### Venue trust gating (two-way, visible)

- `engage` enforces `min_provider_trust_score` against the provider's
  `ReputationRecord` (if the client set a floor).
- Job listings surface the engaged provider's reputation; provider-facing reads
  surface the client's reputation. Both sides see the other before committing —
  the two-way property made concrete in the venue.

---

## Approaches Considered

1. **Reputation as free-text reviews only (extend the orphan `Review` model).**
   Rejected: the `Review` model is reviewer→tool attestation, not counterparty
   trust, and free text isn't a gate. Reputation needs computable counters tied to
   settled outcomes.
2. **On-chain reputation attestations (e.g., EAS) now.** Rejected for this unit:
   same posture as escrow settlement — keep verifiable-but-registry-computed until
   a reviewed on-chain path exists. Trace-to-tx gives verifiability today.
3. **Full bidding marketplace (multiple offers per job, negotiation).** Deferred:
   MVP is single-provider `engage`. Offer/bid objects are a clean later addition;
   the `JobPosting` model leaves room (`engaged_provider_*`).
4. **Reputation accrual via an explicit endpoint.** Rejected: accrual should be a
   side effect of settlement the registry observed, not a call any party can make.
   Hooking the terminal store transitions makes it un-forgeable.

---

## Implementation Units (TDD, red→green per unit)

1. `schemas/reputation.py` + store fields + `trust_score`/`tier` pure functions.
2. Accrual hooks in `release_escrow` / `refund_escrow` / `mark_escrow_disputed`
   (+ idempotency flag on `EscrowRecord`).
3. Rating endpoints (`POST`/`GET /escrow/{id}/ratings`) + store methods.
4. `routes/reputation.py` read surface + register in `main.py`.
5. Reputation-aware escrow gate (config-flagged).
6. `schemas/jobs.py` + store `jobs` + job lifecycle methods.
7. `routes/jobs.py` (create/list/get/engage/cancel) + register in `main.py`.
8. `engage` → escrow bridge; job→completed on release.
9. `openapi.yaml` updates for all new endpoints.

---

## Tests (mirrors `test_escrow.py` style)

- `test_reputation.py`: accrual on release/refund/dispute; idempotency; score &
  tier formula edge cases (no deals, all disputed, high rating); read endpoint.
- Rating: only after terminal; role must match side; no double-rate; avg & score
  update.
- Gate: high-dispute seller blocked; new seller allowed; flag off = no gating.
- `test_jobs.py`: create→list/filter→engage(creates escrow)→deliver→release→job
  completed→both reputations updated; cancel only while open; reputation floor
  enforced on engage.
- Full existing suite (`api/tests cli/tests payment-contracts/tests`) stays green.

---

## Out of Scope

- Real on-chain reputation attestations / settlement signing.
- DB persistence (stays in-memory `MarketplaceStore`, like escrow).
- Multi-offer bidding / negotiation on jobs.
- Passport-lookup auto-population of trust level (interim: passed on engage, same
  as today's listings).
- Web/CLI UI for jobs & reputation (API only this unit).

---

## Sign-Off Criteria

- [x] Reputation accrues only from registry-observed escrow terminal states.
- [x] Reputation is bidirectional (client and provider both accrue + rate).
- [x] Job board lets a client post work and a provider engage, minting an escrow.
- [x] Self-asserted trust gap is closed by a reputation-aware gate.
- [x] No new custody, no signing, no DB; in-repo boundaries respected.
- [x] Full test suite green; new behavior covered red→green.

## Build Result (2026-05-31)

Implemented on top of `de3612c`. Full suite: **251 passed** (was 222), +29 new
tests, zero regressions. `git diff --check` clean. OpenAPI: +7 paths (24 total).

New files: `schemas/reputation.py`, `schemas/jobs.py`, `routes/reputation.py`,
`routes/jobs.py`, `tests/test_reputation.py`, `tests/test_jobs.py`.
Modified: `services/marketplace_store.py` (+228), `routes/payments.py`,
`schemas/marketplace.py`, `main.py`, `config.py`, `openapi.yaml`.
