# Sub-Agents and Orchestration Chains

## Overview

An agent can call another agent as if it were a tool. That sub-agent may in turn call other tools or agents. OpenTrust handles this through three mechanisms: the `agent` source format on passports, the call chain in agent identity tokens, and spend policy inheritance rules.

## An Agent as a Tool

Any agent that can be called externally should have a passport with `"agent"` in its `source_formats`. This signals to calling agents that the callee is non-deterministic in cost and depth.

```json
{
  "tool_identity": { "name": "Research Agent", "slug": "research-agent", "category": "research" },
  "source_formats": ["agent", "mcp"],
  "format_manifests": {
    "agent": {
      "framework": "custom",
      "max_sub_depth": 2,
      "spawns_agents": false,
      "entry_point": "run_research_task"
    }
  }
}
```

## The Call Chain

When Agent A spawns Sub-Agent B which calls Tool C, Tool C receives an agent identity header where:

- `call_chain` = `["agent-a-id", "agent-b-id"]`
- `depth` = `1`
- `spawned_by` = `"agent-a-id"`

The root operator — `call_chain[0]`'s operator — is financially responsible for all costs in the chain.

**Cycle detection:** Every tool and agent receiving a call checks whether its own `agent_id` or `slug` appears in `call_chain`. If it does, it rejects the call immediately. This prevents infinite loops.

```
Agent A (depth=0)
  spawns Sub-Agent B (depth=1, call_chain=["A"])
    calls Tool C      (depth=2, call_chain=["A","B"])  ← Tool C sees full chain
    spawns Sub-Agent D (depth=2, call_chain=["A","B"]) ← D inherits chain
      calls Tool C again ← Tool C detects "C" not in chain, allows
      spawns Sub-Agent A ← A detects its own id in chain, REJECTS
```

## Spend Policy Inheritance

Spend policy flows **down** the chain and can only get more restrictive, never more permissive.

The three inheritance modes set in `spend_policy.sub_agent_policy`:

**`inherit`** — Sub-agents get the same policy unchanged. Use when the orchestrator fully trusts its sub-agents.

**`restrict`** (default) — Budget caps are divided by `(depth + 1)`. An orchestrator with `max_cost_per_call_usdc: 1.00` at depth 0 passes `0.50` to depth-1 sub-agents, `0.33` to depth-2. Prevents runaway sub-agent spending.

**`deny`** — Sub-agents may not incur any costs. Use for read-only orchestration chains.

## Tool-Side Depth Limits

Tools with sensitive permissions can refuse to be called deep inside an unknown agent chain:

```json
"caller_requirements": {
  "max_caller_depth": 1,
  "deny_agent_callers": false
}
```

`max_caller_depth: 0` means only root agents (humans or directly-operated agents) can call this tool.

`deny_agent_callers: true` means the tool refuses all calls where the caller has `source_formats` containing `"agent"`.

## Worked Example

```
Operator configures Orchestrator with spend_policy:
  max_cost_per_call_usdc: 2.00
  max_orchestration_depth: 2
  sub_agent_policy: "restrict"
  min_trust_status: "community_reviewed"

Orchestrator (depth=0) spawns Research Sub-Agent (depth=1):
  → Research Sub-Agent inherits policy with max_cost_per_call_usdc: 1.00
  → Research Sub-Agent calls Web Search Tool (cost: 0.05 USDC) ✓
  → Research Sub-Agent calls Summarizer Tool (cost: 0.02 USDC) ✓
  → Research Sub-Agent tries to spawn another agent (depth=2):
      → depth=2 < max_orchestration_depth=2, allowed
      → nested agent inherits max_cost_per_call_usdc: 0.67

Orchestrator tries to spawn a third level (depth=3):
  → depth=3 >= max_orchestration_depth=2, REJECTED by spend policy
```

## `autonomous` Agents and `human_approval_above_usdc`

The spend policy field `human_approval_above_usdc` means "pause and ask a human before paying more than X." This only makes sense for `supervised` or `human_in_the_loop` agents.

