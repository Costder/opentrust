# RFC 0008: ARIA Protocol Interoperability

- **Status:** accepted
- **Author:** Costder
- **Created:** 2026-05-18
- **PR:** (link to the PR)

## Summary

This RFC establishes formal interoperability between ARIA (https://www.aria.bar) and OpenTrust through an `aria_policy` field in `caller_requirements`. ARIA answers "who is the agent?" while OpenTrust answers "what can this tool do and who reviewed it?" Together they close a security gap: independently, each standard leaves agents vulnerable to supply-chain attacks exploited by 30+ MCP CVEs.

## Motivation

The ARIA Protocol and OpenTrust solve complementary security problems:

- **ARIA**: Defines agent identity and verifiable trust levels (L0–L3) via an Agent Identification Document (AID). Answers "who is the agent calling this tool?"
- **OpenTrust**: Defines tool trust through review signatures and permission manifests. Answers "what can this tool do and who reviewed it?"

However, neither standard alone is sufficient:

1. **Without ARIA**: An OpenTrust passport can attest that a tool is trustworthy, but gives no mechanism for a tool to trust the calling agent. A high-privilege tool (wallet access, payments) must accept any agent, or gate access by crude methods (org membership, static IP).

2. **Without OpenTrust**: An ARIA AID can prove the agent's identity and trust level, but the agent has no way to know if the tool it is about to call is actually trustworthy. An untrusted agent can call any tool and read/exfiltrate data.

This gap is not theoretical. The 30+ MCP CVEs catalogued in public disclosures (e.g., model-context-protocol/specification issues) overwhelmingly fall into two categories: (a) agents calling malicious tools disguised as legitimate ones, and (b) tools accepting calls from untrusted agents due to lack of caller verification.

**Proposed solution**: Add `aria_policy` to `caller_requirements` so that tools can express minimum ARIA trust levels for callers, and add support for `did:aria` as a reviewer identity type (RFC 0006) so that ARIA-coordinated organizations can sign tool reviews.

## Proposed Change

### 1. Schema Addition: `aria_policy` in `caller_requirements`

Add the following to `passport-schema/passport.schema.json` in the `caller_requirements.properties` object:

```json
"aria_policy": {
  "type": "object",
  "description": "ARIA Protocol policy for callers. ARIA (https://www.aria.bar) defines agent identity and trust levels (L0-L3). When set, the tool runtime must verify the calling agent's ARIA identity before executing the call.",
  "properties": {
    "min_level": {
      "type": "string",
      "enum": ["L0", "L1", "L2", "L3"],
      "description": "Minimum ARIA trust level required. L0=anonymous, L1=identity_declared, L2=verified_operator, L3=certified_enterprise."
    },
    "require_intent_declaration": {
      "type": "boolean",
      "default": false,
      "description": "If true, the calling agent must include an ARIA intent declaration in the call headers."
    },
    "require_principal_ref": {
      "type": "boolean",
      "default": false,
      "description": "If true, the calling agent must present a principal reference (human operator identity) from their ARIA Agent Identification Document."
    },
    "verify_endpoint": {
      "type": "string",
      "format": "uri",
      "description": "ARIA verification endpoint. If omitted, the ARIA public verifier is used.",
      "examples": ["https://api.aria.bar/v1/verify/{did}"]
    }
  },
  "additionalProperties": false
}
```

**Field semantics**:

- `min_level`: Gates access by ARIA trust level. If omitted, no ARIA trust check is performed (backwards compatible).
- `require_intent_declaration`: When true, the agent must declare its intent in the ARIA AID presentation (e.g., "read user data", "make payment"). The tool runtime verifies that the intent matches a permitted action.
- `require_principal_ref`: When true, the agent must include the principal (human operator) identity from the ARIA AID. Used for audit trails and accountability in enterprise settings.
- `verify_endpoint`: Specifies a custom ARIA verification endpoint. If omitted, runtimes use the ARIA public verifier at `https://api.aria.bar/verify`.

### 2. ARIA Trust Level Mapping

The OpenTrust trust landscape is extended to include ARIA trust levels:

| ARIA Level | Meaning | Equivalent OpenTrust caller trust |
|-----------|---------|-----------------------------------|
| L0 | Anonymous (no identity) | none |
| L1 | Identity declared (agent claims identity, unverified) | identity_declared |
| L2 | Verified operator (agent identity verified by issuer) | org_verified |
| L3 | Certified enterprise (agent identity certified and monitored) | platform_verified |

Tools that set `aria_policy.min_level` benefit from this mapping: a tool requiring `min_level: L2` implicitly requires `min_agent_trust_status: org_verified` at the OpenTrust level.

### 3. Reviewer Identity: Support for `did:aria`

RFC 0006 (Reviewer Identity) is extended to support `did:aria` as a DID method for attestation signatures. This allows ARIA-coordinated organizations to sign tool reviews within their authority scope.

Example reviewer identity using ARIA DID:

```json
{
  "status": "reviewer_signed",
  "timestamp": "2026-05-18T14:00:00Z",
  "reviewer": "aria-security-council",
  "reviewer_identity": {
    "type": "did",
    "did": "did:aria:security.aria.bar",
    "verification_method": "did:aria:security.aria.bar#key-1",
    "public_key_jwk": {
      "kty": "OKP",
      "crv": "Ed25519",
      "x": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"
    }
  },
  "attestation": {
    "key_id": "did:aria:security.aria.bar#key-1",
    "algorithm": "ed25519",
    "signature": "base64url-encoded-signature-here",
    "payload": "my-tool:1.0.0:reviewer_signed:2026-05-18T14:00:00Z"
  }
}
```

### 4. Agent → Tool Call Lifecycle

When an agent calls a tool, the following verification steps occur:

```
[Agent with ARIA AID]
        │
        ├─ ARIA: Identify the agent
        │  - Fetch Agent Identification Document
        │  - Verify AID signature and revocation status
        │  - Extract trust level (L0–L3) and principal reference
        │
        ▼
[Tool Gateway]
        │
        ├─ Check 1: ARIA Policy Enforcement
        │  - Fetch tool passport
        │  - Read caller_requirements.aria_policy
        │  - Compare agent's ARIA trust level vs aria_policy.min_level
        │  - Check intent_declaration and principal_ref if required
        │  - If ARIA check fails: reject the call
        │
        ├─ Check 2: OpenTrust Trust Status
        │  - Verify trust_status and revocation
        │  - Check permission_manifest scopes
        │  - Verify reviewer signatures (including did:aria identities)
        │  - If OpenTrust check fails: reject the call
        │
        ▼
[Tool Call Execution]
```

## Alternatives Considered

**1. Embed ARIA identity in OpenTrust `agent_identity`**: Instead of a separate `aria_policy`, embed ARIA DIDs directly in the `agent_identity` field. This was rejected because it conflates two independent standards. OpenTrust defines a caller trust model (min_agent_trust_status) that pre-dates ARIA; merging ARIA into it would impose ARIA as the sole agent identity standard, breaking compatibility with existing agents that use GitHub or other identities. Separation of concerns keeps the standards independent and composable.

**2. Use ARIA as the only reviewer identity method**: Require all tool reviewers to obtain ARIA DIDs and sign reviews using ARIA identities. This was rejected because it raises the barrier to review participation. Individual researchers, small teams, and open-source projects already use GitHub for code signing; requiring ARIA adoption would exclude them from the review ecosystem.

## Backwards Compatibility

`aria_policy` is an optional field within `caller_requirements`. Existing passports that lack it continue to validate correctly and function unchanged.

- Passports without `aria_policy`: Runtimes ignore the field and do not perform ARIA trust checks. Tools work as before.
- Runtimes without ARIA support: They can safely ignore `aria_policy` and rely on existing `min_agent_trust_status` checks. Tools that require ARIA will reject ARIA-unaware agents at runtime (expected behavior).
- Passports with `did:aria` reviewer identities: Runtimes that do not support ARIA can verify signatures if they have other reviewer identity methods (GitHub, other DIDs) in the `review_history`. If no supported identity method is present, signature verification fails, but the tool's trust_status may still be valid (e.g., `community_reviewed`).

No migration is required. Existing passports remain valid.

## Open Questions

1. **Verification endpoint default**: Should `aria_policy.verify_endpoint` default to the ARIA public verifier (`https://api.aria.bar/verify`), or be required when `aria_policy` is set? Defaulting improves usability but requires network dependency; requiring it gives tools explicit control over which verifier they trust.

2. **ARIA revocation and trust demotion**: If an agent's ARIA trust level is revoked (e.g., the agent was compromised), should the tool automatically demote the agent's caller trust status from `org_verified` to `identity_declared`? Or should revocation only block the agent from future calls without retroactively affecting past decisions?

3. **Intent declaration semantics**: The `require_intent_declaration` field requires agents to declare their intent, but OpenTrust does not currently define a formal intent schema. Should this RFC define the intent schema and a registry of valid intent values (e.g., `read:user_data`, `modify:permissions`, `send:money`), or is intent declaration left to tool implementers?

4. **Namespace collision**: The ARIA DID method `did:aria` may conflict with other standards in the future. Should the protocol include a versioning or scoping mechanism (e.g., `did:aria:v1:...`) to avoid collisions?
