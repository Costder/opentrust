# Seller Guide: Pricing & Getting Paid

This explains exactly how you get money when you sell a tool, MCP server, or skill
on OpenTrust — how prices are set, what models are supported (flat, per-call, etc.),
and where the money actually goes.

---

## The short version

- You list a tool with a price. Payment is **USDC on Base L2**.
- **Money goes straight to your wallet.** OpenTrust verifies the payment on-chain
  but never holds your funds and takes no cut.
- You choose **flat** (one-time) or **metered** (per-call / per-token / per-unit /
  subscription) pricing.

---

## Step 1 — Connect a wallet

`POST /api/v1/wallets/connect` (or use the site) with your **Base USDC address**.
That address is where every payment lands. OpenTrust never sees your private key.

## Step 2 — Create a listing & set the price

`POST /api/v1/marketplace/listings`. The pricing fields:

| Field | Meaning |
|---|---|
| `pricing_model` | `flat` (default) · `per_call` · `per_token` · `per_unit` · `subscription` |
| `price_usdc` | the one-time price for **flat** listings |
| `unit_price_usdc` | the price per unit for **metered** listings |
| `unit_label` | what a "unit" is (e.g. `call`, `1k tokens`, `row`) |
| `min_topup_usdc` | smallest balance a buyer can fund (default $1.00) |

In the web UI: the **Sell** tab has a "Pricing" dropdown. Pick Flat or a metered
model; for metered, enter the per-unit price and a label.

---

## How you get paid — the two models

### Flat (one-time)

Buyer pays your `price_usdc` once, directly to your wallet. OpenTrust verifies the
exact USDC transfer on-chain (`POST /marketplace/orders` with the tx hash) and
records the order. Done. **The money is in your wallet the moment they pay.**

### Metered (per-call / per-token / per-unit / subscription)

You **can't** do an on-chain transfer for every single call — gas and latency make
a $0.001 call impossible to settle individually. So OpenTrust uses the model every
usage API uses (Stripe metered, AWS, OpenAI): **prepaid balance + off-chain meter.**

1. **Buyer funds a balance** — one real USDC transfer to your wallet, verified
   on-chain (`POST /usage/fund`). The money is now in your wallet.
2. **Each call meters the balance down** by your `unit_price_usdc`
   (`POST /usage/meter`). This is instant, free, and idempotent (a retried call
   isn't double-charged).
3. **When the balance runs low**, the buyer tops up (another transfer).
4. If the balance can't cover a call, the meter returns **402** — no free calls.

So for metered listings, you receive money **up front** as buyers fund, and the
meter tracks how much of that prepaid amount they've actually consumed vs. still
have as credit.

**Check your earnings:** `GET /api/v1/usage/earnings?seller_wallet_id=...`
returns `funded_usdc` (total prepaid to you), `consumed_usdc` (used up), and
`outstanding_balance_usdc` (prepaid credit buyers still hold).

---

## How a tool enforces metered pricing

For per-call billing to be real, your tool must **call the meter before serving a
paid request**:

```
POST /api/v1/usage/meter
{ "account_id": "...", "quantity": 1, "idempotency_key": "<unique-per-request>" }
```

- `allowed: true` → serve the request.
- `402` → the buyer is out of balance; tell them to top up.

Pass a unique `idempotency_key` per request (e.g. the request ID) so retries don't
double-charge. An OpenTrust-aware MCP gateway can do this for you; otherwise wire
it into your tool's request handler.

---

## Trust & limits

- To list with escrow or take escrow-backed work you need passport trust **L3+**.
- Metered listings still pass the normal trust gates (seller confirmed, not
  disputed).

---

## What's not built yet (be honest with buyers)

- **Automatic refunds of unused prepaid balance** — not automated yet. If a buyer
  stops using a metered tool, returning their remaining balance is a manual seller
  action for now.
- **Escrow custody of balances** — v1 sends funded USDC straight to your wallet
  (direct prepay). Holding balances in escrow until consumed waits on a reviewed,
  non-mock escrow provider.
- **Auto-renewing subscriptions** — a "subscription" is a time-windowed prepay;
  renewal today is just a new fund call, not an automatic charge.

---

## TL;DR

| You want | Set | Money arrives |
|---|---|---|
| Sell once for a fixed price | `pricing_model: flat`, `price_usdc` | On purchase, to your wallet |
| Charge per call | `pricing_model: per_call`, `unit_price_usdc` | Up front as buyers fund; metered as they call |
| Charge per 1k tokens | `pricing_model: per_token`, `unit_price_usdc` | same |
| Charge per unit (rows/MB/jobs) | `pricing_model: per_unit`, `unit_price_usdc` + `unit_label` | same |
| Monthly subscription | `pricing_model: subscription`, `unit_price_usdc` | Up front per period |

Payments are always USDC on Base, wallet-to-wallet, verified on-chain, with no
platform cut.
