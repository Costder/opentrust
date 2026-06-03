# Usage-Based (Metered) Billing — Design

Status: **Draft — awaiting sign-off**
Author: Claude Opus 4.8
Date: 2026-06-03

Add real per-call / per-unit billing to the OpenTrust marketplace so sellers can
monetize usage, not just one flat purchase. Today a listing has a single
`price_usdc` paid once; `per_call`/`per_token`/etc. exist only as advertised
metadata an agent is trusted to honor. This builds the actual metering + billing.

---

## The core problem & the decision

**You cannot settle each call on-chain.** A $0.001/call tool can't do a USDC
transfer per call — gas + latency + 6-decimal rounding make it absurd. Every real
usage API (Stripe metered, AWS, OpenAI) solves this the same way:

> **Prepaid balance → meter usage off-chain → settle on-chain in batches.**

So the model is **usage credits**:

1. Buyer **funds a balance** for a listing (one real USDC transfer, verified
   on-chain — reuses `verify_usdc_transfer`).
2. Each call **draws down** the balance by the unit price (off-chain, instant,
   free). This is the meter.
3. When the balance runs low, the buyer **tops up** (another on-chain transfer).
4. The seller's earnings accrue as the balance is consumed; settlement to the
   seller's wallet happens via the existing direct/escrow rails.

This gives true per-call economics with on-chain trust, without per-call gas.

---

## Pricing models supported

A listing declares a `pricing_model` + the unit price:

