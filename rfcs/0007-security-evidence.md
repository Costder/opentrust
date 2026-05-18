# RFC 0007: Security Evidence in review_history

- **Status:** accepted
- **Author:** Costder
- **Created:** 2026-05-18
- **PR:** (link to the PR)

## Summary

The `security_checked` (and `continuously_monitored`) trust levels claim that a tool has passed security review, but the `review_history` schema accepts that claim with no machine-verifiable proof. This RFC adds an optional `security_evidence` field to `review_history` items so reviewers can attach scanner outputs, SBOMs, and commit hashes — turning an unverifiable assertion into a structured, auditable record.

## Motivation

Anyone can write a `review_history` entry with `status: "security_checked"` and a free-text `notes` field. There is currently no way for a consuming agent, operator, or downstream validator to confirm that any tooling was actually run, which version of the code was examined, or whether known vulnerabilities were disclosed.

This matters because:

- Agents using passports to make trust decisions need evidence that the claim is grounded in real tooling, not just attestation.
- Operators subject to supply-chain security requirements (e.g. SLSA, SOC 2) need a SBOM reference and scanner results they can verify independently.
- Registry maintainers need a consistent field to display security posture rather than parsing free-text notes.

## Proposed Change

A new optional `security_evidence` object is added to `review_history.items.properties` in `passport-schema/passport.schema.json`. The field is optional in the JSON Schema; validation enforcement (making it required for certain trust levels) is left to the `validate-evidence` CLI mode.

### Schema structure

```json
"security_evidence": {
  "type": "object",
  "properties": {
    "scanner_outputs": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["tool", "version", "findings_count"],
        "properties": {
          "tool":           { "type": "string" },
          "version":        { "type": "string" },
          "ruleset":        { "type": "string" },
          "target":         { "type": "string" },
          "findings_count": { "type": "integer", "minimum": 0 },
          "critical":       { "type": "integer", "minimum": 0 },
          "high":           { "type": "integer", "minimum": 0 },
          "report_url":     { "type": "string", "format": "uri" },
          "report_hash":    { "type": "string" }
        },
        "additionalProperties": false
      }
    },
    "dependency_snapshot": {
      "type": "object",
      "required": ["sbom_url", "sbom_format"],
      "properties": {
        "sbom_url":    { "type": "string", "format": "uri" },
        "sbom_format": { "type": "string", "enum": ["cyclonedx", "spdx"] },
        "sbom_hash":   { "type": "string" }
      },
      "additionalProperties": false
    },
    "commit_hash":   { "type": "string" },
    "review_scope":  { "type": "string" },
    "known_issues": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "severity", "description", "mitigation"],
        "properties": {
          "id":          { "type": "string" },
          "severity":    { "type": "string", "enum": ["low", "medium", "high", "critical"] },
          "description": { "type": "string" },
          "mitigation":  { "type": "string" }
        },
        "additionalProperties": false
      }
    },
    "monitoring_config": {
      "type": "object",
      "properties": {
        "provider":    { "type": "string" },
        "config_url":  { "type": "string", "format": "uri" },
        "webhook_url": { "type": "string", "format": "uri" }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

### Example review_history entry

```json
{
  "status": "security_checked",
  "timestamp": "2026-05-18T10:00:00Z",
  "reviewer": "costder",
  "notes": "Full SAST + dependency audit on v1.4.2.",
  "security_evidence": {
    "commit_hash": "a3f8c1d2e9b047f6c5d8e3a1b2c4d5e6f7a8b9c0",
    "review_scope": "All source files under src/, excluding test fixtures.",
    "scanner_outputs": [
      {
        "tool": "semgrep",
        "version": "1.68.0",
        "ruleset": "p/security-audit",
        "findings_count": 2,
        "critical": 0,
        "high": 0,
        "report_url": "https://ci.example.com/reports/semgrep-v1.4.2.json",
        "report_hash": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      },
      {
        "tool": "trivy",
        "version": "0.51.0",
        "target": "example/tool:1.4.2",
        "findings_count": 0,
        "critical": 0,
        "high": 0
      }
    ],
    "dependency_snapshot": {
      "sbom_url": "https://releases.example.com/sbom/tool-1.4.2.cyclonedx.json",
      "sbom_format": "cyclonedx",
      "sbom_hash": "sha256:abc123def456..."
    },
    "known_issues": [
      {
        "id": "CVE-2025-12345",
        "severity": "low",
        "description": "Prototype pollution in a dev-only dependency; not reachable in production.",
        "mitigation": "Dependency pinned to patched version in next release."
      }
    ]
  }
}
```

### Required evidence per trust level

| Trust level              | Required evidence                                                         |
|--------------------------|---------------------------------------------------------------------------|
| `reviewer_signed`        | Attestation signature (existing `attestation` field)                     |
| `security_checked`       | At least one `scanner_outputs` entry + `dependency_snapshot` SBOM        |
| `continuously_monitored` | `scanner_outputs` + `dependency_snapshot` + `monitoring_config`          |

### Supported SBOM formats

The `dependency_snapshot.sbom_format` field accepts `"cyclonedx"` (CycloneDX 1.x) and `"spdx"` (SPDX 2.x / 3.x). Both are widely supported by tooling including Syft, Trivy, and cdxgen.

### Example scanners

The schema accepts any scanner name in `scanner_outputs[].tool`. Common examples include Semgrep (SAST), Trivy (container/filesystem), Snyk (dependencies), and Grype (SBOMs). Requiring specific scanners is out of scope for this RFC (see Alternatives Considered).

## Alternatives Considered

**Require on-chain / registry-stored report hashes.** Storing the full report hash in the registry index would allow validators to detect tampered reports. This was deferred because it requires registry infrastructure changes and increases passport size. The `report_hash` field is included so this can be layered on later without a schema break.

**Require specific scanners.** Mandating a fixed set of scanners (e.g. Semgrep + Trivy) would make evidence more comparable across passports but would exclude organisations using other tools. The open `tool` string field was chosen to allow the ecosystem to converge naturally. A recommended scanner list may be published as a separate advisory.

## Backwards Compatibility

`security_evidence` is an optional field. All existing passports that omit it continue to validate against the updated schema without any changes. The enforcement of `security_evidence` being present (and correct) for higher trust levels is implemented as an opt-in `validate-evidence` mode in the CLI — it does not affect normal schema validation. Existing passports remain fully valid.

## Open Questions

1. **Should `report_hash` be verified at validation time?** The CLI could fetch `report_url` and verify the hash, but this requires network access and raises questions about URL stability. Currently the hash is stored for auditability only.

2. **Minimum scanner count.** Should `security_checked` require at least two distinct scanner types (e.g. SAST + SCA)? A single entry is allowed today to keep the bar low for initial adoption.

3. **SBOM version pinning.** Should `sbom_format` distinguish CycloneDX 1.4 vs 1.5, or SPDX 2.3 vs 3.0? Currently the enum is coarse-grained.

4. **Monitoring frequency.** For `continuously_monitored`, should there be a required `last_scan_at` timestamp inside `monitoring_config` to prove the monitoring is actually running?
