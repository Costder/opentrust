# RFC 0006: Reviewer Identity (PKI Backing for Attestation Signatures)

- **Status:** accepted
- **Author:** Costder
- **Created:** 2026-05-18
- **PR:** (link to the PR)

## Summary

This RFC adds a `reviewer_identity` field to each entry in a passport's `review_history` array. The field declares a verifiable identity for the reviewer — either a GitHub identity (pointing to `https://github.com/username.keys`) or a W3C DID — so that any client can fetch the reviewer's Ed25519 public key and verify the `attestation` signature without out-of-band coordination.

## Motivation

The existing `ReviewerAttestation` schema includes a `key_id` string that the reviewer uses to identify which signing key they used. In practice, `key_id` is unverifiable theater: there is no standardised way for a client to look up the corresponding public key. A client that wants to verify a reviewer's signature must either trust the registry to vouch for the key, or receive the public key through some out-of-band channel (email, a wiki page, a Slack message). Neither option is acceptable for a protocol whose stated goal is offline-verifiable trust.

Consider a concrete failure mode: a passport for a high-privilege tool (`payments`, `wallet_access`) bears a `reviewer_signed` status and a base64 signature. An agent runtime that tries to verify this signature has no way to do so — it must either skip verification and trust the claim blindly, or fail closed and reject the passport. Neither outcome is correct. The reviewer's key is simply not discoverable.

`reviewer_identity` fixes this by making the public key URL (or the DID document that contains it) a first-class field in the review record.

## Proposed Change

### Schema changes

A new `ReviewerIdentity` definition is added to `passport-schema/security.schema.json` under `definitions`. It uses `oneOf` to support two identity types:

**GitHub identity** — appropriate for individual reviewers or small teams that already use GitHub for code signing:

```json
{
  "type": "github",
  "github_username": "costder",
  "key_id": "SHA256:abc123",
  "public_key_url": "https://github.com/costder.keys"
}
```

The client fetches `public_key_url`, parses the SSH public key lines, finds the key whose fingerprint matches `key_id`, converts it to a raw Ed25519 public key, and verifies the signature.

**DID identity** — appropriate for organisations using W3C Decentralised Identifiers, including the ARIA Protocol (`did:aria`):

```json
{
  "type": "did",
  "did": "did:web:security.example.com",
  "verification_method": "did:web:security.example.com#key-1",
  "public_key_jwk": {
    "kty": "OKP",
    "crv": "Ed25519",
    "x": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"
  }
}
```

`public_key_jwk` is optional. When absent, the client resolves the DID document and extracts the key from `verification_method`. When present, it serves as an inline cache that avoids the DID resolution round-trip.

The ARIA Protocol (`did:aria`) is explicitly supported as a DID method. ARIA DIDs follow the pattern `did:aria:{identifier}` and their DID documents are resolved via the ARIA registry.

### Attestation payload format

The `attestation.payload` field (already defined in `ReviewerAttestation`) uses the format:

```
{slug}:{version}:{trust_status}:{timestamp}
```

Example:

```
github-file-search:1.2.0:reviewer_signed:2026-05-14T10:00:00Z
```

The `reviewer_identity` field enables the client to verify this payload without any additional state.

### CLI verify-signature command

When `reviewer_identity` is present, `opentrust verify-signature <passport-file>` performs the following steps and prints:

```
Verifying reviewer attestation for github-file-search v1.2.0...
  Identity type : github
  Reviewer      : costder
  Key ID        : SHA256:abc123
  Fetching keys : https://github.com/costder.keys ... OK (3 keys found)
  Key match     : SHA256:abc123 ... FOUND
  Payload       : github-file-search:1.2.0:reviewer_signed:2026-05-14T10:00:00Z
  Signature     : OK
Result: VALID
```

On failure the command exits non-zero and prints a `FAIL` result with a human-readable reason.

### Full example (review_history entry)

```json
{
  "status": "reviewer_signed",
  "timestamp": "2026-05-14T10:00:00Z",
  "reviewer": "costder",
  "reviewer_identity": {
    "type": "github",
    "github_username": "costder",
    "key_id": "SHA256:abc123",
    "public_key_url": "https://github.com/costder.keys"
  },
  "attestation": {
    "key_id": "SHA256:abc123",
    "algorithm": "ed25519",
    "signature": "base64url-encoded-signature-here",
    "payload": "github-file-search:1.2.0:reviewer_signed:2026-05-14T10:00:00Z"
  }
}
```

## Alternatives Considered

**Registry-only key lookup**: Require all reviewer public keys to be registered with the OpenTrust registry and resolved via a registry API call. This was rejected because it introduces a centralised dependency — a client cannot verify a passport if the registry is unavailable. OpenTrust's design goal is offline verifiability, and a required registry call contradicts that goal.

**PGP keyservers**: Use PGP Web of Trust and resolve keys via `keys.openpgp.org` or similar keyservers. PGP keyserver infrastructure is declining: Sks-keyserver pools have largely shut down, key discovery is unreliable, and the tooling is complex. Ed25519 keys via GitHub or DID are simpler, more reliable, and already used in the SSH-signing workflows common in open source projects.

## Backwards Compatibility

`reviewer_identity` is an optional field. Existing passports that lack it continue to validate correctly against the updated schema. The field is added to the `review_history` items `properties` object while the existing `"additionalProperties": false` constraint is preserved, so passports that do include `reviewer_identity` must use the declared structure.

No migration is required. Tools and agents that do not understand `reviewer_identity` can ignore it; they lose the ability to verify signatures offline, but this is no worse than the current situation.

## Open Questions

1. **Key fingerprint format for GitHub identities**: The current proposal uses the SSH key fingerprint (`SHA256:...`) as `key_id` to match what `ssh-keygen -l` prints. Should the protocol also accept the OpenSSH comment string or a numeric GitHub key ID (available from `https://api.github.com/users/{username}/keys`)? Numeric IDs are stable but require an API call; fingerprints can be computed locally from the raw key.

2. **Inline JWK caching and staleness**: When `public_key_jwk` is present in a DID identity, clients may use it without resolving the DID document. If the reviewer later rotates their key, passports with a stale inline JWK will fail verification until the passport is re-issued. Should there be a recommended maximum age for inline JWKs, or a `jwk_fetched_at` timestamp field to signal when the inline copy was made?
