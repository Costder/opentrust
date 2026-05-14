# OpenTrust RFCs

The OpenTrust spec evolves through a public RFC (Request for Comments) process. This ensures the standard remains stable, changes are deliberate, and the community has input before anything ships.

## When you need an RFC

- Adding, removing, or renaming fields in the passport schema
- Changes to the trust ladder (levels, definitions, requirements)
- Changes to the permission manifest schema
- Adding a new `source_format` / `format_manifests` ecosystem
- Changes to the governance model itself
- Any change that would invalidate existing passports

You do **not** need an RFC for: bug fixes, documentation improvements, CLI behavior changes, new badge styles, test coverage, or purely additive optional fields that cannot break existing valid passports.

## Process

1. **Copy the template** — duplicate `0000-template.md` to `NNNN-your-short-title.md` using the next available RFC number.
2. **Fill it in** — motivation, proposed change, alternatives considered, backwards compatibility.
3. **Open a pull request** — the PR is the discussion thread. Title it `RFC NNNN: Your Title`.
4. **Comment period** — RFCs stay open for a minimum of 14 days. Breaking changes stay open for 28 days.
5. **Decision** — the maintainer merges accepted RFCs and closes rejected ones with a written reason.
6. **Implementation** — after merge, implementation PRs can reference the RFC number.

## RFC States

| State | Meaning |
|---|---|
| `proposed` | Open PR, under discussion |
| `accepted` | Merged, approved for implementation |
| `rejected` | Closed with written reason |
| `withdrawn` | Author withdrew the proposal |
| `superseded` | Replaced by a later RFC |

## Accepted RFCs

| RFC | Title | Status |
|---|---|---|
| [0001](0001-passport-schema-v1.md) | Passport Schema v1 | `accepted` |
| [0002](0002-agent-identity.md) | Agent Identity | `accepted` |
| [0003](0003-multi-registry.md) | Multi-Registry Trust Model | `accepted` |
| [0004](0004-spend-policy.md) | Agent Spend Policy | `accepted` |

## Template

See [0000-template.md](0000-template.md).
