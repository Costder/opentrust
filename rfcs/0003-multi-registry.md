# RFC 0003: Multi-Registry Trust Model

- **Status:** accepted
- **Author:** Costder
- **Created:** 2026-05-14

## Summary

Defines how multiple OpenTrust registries coexist, how agents discover and trust them, and how passports from one registry are verified by agents that primarily use another.

## Motivation

OpenTrust is open source. The moment it ships, people will self-host it. Enterprises will run private registries. Ecosystem communities will run specialized registries (e.g., a security-tools-only registry run by a security firm). The canonical registry at `registry.opentrust.dev` cannot be the only trusted source — that would make this a centralized platform, not an open standard.

But "anyone can run a registry" creates a trust problem: if anyone can sign passports, the signature means nothing. The multi-registry model solves this with a delegated trust hierarchy.

## Proposed Change

### Three registry types

**Root registries** are fully trusted. Their signing keys are hardcoded in reference implementations. There is one root registry at launch (`registry.opentrust.dev`). Additional root registries require an RFC.

**Delegated registries** are trusted by reference from a root. The root registry signs the delegated registry's public key. Agents verify the delegation chain before trusting passport signatures from a delegated registry. Any organization can apply for delegated registry status via an RFC.

**Private registries** are trusted within an organization but not by external agents by default. Operators configure their agents to trust specific private registries via spend policy (`allowed_registries`). Private registries do not appear in the public registry list.

### Registry discovery

Root registries publish a registry list at:
```
GET https://registry.opentrust.dev/.well-known/opentrust-registries.json
```

This list includes all known delegated registries with their delegation signatures. Agents cache this list (1-hour TTL) and use it to verify passport signatures from non-root registries.

### Cross-registry passport resolution

A passport slug is globally unique within a registry but may exist on multiple registries. When an agent resolves a slug, it checks registries in the declared `resolution_order`. The first valid (non-revoked, signature-verified) passport wins.

If two registries disagree about a tool's trust_status, the higher-trust registry wins only if it has a valid delegation chain from a root. An untrusted registry claiming a tool is `security_checked` does not override a root registry that says it is `disputed`.

### Passport registry declaration

Each passport includes a `registry_url` field (added to `agent_access`) declaring which registry issued it. Agents use this for signature verification:

```json
"agent_access": {
  "api_url": "https://registry.opentrust.dev/api/v1/tools/my-tool",
  "registry_url": "https://registry.opentrust.dev"
}
```

## Alternatives Considered

**Single canonical registry (status quo):** Rejected. Makes OpenTrust a centralized platform, not a standard. Enterprises can't run private instances. Standard becomes fragile if `opentrust.dev` goes down.

**Flat trust (all registries equal):** Rejected. If any self-hosted registry can issue trusted signatures, the signature means nothing. A malicious registry could sign a backdoored tool as `security_checked`.

**DNS-based registry discovery:** Considered. Interesting but adds DNS dependency and complexity for v1. Can be layered on in a future RFC.

## Backwards Compatibility

Backwards compatible. Single-registry agents continue working unchanged. Multi-registry support is opt-in via spend policy `allowed_registries` and registry trust list lookup.

## Open Questions

- What is the process for revoking a delegated registry's trust (e.g., if it is compromised)?
- Should private registries be able to issue passports that root registries inherit into their public index?
- Is one root registry sufficient, or should there be multiple root registries from day one for resilience?