**Rule:** If a spend policy contains `human_approval_above_usdc` and the agent identity token has `agent_type: "autonomous"`, the agent must treat any call that would exceed the threshold as a **hard block** — refuse the call, do not proceed, and log the refusal. An autonomous agent has no human to ask; proceeding would silently violate the policy intent.

Implementations should reject a spend policy with `human_approval_above_usdc` at policy-issue time if the target agent is `autonomous`. If enforcement happens at call time instead, refuse and surface the policy contradiction to the operator.

---

## Sub-Agent Passport Trust Interaction

When a parent agent (Agent A) spawns a sub-agent (Agent B) where Agent B is itself a registered tool with `source_formats: ["agent"]`, two separate trust decisions occur:

1. **Agent A evaluates Agent B's passport** before spawning — applies `min_trust_status` from Agent A's spend policy. If Agent B's passport trust is too low, Agent A refuses to spawn.
2. **Agent B's own calls** inherit the spend policy passed down the chain (inherit/restrict/deny rules apply as normal).

The key clarification: Agent A's spend policy `min_trust_status` applies to Agent B as a tool. If Agent A's policy says `min_trust_status: "community_reviewed"`, then Agent B's passport must be at `community_reviewed` or higher for Agent A to spawn it.

Additionally: if Agent A's policy includes `blocked_permissions`, those permissions are checked against **Agent B's passport's permission_manifest** as well as against individual tools Agent A calls directly.

```
Agent A (spend_policy.min_trust_status: "community_reviewed")
  → checks Agent B's passport trust_status before spawning
  → Agent B: trust_status="creator_claimed" → REJECTED (below threshold)
  → Agent B: trust_status="community_reviewed" → ALLOWED, spawn with restricted policy
```

This prevents operators from accidentally using a poorly-reviewed orchestration agent even if they trust the tools that agent calls.

---

## Dynamic Budget Allocation (Experimental)

> Disabled by default. Enable with `dynamic_budget_allocation.enabled = true` in the spend policy.

The `restrict` mode divides budget uniformly across all sub-agents. Dynamic allocation lets operators (or a trusted AI agent) assign named sub-agents specific caps:

- **Absolute cap** (`max_usdc`): a sub-agent may spend at most X USDC total in the session.
- **Percentage cap** (`budget_percent`): a sub-agent receives at most N% of the parent's *remaining* budget at the moment it is spawned. The orchestrator atomically reserves this allocation before spawning — concurrent sub-agent spawning cannot double-spend the same budget percentage.
- When both are set, the lower value wins.
- If the parent's remaining budget is $0 when a sub-agent would be spawned, `budget_percent` evaluates to $0 and the sub-agent must not be spawned.

Budget allocations can be updated mid-session by pushing a PATCH to `budget_adjustment_endpoint`. The `allocation_controller` field declares who is trusted to do this — a human operator, a named AI agent, or both.

```json
"dynamic_budget_allocation": {
  "enabled": true,
  "allocations": [
    { "match": { "agent_slug": "research-agent" }, "max_usdc": 3.00, "budget_percent": 40 },
    { "match": { "agent_slug": "writer-agent" },   "max_usdc": 1.50, "budget_percent": 20 }
  ],
  "allocation_controller": {
    "type": "ai_agent",
    "agent_id": "opentrust.dev/acme/budget-optimizer"
  },
  "budget_adjustment_endpoint": "https://orchestrator.acme.com/budgets/session-abc",
  "unallocated_fallback": "restrict"
}
```

Sub-agents not matched by any `allocations` entry fall back to `unallocated_fallback` (`restrict` by default). The feature is fully backwards compatible — when `enabled: false` (the default), it is ignored entirely.

## Headers Reference

| Header | Set by | Read by |
|---|---|---|
| `X-OpenTrust-Agent-Identity` | Every agent in the chain | Tools, sub-agents |
| `X-OpenTrust-Spend-Policy` | Root operator | Tools that require it |
| `X-OpenTrust-Call-Chain` | Propagated through chain | Any recipient for cycle detection |

The `call_chain` is embedded inside the agent identity token — it is not a separate header. Recipients extract it from the signed token so it cannot be forged.
