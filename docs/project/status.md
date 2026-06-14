# OpenTrust Project Status

OpenTrust is live at [opentrust.sh](https://opentrust.sh). The reference API health endpoint is [api.opentrust.sh/api/v1/health](https://api.opentrust.sh/api/v1/health).

The project is still early, but it is no longer just a schema. The repository now contains the passport registry, marketplace primitives, SDKs, CLI, web frontend, Hands Body and Feet MCP server, and the first OpenTrust Gateway runtime.

## Live Surfaces

| Surface | Status |
|---|---|
| Web registry | Live at `https://opentrust.sh` |
| Registry API | Live health check at `https://api.opentrust.sh/api/v1/health` |
| Passport schema | Stable `spec_version: 1.0.0` baseline |
| CLI | Installable as `opentrust-cli` |
| Python SDK | Installable as `opentrust-sdk` |
| TypeScript client | Installable as `@infinitestudios/opentrust-client` |
| Hands Body and Feet | `@infinitestudios/hands-body-and-feet` `2.3.0` |
| Gateway runtime | Private workspace package `@infinitestudios/opentrust-gateway` `0.1.0` |

## Implemented In The Repo

- Passport schema, examples, validator, badge generator, and CLI flows.
- FastAPI registry with passport, marketplace, payment, claim, OAuth, and trust-control routes.
- Next.js registry frontend with tool browsing, claim flows, marketplace surfaces, and gateway UI.
- Hands Body and Feet MCP server with stdio and HTTP modes.
- Gateway control plane APIs for connector registration and policy.
- Gateway runtime with REST tool calls, policy enforcement, hosted Hands Body and Feet adapter, remote MCP adapter, and local connector support.
- Payment contract interfaces and demo/mock payment provider.

## Recent Verification

Focused verification after the gateway MVP passed:

- `python -m pytest api/tests -q`
- `npm test`, `npm run typecheck`, and `npm run build` in `packages/opentrust-gateway`
- `npm test` and `npm run build` in `web`

Known caveat: package audit findings still need separate dependency triage; the gateway package install reported moderate through critical audit items inherited from the current dependency graph.

## Product Direction

The product goal is broader than an open-source protocol. OpenTrust should become the easiest default place for developers, businesses, MCP servers, agents, humans, companies, jobs, payments, reviews, and reputation to connect safely.

The gateway is central to that direction: it lets agents use risky and valuable tools through a single policy-enforced surface instead of asking each developer to build safety, billing, trust checks, and credential controls from scratch.

## Token Clarification

OpenTrust has no affiliated token, memecoin, or cryptocurrency. The project may use USDC as a machine-native payment rail for agent workflows, but it does not launch, authorize, or endorse a speculative token.
