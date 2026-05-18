# Architecture

OpenTrust is a neutral open standard. This repo is the complete reference implementation — there is no private companion repo.

The public repo contains everything:

- **Schemas** — `passport-schema/` is the canonical spec (JSON Schema)
- **Registry API** — `api/` FastAPI app: passport CRUD, search, GitHub OAuth, badges, claim flow
- **CLI** — `cli/` opentrust CLI: inspect, validate, search, claim, badge
- **Web** — `web/` Next.js frontend: directory, passport pages, claim flow
- **Generators** — `passport-generator/`, `badge-generator/`, `manifest-validator/`
- **Docs and RFCs** — `docs/`, `rfcs/`

## Agent → Tool Call Lifecycle

When an agent calls a tool, two independent standards work together:

- **ARIA** (https://www.aria.bar) answers: *Who is the agent?*
- **OpenTrust** answers: *What is the tool and who reviewed it?*

### Call verification flow

```
[Agent with ARIA AID]
        │
        │  ARIA: Identify the agent
        │  - Agent Identification Document (AID)
        │  - Trust levels: L0 (anonymous) → L3 (certified enterprise)
        │  - Operator principal reference
        │  - Intent declaration
        │
        ▼
[Tool Gateway]
        │
        ├─ Step 1: ARIA Trust Check
        │  - Fetch tool passport
        │  - Read caller_requirements.aria_policy
        │  - Verify agent's ARIA trust level ≥ aria_policy.min_level
        │  - Check intent_declaration and principal_ref if required
        │  - Verify ARIA AID signature and revocation status
        │  → Reject if ARIA check fails
        │
        ├─ Step 2: OpenTrust Trust Verification
        │  - Check tool's trust_status and revocation
        │  - Verify permission_manifest scopes against call parameters
        │  - Validate reviewer signatures (including did:aria identities)
        │  → Reject if trust checks fail
        │
        ▼
[Tool Call Execution]
        │
        └─ Tool executes with knowledge of:
           - Caller's ARIA trust level (for audit, rate limiting, fees)
           - Tool's permission scope (what it can access)
           - Review authority (who signed the tool review)
```

**ARIA–OpenTrust mapping**: ARIA trust levels map to OpenTrust caller trust:

| ARIA Level | OpenTrust Equivalent | Meaning |
|-----------|----------------------|---------|
| L0 | none | Anonymous |
| L1 | identity_declared | Identity claimed, unverified |
| L2 | org_verified | Identity verified by issuer |
| L3 | platform_verified | Certified and monitored |

For interoperability details and the `aria_policy` schema, see [RFC 0008: ARIA Protocol Interoperability](../rfcs/0008-aria-interoperability.md).

## Payment endpoints

The registry API exposes open-source demo payment endpoints (`POST /payments/checkout`, `/payments/verify`, `/subscriptions/create`) backed by the mock provider. Escrow remains outside the demo flow and is defined by the OpenTrust payment contract schema for operators that need it.

**Registry operators** who deploy their own instance of this registry can replace the mock provider against the schema in `passport-schema/commercial-status.schema.json` and `passport-schema/escrow.schema.json`. The reference registry defines what a conforming payment integration must look like. Contributions implementing production providers are welcome via RFC and PR.
