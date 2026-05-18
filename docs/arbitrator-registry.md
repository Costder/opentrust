# OpenTrust Arbitrator Registry

This document lists community arbitrators who volunteer to resolve Tier 3 human arbitration disputes on behalf of OpenTrust users.

## Requirements to Serve as an Arbitrator

- **Verified identity:** GitHub OAuth, DID, or equivalent `reviewer_signed` credential
- **No financial relationship:** You must not hold a financial stake in any listed tool or have a direct financial relationship with dispute parties
- **Availability:** You must be able to respond within 4 hours during your declared availability window
- **Impartiality:** You must recuse yourself when a conflict of interest exists (prior relationship with party, prior review of their work, financial stake in outcome)

## How to Join the Arbitrator Registry

1. Fork this repository
2. Add your entry to the [Founding Arbitrators](#founding-arbitrators) section below (or a new section if the founding tier is full)
3. Include:
   - Your GitHub handle or DID
   - Link to your verified identity (GitHub profile URL with public keys displayed)
   - Your timezone and availability window (e.g., "UTC+0, weekdays 09:00-18:00")
   - Brief description of your expertise relevant to OpenTrust disputes (MCP security, agent payments, smart contracts, etc.)
   - Any relevant notes
4. Submit a pull request
5. **Public comment period:** 7 days for the community to raise concerns
6. **Approval:** The spec maintainer approves or requests changes; no financial interest from maintainer in your acceptance
7. **Merge:** Once approved, you are added to the registry

## Founding Arbitrators

### @Costder (spec maintainer)

- **Identity:** GitHub — [https://github.com/Costder.keys](https://github.com/Costder.keys)
- **Timezone:** UTC+0
- **Availability:** Weekdays 09:00–18:00
- **Expertise:** Protocol design, MCP security, agent payments, passport schema
- **Note:** Available as arbitrator of last resort only. Not assigned to disputes involving tools under Costder's direct maintenance. Recuses when conflict exists.

### [Position Open — Co-Maintainer 1]

**Seeking:** Security researcher with MCP, LLM tooling, or smart contract security experience. Preference for applicants with publication history or open-source contributions in security.

### [Position Open — Co-Maintainer 2]

**Seeking:** Developer with smart contract, payment systems, or escrow implementation experience. Preference for applicants with production experience in fintech or Web3.

## Arbitrator Conduct Rules

All arbitrators must adhere to these five rules:

1. **Timely decisions:** Issue decisions within the declared SLA (48 hours for Tier 3, 72 hours for appeal panels). Missing the deadline without extenuating circumstances results in removal.

2. **Written rationale:** Every decision must include a written explanation of how you interpreted the delivery standard and why the outcome is appropriate. Decisions without rationale are invalid.

3. **Recusal:** Recuse yourself immediately if a conflict of interest exists:
   - You have previously reviewed or worked with either party
   - You have a financial stake in the outcome
   - You have publicly stated a position on this dispute
   - You have a family or close professional relationship with either party

4. **Confidentiality:** Do not discuss ongoing disputes publicly, in social media, in Discord, or in any forum until the decision is published. Confidentiality applies during the appeal window as well.

5. **Finality:** Accept panel decisions as final. If you are on a 3-arbitrator appeal panel and outvoted, you do not re-litigate the issue in public or attempt to override the majority decision.

Violations of these rules result in removal from the registry and a public record of the violation.

## Arbitrator Support

- **Training:** New arbitrators receive a briefing on the OpenTrust dispute model and the escrow schema before their first assignment.
- **Tools:** The registry provides a web interface for dispute submission, response review, and decision recording.
- **Community:** Arbitrators can discuss trends and edge cases in a private Slack channel (invitation on assignment).

---

## Questions

Open a GitHub Discussion or reach out to [@Costder](https://github.com/Costder).
