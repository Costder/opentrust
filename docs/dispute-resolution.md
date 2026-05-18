# OpenTrust Dispute Resolution

## Scope

This document covers **payment disputes only** — disputes arising from escrow-protected transactions. Trust disputes (tool quality, security concerns, passport authenticity) are governed in [governance.md](governance.md).

## Payment Dispute Tiers

The escrow system enforces a three-tier dispute model designed so that Tiers 1 and 2 resolve automatically without human involvement. Tier 3 escalation should be rare by design.

### Tier 1 — Automatic Seller Win (auto_seller_win)

**Trigger conditions:**
- Buyer missed the dispute window (no dispute opened within declared window_seconds)
- Proof of delivery condition verifiably met:
  - `hash_match`: tool returns a hash that matches the declared result hash
  - `api_responds`: API endpoint responds correctly to a test call
  - `sandbox_completed`: tool ran in sandbox with observed outputs
  - `access_granted`: verifiable access (API key issued, auth token works)
  - `output_delivered`: structured output matches declared schema

**Resolution SLA:** 300 seconds

**Evidence required:** None from buyer. The escrow contract autonomously verifies that the tool's declared `proof_of_delivery.type` condition has been met. The seller's responsibility is defined in the passport — the escrow logic enforces it.

**Decision process:** Automatic; no human involvement.

---

### Tier 2 — Automatic Buyer Refund (auto_buyer_refund)

**Trigger conditions:**
- `deadline_missed`: tool did not respond within the declared timeout_seconds
- `delivery_failed`: API endpoint returned 5xx on all retry attempts
- `hash_mismatch`: tool returned a hash that does not match the declared result hash
- `schema_mismatch`: output does not conform to declared schema
- `install_fails`: installation or setup process failed
- `permissions_differ`: permissions in delivered tool differ from manifest
- `malware_found`: security scan detected malicious code
- `required_deliverable_missing`: a required component of the delivery is absent

**Resolution SLA:** 600 seconds

**Evidence from buyer:** Transaction hash, timestamp, HTTP response or logs demonstrating the failure. The escrow contract reviews this evidence programmatically.

**Decision process:** Automatic; no human arbitrator.

---

### Tier 3 — Human Arbitration (human_arbitration)

**Trigger conditions:**
- `research_quality_disputed`: buyer claims the research output is of insufficient quality relative to the declared standard
- `partial_delivery`: buyer received partial or degraded delivery but the technical conditions do not clearly fall under Tier 2
- `scope_creep_claimed`: buyer claims the tool delivered functionality different from specifications
- `workflow_usefulness_disputed`: buyer claims the tool is not fit for the intended workflow
- `expectation_mismatch`: buyer and seller have conflicting interpretations of the delivery standard

**Resolution SLA:** 172800 seconds (48 hours)

#### Arbitrator Eligibility

Arbitrators are community volunteers drawn from the [arbitrator registry](arbitrator-registry.md). An arbitrator is eligible for a dispute if:
- They have a verified identity (GitHub OAuth, DID, or equivalent) at `reviewer_signed` level or higher
- They have no financial relationship with either party (the buyer or the seller's tool)
- They have declared availability and can respond within 4 hours during their stated window

An arbitrator must recuse themselves if:
- They have reviewed or would benefit from either party's work
- They have a direct or indirect financial stake in the outcome
- They have publicly opined on the dispute before being assigned

#### Dispute Submission

**Buyer initiates:**
- Payment transaction hash
- Description of the issue (max 2000 characters)
- Timestamps and logs demonstrating the problem
- Requested remedy: full_refund, partial_refund, or replacement_delivery (with amount if partial)
- Optional evidence URLs (logs, screenshots, recordings)

**Seller responds within 24 hours with:**
- Description of actions taken to meet the declared standard
- Proof of delivery (URL or hash demonstrating the tool was delivered as specified)
- Tool's declared delivery standard from its passport
- Optional access logs showing buyer interaction

#### Arbitrator Decision

The arbitrator reviews both submissions and issues a **written decision** within the 48-hour SLA. The decision must include:

1. **Outcome:** one of
   - `buyer_full_refund`: 100% of escrow amount returned to buyer
   - `buyer_partial_refund`: specified amount returned; remainder to seller
   - `seller_win`: escrow released to seller; no refund

2. **Rationale:** written explanation of how the arbitrator interpreted the delivery standard and why the outcome is appropriate

3. **Recorded decision:** timestamped in the passport's `review_history` for future reference

The escrow contract automatically executes the decision and records it on both parties' attestations.

#### Appeals

Each dispute may be appealed **once** by the losing party. Appeals are decided by a **three-arbitrator panel** on the following terms:

- Appeal must be filed within 7 days of the initial decision
- Each panelist independently reviews the submissions and the original decision
- Panelists must reach consensus or a 2-of-3 majority decision
- Panel decision deadline: 72 hours
- Panel decision is final; no further appeals

## Dispute Bonds

Dispute bonds prevent frivolous or harassing disputes. The bond is refunded if the dispute is upheld (arbitrator rules for the buyer); forfeited if the dispute is rejected (arbitrator rules for the seller).

| Transaction Amount | Bond Amount |
|---|---|
| Under $25 | $2 |
| $25–$100 | $5 |
| $100–$500 | $15 |
| $500–$2,500 | $35 |
| Over $2,500 | Custom or percentage-based (registry determines) |

## Arbitration Endpoint

Disputes are submitted to the registry's arbitration API:

```
POST https://registry.opentrust.dev/api/v1/disputes
```

**Request schema:** [dispute_resolution_v1.json](../payment-contracts/dispute_resolution_v1.json)

The registry automatically:
- Validates submission against the schema
- Assigns an available arbitrator from the registry
- Notifies both parties of the assigned arbitrator
- Tracks response deadlines
- Records the final decision and appeal window

## Arbitration Independence

The registry operator provides **infrastructure only**. Arbitrators are independent community volunteers and cannot be influenced by the registry operator or any tool author. The registry:

- Does not select arbitrators based on desired outcomes
- Does not pressure arbitrators to decide in any particular direction
- Does not override or modify arbitrator decisions
- Records all decisions publicly for transparency and appeals

Registry operators who attempt to manipulate arbitration are removed from the registry operator list and their registry instance is marked as non-compliant with the OpenTrust spec.

---

## Questions

Open a GitHub Discussion or reach out to [@Costder](https://github.com/Costder).
