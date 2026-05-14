# OpenTrust Governance

## Principles

OpenTrust is an open standard. It is not controlled by any single model provider, agent framework, or company. The spec exists to serve the people building and using AI agent tools, not the interests of any particular platform.

The governance model is designed to:
- Keep the standard stable and trustworthy
- Give the community a real voice in how it evolves
- Make it easy for individuals to contribute without requiring corporate backing
- Create a clear path toward neutral foundation governance as adoption grows

## Current Stage: Founder-Led Open Standard

OpenTrust is currently in the founder-led stage. This is normal and healthy for a new standard — it needs a clear point of accountability and fast decision-making while the core spec is being established.

What this means in practice:
- The spec maintainer ([@Costder](https://github.com/Costder)) has final say on RFC decisions
- All decisions are made publicly, in the open, with written rationale
- The RFC process ensures community input before any change ships
- No changes to the trust ladder, permission schema, or passport format happen without an RFC

This stage is expected to last until the spec reaches v1.0 stability and has meaningful adoption across multiple ecosystems.

## Roles

### Spec Maintainer

Currently: [@Costder](https://github.com/Costder)

Responsibilities:
- Merge or reject RFCs with written rationale
- Maintain backwards compatibility commitments
- Represent the standard in cross-ecosystem conversations
- Identify and onboard co-maintainers as the project grows

The maintainer role is not a product manager role. The maintainer does not run the day-to-day registry, does not manage billing, and does not handle support. Those concerns belong to whoever deploys an OpenTrust instance.

### Co-Maintainers

Co-maintainers can be added by the spec maintainer. They have commit access and can independently review and merge non-RFC PRs. RFC decisions require the spec maintainer.

### Contributors

Anyone can contribute via pull request. See [CONTRIBUTING.md](../CONTRIBUTING.md).

### Ecosystem Liaisons (Future)

As OpenTrust gains adoption in specific frameworks (MCP, LangChain, OpenAI, etc.), ecosystem liaisons can be designated to represent the concerns of that community in RFC discussions. This role is advisory — liaisons do not have merge rights but their input is explicitly solicited for relevant RFCs.

## RFC Decision Process

See [rfcs/README.md](../rfcs/README.md) for the full RFC process.

Summary:
- Anyone can propose an RFC
- Minimum 14-day comment period (28 days for breaking changes)
- Maintainer makes the final accept/reject call with written rationale
- Accepted RFCs are binding — implementation must match the RFC

## Backwards Compatibility

Once a field or behavior is documented as stable, it will not be removed or changed in a breaking way without a deprecation period of at least one major version. The trust status enum values are considered stable as of v1.0.

`auto_generated_draft` passports and fields marked as experimental are excluded from this guarantee.

## Path to Foundation Governance

The long-term goal is for the OpenTrust spec to be governed by a neutral foundation — most likely CNCF (Cloud Native Computing Foundation), which governs Kubernetes, OpenTelemetry, and other infrastructure standards that AI tooling is building on top of.

This transition will happen when:
1. The spec reaches v1.0 stability
2. There are at least 3 independent implementations (different organizations, not forks)
3. At least 2 major agent frameworks have adopted the passport format
4. The maintainer has identified co-maintainers from outside SoulForge

The foundation submission will propose that the spec maintainer becomes the initial CNCF project lead, with governance transitioning to a Technical Steering Committee over time.

## What OpenTrust Will Not Do

- OpenTrust will not become the exclusive trust layer for any single platform.
- OpenTrust will not allow any model provider or framework to have veto power over spec decisions.
- OpenTrust will not make backwards-incompatible changes to stable fields without a documented migration path.
- The spec maintainer will not hold any equity or financial interest in tools listed in the registry.

## Trust Status Demotion

Trust status advances forward through the ladder but can also go backward in two defined ways:

### Disputed (at any level)

Any community member can file a quality or trust dispute. When a dispute is opened, `trust_status` is set to `disputed` immediately. The passport is not agent-usable while disputed. Dispute resolution follows the escrow dispute tiers (or a simplified 2-party process for non-payment disputes).

### Automated demotion from `continuously_monitored`

A tool at `continuously_monitored` (level 7) is demoted to `disputed` automatically when:

- The rolling 24-hour error rate (failure + timeout outcomes reported via `POST /api/v1/outcomes`) exceeds **15%** across at least 100 reported calls
- OR any of its direct dependencies are revoked or disputed
- OR its monitoring subscription lapses (status drops to `security_checked` after 30-day grace period)

When automated demotion triggers:
1. The registry sets `trust_status = disputed` and timestamps the demotion.
2. The tool author is notified via email with the specific trigger condition and metric values.
3. The author has 72 hours to respond before the status change is published publicly.
4. If the author provides evidence that resolves the trigger (e.g., fixes the error rate issue), a reviewer can clear `disputed` and restore the prior status. This requires a new reviewer attestation.

This process is defined in the registry API spec (outcome reporting section) and not in the passport schema itself.

---

## Passport Ownership Disputes

Ownership disputes are separate from quality/trust disputes. They handle the case where a slug has been claimed by someone who is not the legitimate tool author.

### Anti-squatting rule

If a tool's `tool_identity.source_url` points to a GitHub repository, and a person different from the current claimant can prove they own or control that repository via GitHub OAuth, the registry initiates an ownership dispute:

1. The registry notifies the current claimant.
2. The current claimant has 7 days to provide evidence of legitimate ownership.
3. If no valid counter-evidence is provided, the registry transfers the claim to the verified owner.
4. If the original claim was fraudulent, the claimant's account is flagged and all their claimed passports are downgraded to `disputed`.

See `POST /api/v1/disputes/ownership` in [api-spec.md](api-spec.md).

---

## Registry Self-Verification (Bootstrapping)

The OpenTrust CLI and the reference registry are themselves tools that agents interact with. They cannot be self-reviewed by the spec maintainer.

### Solution

The reference registry's passport is reviewed by the **first two co-maintainers** recruited from outside SoulForge — this is one of the conditions for the CNCF transition anyway. Until co-maintainers exist, the registry passport carries `trust_status: "creator_claimed"` with a public note explaining the bootstrapping situation.

The CLI passport is reviewed by at least one co-maintainer and one community reviewer who is not affiliated with the project. This review is a hard requirement before the CLI reaches `reviewer_signed` status — there is no exception for first-party tools.

This bootstrapping limitation is documented here rather than hidden. Users evaluating OpenTrust should be aware that the reference registry currently operates on `creator_claimed` trust, and what that means: the creator has verified they own the source repository, but no independent reviewer has signed off. This is the same trust level as many legitimate third-party tools at initial registration.

---

## Questions

Open a GitHub Discussion or reach out to [@Costder](https://github.com/Costder).
