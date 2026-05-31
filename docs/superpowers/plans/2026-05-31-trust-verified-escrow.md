# Trust-Verified Escrow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the escrow 501 stub with a real trust-gated escrow lifecycle for marketplace work listings.

**Architecture:** Add escrow schemas, in-memory store state, a mock/provider boundary, and FastAPI routes under `/api/v1/escrow`. Marketplace listings gain provider and escrow metadata, and direct orders are blocked when a listing requires escrow.

**Tech Stack:** FastAPI, Pydantic v2, pytest, httpx ASGI tests, existing `verify_usdc_transfer()` and `MarketplaceStore`.

---

### Task 1: Escrow API Red Tests

**Files:**
- Create: `api/tests/test_escrow.py`
- Modify later: `api/src/routes/payments.py`
- Modify later: `api/src/schemas/marketplace.py`
- Modify later: `api/src/services/marketplace_store.py`

- [ ] **Step 1: Write failing tests for create, verify, deliver, release, refund, and dispute**

Create `api/tests/test_escrow.py` with tests that:
- reset the existing in-memory store
- create buyer/seller wallets and listings directly in store
- assert `/api/v1/escrow/create` rejects disabled escrow, missing proof, low trust, and disputed sellers
- assert eligible escrow creation returns deposit instructions
- assert `/verify-deposit` calls `verify_usdc_transfer()`
- assert invalid transitions return `409`
- assert delivery, release, dispute, and refund mutate status correctly

- [ ] **Step 2: Run red test command**

Run: `pytest api/tests/test_escrow.py -v`

Expected: tests fail because escrow schemas/routes/store methods do not exist and `/escrow/create` still returns `501`.

### Task 2: Schemas, Store, and Provider

**Files:**
- Modify: `api/src/schemas/marketplace.py`
- Modify: `api/src/services/marketplace_store.py`
- Create: `api/src/services/escrow_provider.py`

- [ ] **Step 1: Add marketplace and escrow schemas**

Add `ProviderKind`, `DeliveryProofRequirement`, escrow request/response models, and `EscrowStatus` to `api/src/schemas/marketplace.py`.

- [ ] **Step 2: Add store state and methods**

Extend `MarketplaceStore` with `escrows`, `create_escrow()`, `verify_escrow_deposit()`, `mark_escrow_delivered()`, `mark_escrow_disputed()`, `release_escrow()`, and `refund_escrow()` methods. Invalid transitions raise `ValueError`.

- [ ] **Step 3: Add provider boundary**

Create `api/src/services/escrow_provider.py` with `MockEscrowProvider`, `get_escrow_provider()`, a deterministic deposit address for local/dev tests, and methods for `release_funds()` and `refund_buyer()`.

- [ ] **Step 4: Run green target**

Run: `pytest api/tests/test_escrow.py -v`

Expected: tests still fail until routes are wired, but import/type errors for schemas and provider are gone.

### Task 3: Escrow Routes

**Files:**
- Modify: `api/src/routes/payments.py`

- [ ] **Step 1: Replace escrow create stub**

Implement:
- `POST /api/v1/escrow/create`
- `GET /api/v1/escrow/{escrow_id}`
- `POST /api/v1/escrow/{escrow_id}/verify-deposit`
- `POST /api/v1/escrow/{escrow_id}/deliver`
- `POST /api/v1/escrow/{escrow_id}/release`
- `POST /api/v1/escrow/{escrow_id}/refund`
- `POST /api/v1/escrow/{escrow_id}/disputes`

- [ ] **Step 2: Map route errors**

Map `KeyError` to `404`, `PermissionError` to `403`, `ValueError` invalid transitions to `409`, and `OnchainVerificationError` to `402`.

- [ ] **Step 3: Run escrow tests**

Run: `pytest api/tests/test_escrow.py -v`

Expected: all escrow tests pass.

### Task 4: Marketplace Bypass Protection

**Files:**
- Modify: `api/src/routes/marketplace.py`
- Modify: `api/src/services/marketplace_store.py`
- Modify: `api/src/schemas/marketplace.py`
- Modify: `api/tests/test_marketplace.py`

- [ ] **Step 1: Add red marketplace test**

Add a test asserting direct `/api/v1/marketplace/orders` returns `403` when the listing has `escrow_required=True` and no escrow reference.

- [ ] **Step 2: Run red marketplace test**

Run: `pytest api/tests/test_marketplace.py -v`

Expected: new test fails because direct orders are still accepted with a tx hash.

- [ ] **Step 3: Implement bypass protection**

Reject direct orders for escrow-required listings unless an associated escrow record is released or the request carries an accepted escrow ID. Keep the first pass conservative: direct order creation without escrow ID returns `403`.

- [ ] **Step 4: Run marketplace tests**

Run: `pytest api/tests/test_marketplace.py -v`

Expected: all marketplace tests pass.

### Task 5: Verification

**Files:**
- All modified files

- [ ] **Step 1: Run focused tests**

Run:
`pytest api/tests/test_escrow.py api/tests/test_marketplace.py api/tests/test_passport_auth.py -v`

Expected: all pass.

- [ ] **Step 2: Run payment contract tests**

Run:
`pytest payment-contracts/tests -v`

Expected: all pass.

- [ ] **Step 3: Run whitespace check**

Run:
`git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 4: Review changed files**

Run:
`git status --short`

Expected: design spec, implementation plan, escrow tests, and escrow implementation files are the only changes.
