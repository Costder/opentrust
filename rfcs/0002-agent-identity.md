# RFC 0002: Agent Identity

- **Status:** accepted
- **Author:** Costder
- **Created:** 2026-05-14

## Summary

Defines a standard identity format for AI agents calling OpenTrust-registered tools. The v1 spec covers tool identity (passports) but has no concept of caller identity. This RFC adds the missing half — the agent presenting its identity to a tool before calling.

## Motivation

Today, tools have passports. Agents calling tools have no identity. This creates three real problems:

**1. Tools can't gate access by caller trust.** A sensitive tool (wallet access, private data) has no way to require that only verified agents call it. Any caller gets the same access.

**2. Audit trails are incomplete.** When a tool is called, the log shows a payment transaction but not which agent made it, on behalf of which operator, or under what authorization.

**3. Spend authorization is unverifiable.** When an agent pays for a tool, the tool has no way to know whether the agent was actually authorized by its operator to make that payment, or whether it's acting outside its mandate.

## Proposed Change

### Agent Identity Token

An agent identity is a signed JSON document (presented as a JWT or base64-encoded JSON) in the `X-OpenTrust-Agent-Identity` HTTP header. It declares:

- `agent_id` — globally unique: `{registry}/{org}/{agent-slug}`
- `agent_type` — `autonomous`, `supervised`, or `human_in_the_loop`
- `operator` — verified identity of the person/org running the agent
- `trust_status` — the agent's own verification level
- `spend_policy` — embedded spend policy so tools can verify the agent is authorized to pay
- `signature` — Ed25519 signature over the canonical token payload

### Tool Caller Requirements

Tools declare what they require from callers in `caller_requirements`:

```json
"caller_requirements": {
  "min_agent_trust_status": "github_verified",
  "require_agent_identity": true,
  "allowed_orgs": ["acme-corp"],
  "require_spend_policy": true
}
```

### Agent Trust Levels

Five levels for agent callers, separate from the tool trust ladder:

| Level | Meaning |
|---|---|
| `none` | No identity required |
| `identity_declared` | Agent presents a token (may be unverified) |
| `github_verified` | Operator's GitHub identity is verified |
| `org_verified` | Operator's organization is verified |
| `platform_verified` | Agent is registered and verified on an OpenTrust registry |

### Header format

```
X-OpenTrust-Agent-Identity: eyJhZ2VudF9pZCI6...  (base64url-encoded signed token)
X-OpenTrust-Spend-Policy: eyJtYXhfY29zdF9...      (base64url-encoded spend policy, if required)
```

## Alternatives Considered

**OAuth 2.0 client credentials:** Rejected. Requires a token exchange server, adds latency, doesn't work well for autonomous agents that need to call novel tools without pre-registration.

**API keys:** Rejected. Static, not portable across registries, don't carry spend policy or operator identity.

**No caller identity (status quo):** Rejected. Breaks enterprise use cases and prevents tools from gating access by caller trust.

## Backwards Compatibility

Fully backwards compatible. `caller_requirements` defaults to `min_agent_trust_status: "none"` and `require_agent_identity: false`. Existing tools that don't set `caller_requirements` remain open to all callers. Tools that want to require identity opt in explicitly.

## Open Questions

- Should agent identity tokens have a registry-issued component (registry signs the agent's identity) or be purely operator-self-signed?
- What is the revocation mechanism for a compromised agent identity token?
- Should `agent_type` affect what a tool allows (e.g., require `human_in_the_loop` for irreversible actions)?
