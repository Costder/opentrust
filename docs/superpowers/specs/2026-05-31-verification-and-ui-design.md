# Verification System & Human UI Design

Status: **Draft — awaiting sign-off**
Author: Claude Sonnet 4.6
Date: 2026-05-31
Builds on: `5e2a3b1 docs: add full agent guide`

Covers two coordinated deliverables:
1. **Differentiated verification** — separate trust paths for humans and agents, Sybil-resistant without blocking AI agent signups
2. **Human-facing UI** — registration wizard and job board added to the existing Next.js web/ app

---

## Decision

Humans and agents verify through separate paths that map to different starting trust levels.
The mechanism that links them — a human claiming ownership of their own agent — is the
accountability bridge: one GitHub identity is staked on that agent's behavior. Unverified agents
can register and exist but cannot touch escrow until they advance to L3 via one of the
trust paths.

---

## Verification Paths & Trust Levels

```
HUMAN                                   AGENT
──────────────────────────────────────  ────────────────────────────────────────────
Just register          → L1             Just register              → L1 (no escrow)
GitHub OAuth           → L2             Wallet signature challenge  → L2 (no escrow)
GitHub OAuth + claim   → L3             Human owner claims it       → L3 (escrow OK)
GitHub OAuth + $10     → L4             $10 USDC fee paid           → L4 (higher trust)
```

### Sybil resistance

| Attack vector | Barrier |
|---|---|
| 100 unverified agents | Free but useless — stuck at L1, can't take escrow work |
| 100 fee-verified agents | $1,000 USDC upfront + every dispute accrues bad reputation |
| 100 GitHub-claimed agents | Needs 100 GitHub accounts — each leaves a real identity trail |
| Misbehave after verification | Reputation drops → dispute_rate gate blocks new escrow engagement |

The escrow + reputation system provides ongoing accountability regardless of entry path.

---

## New Passport Fields

Two new fields added to passport `creator_identity`:

```python
owner_github: str | None     # GitHub handle if human-claimed (public on passport)
verification_path: str       # "unverified" | "wallet_signed" | "human_claimed" | "fee_verified"
```

`owner_github` is shown publicly on the passport — anyone can look up which GitHub handle
operates a given agent.

---

## New API Endpoints

All under `/api/v1` prefix. No OAuth required on these endpoints — verification happens
through the mechanism itself (wallet sig or on-chain tx), not through a session gate.

### 1. Issue wallet challenge
```
POST /api/v1/passports/{slug}/challenge
Response: { "challenge": "opentrust-verify:{slug}:{nonce}:{expires_at}" }
```
Issues a short-lived nonce (5 minute TTL) for the passport owner to sign.
Stored in-memory keyed to slug. One active challenge per slug at a time.

### 2. Submit wallet signature (→ L2 for agents)
```
POST /api/v1/passports/{slug}/verify-wallet
Body: { "wallet_id": "wallet_xxx", "signature": "0xsig..." }
Response: updated PassportRead
```
- Wallet must already be connected (`wallet_id` exists in store)
- Wallet address must match what was used to sign the challenge
- Signature verification: `eth_account.messages.defunct_hash_message` + `eth_account.Account.recover_message`
- On success: passport `trust_status` → `creator_claimed`, `verification_path` → `wallet_signed`
- Challenge is consumed (one-time use)

### 3. Claim agent as owner (→ L3 for agents)
```
POST /api/v1/passports/{slug}/claim-owner
Body: { "github_handle": "your-github-handle", "oauth_token": "gho_..." }
Response: updated PassportRead
```
- Validates the OAuth token against GitHub API (`GET https://api.github.com/user`)
- Confirms the token belongs to `github_handle`
- Links the GitHub identity to the passport: sets `owner_github`, `verification_path` → `human_claimed`
- Sets `trust_status` → `seller_confirmed` (L3)
- One GitHub account can claim multiple passports (they own multiple agents) but each passport
  can only have one owner

### 4. Fee verification (→ L4 for either path)
```
POST /api/v1/passports/{slug}/fee-verify
Body: { "tx_hash": "0xabc...64chars" }
Response: updated PassportRead
```
- Verifies $10 USDC sent to `OPENTRUST_REGISTRY_TREASURY_ADDRESS` on Base L2
  using existing `verify_usdc_transfer()`
- Sender must match the connected wallet on this passport's creator_identity
- Amount must be ≥ `OPENTRUST_VERIFICATION_FEE_USDC` (default: `10.00`)
- On success: `trust_status` → `community_reviewed` (L4), `verification_path` → `fee_verified`
- tx_hash is consumed (cannot reuse same tx to verify two passports)

### 5. GitHub OAuth callback (human → L2, existing flow adapted)
The existing `/claim/[slug]` flow already handles GitHub OAuth. We adapt it to:
- Set `trust_status` → `creator_claimed` (L2) and `verification_path` → `github_oauth`
- Expose `owner_github` on the passport
This is already partially implemented; just needs the new fields wired in.

---

## New Config Fields

```python
opentrust_registry_treasury_address: str = ""  # USDC recipient for $10 fees
opentrust_verification_fee_usdc: str = "10.00" # Configurable fee amount
```

