# Registry Data Handling and Privacy

OpenTrust passports contain data about the people who create and maintain tools — names, GitHub handles, domains, and email addresses. This document describes what data the reference registry collects, how it is used, and what rights tool authors and reviewers have over their data.

This policy applies to the reference registry operated at `registry.opentrust.dev`. Operators running private registries must write their own data handling policy.

---

## What Data the Registry Stores

### Tool author data

When a tool author claims a passport via GitHub OAuth, the registry stores:

| Data | Purpose | Retention |
|---|---|---|
| GitHub username | Verifies claim ownership | Retained as long as the claim exists |
| GitHub OAuth access token | Used once to verify identity; not stored | Not retained after verification |
| Email address (from GitHub profile) | Sends key expiry and notification emails | Retained as long as the claim exists |
| IP address at time of claim | Anti-squatting / fraud investigation | 90 days |

### Reviewer data

| Data | Purpose | Retention |
|---|---|---|
| GitHub username | Links attestation to reviewer identity | Retained indefinitely (part of signed review record) |
| Ed25519 public key | Enables offline attestation verification | Retained as long as reviewer is active; 7 years after deregistration |
| Review history | Verifiable audit trail | Indefinite (signed, immutable records) |
| IP address during review | Fraud investigation | 90 days |

### Passport content

Passport content is submitted by tool authors and is treated as **public data**. It is served publicly via the API and well-known endpoints. Tool authors are responsible for ensuring they have the right to submit any information they include in their passports (e.g., they should not include PII about third parties).

### Operator key data

Ed25519 public keys registered by agent operators are stored publicly and served via `/.well-known` endpoints. The key_id and associated operator identity are public. Private keys are never stored or transmitted.

### Outcome reports

Anonymized outcome reports submitted via `POST /api/v1/outcomes` are stored with `caller_agent_id` for fraud detection. After 30 days, they are aggregated into trust metrics and the individual report records are deleted.

---

## Legal Bases for Processing (GDPR)

| Processing activity | Legal basis |
|---|---|
| Storing tool author identity for claim verification | Contract — necessary to provide the claim verification service the author requested |
| Storing reviewer keys and review history | Legitimate interests — maintaining the integrity of an auditable trust record |
| IP address logging for fraud prevention | Legitimate interests — preventing abuse of the registry |
| Sending key expiry notifications | Contract — necessary to maintain service availability the operator subscribed to |
| Publishing passport content | Consent — tool authors explicitly submit this data for publication |

---

## Data Subject Rights

### For EU/UK/EEA residents (GDPR / UK GDPR)

You have the right to:

- **Access** — request a copy of all personal data the registry holds about you
- **Rectification** — correct inaccurate data (note: signed review records cannot be altered without breaking the cryptographic chain)
- **Erasure** — request deletion of your claim, reviewer registration, or operator keys. Note: signed review attestations in the `review_history` of published passports cannot be erased without invalidating the cryptographic audit trail; instead, the registry will remove your personal data from its internal records while leaving the public-key-verifiable signature intact.
- **Restriction** — request that processing be restricted while a dispute is being investigated
- **Portability** — receive your data in a machine-readable format
- **Object** — object to processing based on legitimate interests

To exercise any of these rights: email `https://github.com/Costder/opentrust/issues (label: privacy)` (placeholder — update when domain is registered).

### For California residents (CCPA)

You have the right to:
- Know what personal information is collected and how it is used
- Opt out of sale of personal information (we do not sell personal information)
- Delete personal information (same caveats as erasure under GDPR above)
- Non-discrimination for exercising these rights

---

## Data Processing Agreement

Enterprise users who need a Data Processing Agreement (DPA) for GDPR compliance can request one at `https://github.com/Costder/opentrust/issues (label: privacy)`. A standard DPA template will be published in this repository under `docs/legal/dpa.md` when available.

---

## Registry as Sub-Processor

If your organization uses the OpenTrust registry as part of a product or service you provide to end users, you may be required to disclose OpenTrust as a sub-processor in your own privacy policy. The registry's sub-processor information:

- **Entity:** SoulForge (operator pending legal formation)
- **Data processed:** Tool author identity, reviewer keys, operator keys
- **Location:** United States (specific region TBD at deployment)
- **Transfer mechanism:** Standard Contractual Clauses (SCCs) for EU data transfers

---

## Security Measures

The registry applies the following technical measures to protect personal data:

- All data at rest is encrypted (AES-256)
- All data in transit uses TLS 1.3
- GitHub OAuth tokens are used once and discarded; only the verified identity is retained
- Access to production data requires MFA and is logged
- IP addresses are stored in a separate, access-controlled table and purged on schedule

---

## Data Breach Notification

In the event of a data breach affecting personal data, the registry operator will:

1. Notify affected users within 72 hours of discovery (GDPR requirement)
2. Notify relevant supervisory authorities within 72 hours where required
3. Publish a breach notice at `https://status.opentrust.dev`

---

## Contact

Privacy questions: Open an issue at https://github.com/Costder/opentrust/issues with the label `privacy`.

Registry operator: Joshua / SoulForge
