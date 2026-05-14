# RFC 0004: Agent Spend Policy

- **Status:** accepted
- **Author:** Costder
- **Created:** 2026-05-14

## Summary

Defines the buyer-side payment contract for agents. The v1 commercial_status schema covers the seller side (tool declares price and payment config). This RFC adds the missing buyer side: the operator declares what the agent is authorized to spend, on which tools, under what conditions.

## Motivation

The current spec lets a tool declare "I cost 0.05 USDC per call." But there is nothing that lets an operator declare "my agent may spend up to 1 USDC per session, only on tools with reviewer_signed or higher trust, never on tools with wallet permissions."

Without spend policies:
- Agents can overspend without constraint
- Agents can pay for tools their operators haven't authorized
- There is no standard way to require human approval above a threshold
- Enterprises cannot audit what agents are authorized to spend

## Proposed Change

### Spend policy fields

```json
{
  "max_cost_per_call_usdc": 0.10,
  "max_cost_per_session_usdc": 5.00,
  "max_cost_per_day_usdc": 50.00,
  "min_trust_status": "community_reviewed",
  "blocked_permissions": ["wallet", "terminal"],
  "allowed_networks": ["base"],
  "allowed_currencies": ["USDC"],
  "require_escrow_above_usdc": 1.00,
  "human_approval_above_usdc": 10.00,
  "blocked_categories": ["finance"],
  "allowed_registries": ["https://registry.opentrust.dev"]
}
```

### How agents use it

1. Operator configures a spend policy for the agent at deployment time.
2. Before calling any tool, the agent checks the tool's `commercial_status` against the policy.
3. If the tool's price exceeds `max_cost_per_call_usdc`, the agent refuses.
4. If the tool's `trust_status` is below `min_trust_status`, the agent refuses.
5. If the tool has any `blocked_permissions`, the agent refuses.
6. If the payment exceeds `human_approval_above_usdc`, the agent pauses and requests human approval.
7. If the payment exceeds `require_escrow_above_usdc` and the tool doesn't support escrow, the agent refuses.

### How tools use it

Tools that set `caller_requirements.require_spend_policy = true` check the `X-OpenTrust-Spend-Policy` header. This lets a tool verify the caller has been authorized to spend before initiating the payment flow — preventing situations where an agent starts a payment process it isn't allowed to complete.

### Embedding in agent identity

The spend policy can be embedded in the agent identity token (RFC 0002) so tools receive both identity and spending authorization in a single signed token.

## Alternatives Considered

**Per-call authorization (agent requests approval for each payment):** Too slow for autonomous agents. Works for `human_in_the_loop` type but not `autonomous`.

**Hard wallet balance limit:** Wallets already have balance limits. Spend policy adds *policy* constraints (which tools, which networks, which trust levels) that wallet balances don't express.

**No spend policy standard (each framework implements its own):** Rejected. Fragmentation means tools can't verify spend authorization across frameworks.

## Backwards Compatibility

Fully backwards compatible. `caller_requirements.require_spend_policy` defaults to `false`. Tools that don't check spend policies continue working. Only tools that opt in to `require_spend_policy = true` will reject callers without a valid policy.

## Orchestration Inheritance

When an agent spawns sub-agents, the spend policy propagates downward using the `sub_agent_policy` field:

- **`inherit`** — sub-agent gets the identical policy
- **`restrict`** (default) — `max_cost_per_call_usdc` and `max_cost_per_session_usdc` are divided by `(depth + 1)`, ensuring progressively tighter caps at each level
- **`deny`** — sub-agents may not incur any costs

`max_orchestration_depth` (default: 3) sets an absolute ceiling on how deep the chain can go. An agent at depth N refuses to spawn if `N >= max_orchestration_depth`.

## Experimental: Dynamic Budget Allocation

> **Status: experimental, disabled by default.** Set `dynamic_budget_allocation.enabled = true` to opt in. This sub-feature is not yet stable and may change before v1.0.

For orchestration systems that want finer-grained sub-agent control beyond the uniform restrict model, the `dynamic_budget_allocation` block enables:

- **Per-sub-agent absolute caps** (`max_usdc`): a named sub-agent can spend at most X USDC in this session regardless of the parent's remaining budget.
- **Per-sub-agent percentage caps** (`budget_percent`): a named sub-agent receives at most N% of the parent's remaining budget at spawn time. When both are set, the lower value wins.
- **Runtime adjustment** via `budget_adjustment_endpoint`: a trusted controller (human or AI agent) can push updated allocations mid-session via PATCH to the endpoint. The controller identity is declared in `allocation_controller`.
- **Audit log** (`audit_log_endpoint`): every spend event and allocation change is POSTed for human review.

Example:

```json
{
  "max_cost_per_session_usdc": 10.00,
  "sub_agent_policy": "restrict",
  "dynamic_budget_allocation": {
    "enabled": true,
    "allocations": [
      {
        "match": { "agent_slug": "research-agent" },
        "max_usdc": 3.00,
        "budget_percent": 40
      },
      {
        "match": { "agent_slug": "summarizer-agent" },
        "max_usdc": 1.00,
        "budget_percent": 15
      }
    ],
    "allocation_controller": {
      "type": "ai_agent",
      "agent_id": "opentrust.dev/acme/budget-optimizer"
    },
    "budget_adjustment_endpoint": "https://orchestrator.acme.com/budgets/session-123",
    "unallocated_fallback": "restrict",
    "audit_log_endpoint": "https://audit.acme.com/agent-spend"
  }
}
```

In this example, when the root agent spawns a `research-agent`, it gets the lower of $3.00 absolute or 40% of the parent's remaining balance at that moment. A separate `budget-optimizer` AI agent can PATCH the endpoint to rebalance allocations if the research task turns out to be cheaper than expected, freeing budget for other sub-agents.

The `budget_adjustment_endpoint` must authenticate the controller before applying changes. The protocol for that authentication is outside the scope of this RFC and left to implementers.

## Open Questions

- Should spend policies be signed by the operator or just presented as-is? (Signed is more secure but adds key management overhead for operators.)
- Should there be a standard for spend policy templates (e.g., "conservative", "standard", "permissive") that operators can reference instead of writing full policies?
- How should `human_approval_above_usdc` interact with `autonomous` agent type? (Currently: autonomous agents can never have human approval — should this be an error condition?)
- (Experimental) Should `budget_percent` be evaluated at spawn time (current design) or continuously? Continuous evaluation is more fair but much harder to implement correctly under concurrent sub-agents.