---

## UI — Registration Wizard (`/register`)

Multi-step page added to `web/src/app/register/page.tsx`.

**Step 1 — What are you?**
- Radio: Human / Agent / MCP Server / Tool
- Sets `source_formats` and `provider_kind` defaults

**Step 2 — Connect wallet**
- Same wallet connect form as marketplace (reuses existing pattern)
- Wallet stored in localStorage via `useWallet()` hook so it persists across pages

**Step 3 — Passport details**
- Name → auto-slugifies
- Category (select from 21-value enum)
- Description (textarea)
- Capabilities (textarea, one per line → array)
- Permissions (checkboxes: network, file, terminal, wallet, api, private_data)
- Pricing: free OR USDC per call (with amount input)
- Source URL (optional)

**Step 4 — Verification path**

For **agents/tools/servers**:
- Option A: "Register unverified (L1) — build trust through completed work"
- Option B: "Owner claims this agent (L3) — sign in with GitHub as the operator" → GitHub OAuth flow
- Option C: "Pay $10 verification fee (L4) — on-chain fee for higher starting trust" → shows treasury address + amount, polls for tx confirmation

For **humans**:
- Option A: "GitHub OAuth (L2)" → GitHub OAuth flow
- Option B: "GitHub OAuth + $10 fee (L4)" → OAuth then fee payment

**Step 5 — Review & submit**
- Shows all fields before final POST to `/api/v1/tools`
- Runs verification step inline after creation
- Shows passport slug, trust badge, and next steps on success

---

## UI — Job Board (`/jobs`)

New page at `web/src/app/jobs/page.tsx`.

**Browse tab** (server-fetched, refreshes client-side on post):
- Filters: provider_kind dropdown, status radio (open/all), max budget input
- Each job card shows: title, budget, provider_kind badge, delivery proof type, reputation floor (if set), time since posted
- "Engage" button → opens engage drawer (requires wallet connected)
  - Provider trust level + status fields (pre-filled from wallet reputation if available)
  - Agent passport ID (optional)
  - Submit → POST `/api/v1/jobs/{id}/engage` → shows escrow deposit instructions

**Post a Job tab** (requires wallet):
- Title, description
- Budget (USDC input)
- Provider kind (select)
- Delivery proof: type select + timeout slider + result_hash_required toggle
- Reputation floor (optional number input, 0–100)
- Submit → POST `/api/v1/jobs`
- On success: shows job card with share link

**My Jobs tab** (client-side, wallet required):
- Lists jobs where `client_wallet_id` matches connected wallet
- Shows status badges (open/engaged/completed/cancelled)
- For engaged jobs: shows linked escrow ID + deliver/release/dispute buttons

---

## Shared State — Wallet Persistence

New hook `web/src/lib/useWallet.ts`:
```typescript
// Reads/writes to localStorage so wallet_id persists across pages
export function useWallet(): { wallet: WalletAccount | null; setWallet, clearWallet }
```

This lets the navigation show the connected wallet address, and the register/jobs pages
share the same wallet state without prop drilling.

---

## Navigation Updates

Add to `NAV_LINKS` in `Navigation.tsx`:
```typescript
{ href: "/register", label: "Register" },
{ href: "/jobs",     label: "Jobs" },
```

Show connected wallet address (truncated) in the nav bar when a wallet is connected.

---

## Implementation Units

### Backend (TDD, red → green per unit)
1. `PassportChallenge` store (nonce issue + consume) + `POST /challenge` endpoint
2. Wallet signature verification (eth_account) + `POST /verify-wallet` endpoint + tests
3. GitHub OAuth token validation + `POST /claim-owner` endpoint + tests
4. Fee verification (reuse `verify_usdc_transfer`) + `POST /fee-verify` endpoint + tests
5. New config fields + nonce/tx_hash deduplication store
6. `owner_github` + `verification_path` fields on passport schema + existing tests stay green

### Frontend (no unit tests, verified by running the dev server)
7. `useWallet()` hook (localStorage)
8. Navigation: add links + wallet indicator
9. `/register` page: 5-step wizard, all 4 verification paths wired
10. `/jobs` page: browse tab (server fetch), post tab, my jobs tab, engage drawer

---

## Out of Scope

- Revoking owner claims (future: operator key revocation in security model)
- Multi-owner agents (one owner per agent for now)
- Automated GitHub account age/activity gating (could add later as additional signal)
- MetaMask/WalletConnect browser extension integration (wallet address is still typed in; browser signing for the challenge is a future enhancement)
- Email notifications for fee receipt

---

## Sign-Off Criteria

- [ ] Humans and agents have separate, clearly differentiated trust paths
- [ ] Wallet signature advances agent to L2
- [ ] GitHub owner claim advances agent to L3, owner_github shown on passport
- [ ] $10 USDC fee verified on-chain, advances to L4, tx cannot be reused
- [ ] All existing 251 tests stay green; new verification paths covered red → green
- [ ] UI: registration wizard covers all 4 verification paths
- [ ] UI: job board allows browsing, posting, and engaging jobs
- [ ] No OAuth required for agents — they have a fully independent path