| Model | Unit | `unit_price_usdc` means | Metered by |
|---|---|---|---|
| `flat` | per purchase | one-time price (today's behavior) | n/a (existing flow) |
| `per_call` | 1 call | price per call | call count |
| `per_token` | 1000 tokens | price per 1k tokens | reported token usage |
| `per_unit` | 1 unit | price per seller-defined unit (rows, MB, jobs) | reported units |
| `subscription` | 1 period | price per month | time window (renew) |

`flat` is the existing path, untouched. The new engine covers the metered models.
`per_byte`/`tiered` from the spec are out of scope for v1 (per_unit covers most).

---

## Data model

### Listing gains pricing fields (additive, backward compatible)

```python
class PricingModel(str, Enum):
    flat = "flat"
    per_call = "per_call"
    per_token = "per_token"
    per_unit = "per_unit"
    subscription = "subscription"

# On MarketplaceListingRequest / MarketplaceListing:
pricing_model: PricingModel = PricingModel.flat
unit_price_usdc: Decimal | None = None   # required for metered models
unit_label: str | None = None            # e.g. "call", "1k tokens", "row"
min_topup_usdc: Decimal = Decimal("1.00")  # smallest balance funding
```

`price_usdc` stays for `flat` (and as a display fallback). Metered listings use
`unit_price_usdc`.

### New: UsageAccount (the prepaid balance / meter)

```python
class UsageAccount(BaseModel):
    account_id: str
    listing_id: str
    buyer_wallet_id: str
    balance_usdc: Decimal          # remaining prepaid credit
    funded_total_usdc: Decimal     # lifetime funded
    consumed_usdc: Decimal         # lifetime drawn down
    calls_count: int
    units_count: int               # tokens/units metered
    status: str                    # "active" | "depleted" | "closed"
    created_at: str
    updated_at: str
```

### New: UsageEvent (the meter log — one row per drawdown)

```python
class UsageEvent(BaseModel):
    event_id: str
    account_id: str
    listing_id: str
    quantity: int                  # calls or units in this event
    amount_usdc: Decimal           # quantity * unit price
    balance_after_usdc: Decimal
    note: str | None
    created_at: str
```

Both persist via the existing `marketplace_objects` table (kind="usage_account"
/ "usage_event"), so they survive cold starts like listings/orders.

---

## API

### Fund / top up a balance (on-chain)
```
POST /usage/fund
{ "listing_id", "buyer_wallet_id", "amount_usdc", "transaction_hash" }
```
Verifies the USDC transfer (buyer -> seller wallet) on-chain via
`verify_usdc_transfer`, then credits the UsageAccount balance. Creates the account
on first fund. Returns the account.

### Meter usage (drawdown)
```
POST /usage/meter
{ "account_id", "quantity"=1, "idempotency_key" }
```
- Computes `amount = quantity * unit_price` for the listing's model.
- If balance >= amount: deduct, record a UsageEvent, return
  `{ allowed: true, balance_after }`.
- If balance < amount: `{ allowed: false, reason: "insufficient_balance" }`
  (HTTP 402) — the caller should top up.
- **Idempotency**: same `idempotency_key` returns the prior result without
  double-charging (critical so a retried call isn't billed twice).
- This is what a seller's tool (or an OpenTrust-aware gateway) calls before
  serving a request — the trust gate for "is this paid call authorized?"

### Read
```
GET /usage/accounts/{account_id}             -> balance + counters
GET /usage/accounts?listing_id&buyer_wallet  -> find a buyer's account
GET /usage/accounts/{account_id}/events       -> the meter log
```

### Seller earnings
```
GET /usage/earnings?seller_wallet_id   -> consumed_usdc summed across the
                                          seller's listings (what they've earned)
```

---

## How settlement actually reaches the seller

Two honest options, picked per listing via `escrow_required`:

1. **Direct prepay (default, real today):** funding transfers go straight to the
   seller's wallet (verified on-chain). The balance is then a *credit ledger* of
   what the buyer has prepaid. The seller already has the money; the meter just
   tracks how much the buyer has "used up" vs. is owed back. **Refund of unused
   balance** is a seller action (manual or via a future refund endpoint).

2. **Escrow-backed (when the mock provider is replaced):** funding goes into
   escrow; settlement releases consumed amounts to the seller and can refund the
   unused remainder to the buyer. This is the "correct" custody model but waits
   on a real escrow provider (currently mocked, off in prod) — same boundary the
   escrow work already established. The design leaves a clean seam for it.

v1 ships **direct prepay**. The UsageAccount works identically either way; only
where the funded USDC sits differs.

---

## Trust integration

- Metered listings still pass the existing trust gates (seller L3+, not disputed).
- A buyer's spend policy `max_cost_per_call_usdc` can be checked against the
  listing's `unit_price_usdc` before funding (advisory in v1).
- `POST /usage/meter` is the natural enforcement point for the
  spend-cap-per-call idea from the spec.

---

## Frontend

- **Sell form** gains a pricing-model selector: Flat vs. Per-call vs. Per-token /
  unit vs. Subscription, with the unit price + label.
- **Listing card / detail**: show "$0.002 / call" style pricing instead of a flat
  badge for metered listings.
- **Buyer view**: a "Fund balance" action (reuses the browser `sendUsdc`),
  current balance, usage meter, and top-up.

---

## Implementation units (TDD)

1. `PricingModel` enum + listing pricing fields (schema + store, backward compat).
2. `UsageAccount` + `UsageEvent` schemas + store methods (create/fund/meter/read),
   with idempotency on meter.
3. Persistence: save/load usage_account + usage_event via marketplace_objects.
4. `POST /usage/fund` (on-chain verified) + `POST /usage/meter` (idempotent draw).
5. Read endpoints (account, events, earnings).
6. Frontend: sell-form pricing selector, metered price display, fund/meter UI.
7. Docs: seller guide "how pricing & payouts work" (incl. the per-call model).

---

## Out of scope (v1)

- Real escrow custody of balances (waits on a non-mock escrow provider).
- Automatic unused-balance refunds (manual for now; endpoint later).
- `per_byte` and `tiered` graduated pricing (per_unit + flat cover the 80%).
- Automatic subscription renewal charging (subscription = a time-windowed flat;
  renewal is a new fund call in v1).
- Fiat / non-USDC, non-Base settlement.

---

## Sign-Off Criteria

- [ ] Listings can declare per_call / per_token / per_unit / subscription pricing
- [ ] Buyers fund a prepaid balance with a real on-chain USDC transfer (verified)
- [ ] Each call meters the balance down by the unit price, idempotently
- [ ] Insufficient balance returns 402 (top-up required) — no silent free calls
- [ ] Usage + earnings are queryable; everything persists across cold starts
- [ ] Flat-price listings and existing orders/escrow are unchanged
- [ ] Full suite green; new behavior TDD'd
