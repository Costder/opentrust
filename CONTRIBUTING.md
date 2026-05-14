# Contributing to Open Trust Protocol

OpenTrust is an open standard. Contributions are welcome from anyone — tool authors, framework maintainers, security researchers, and developers building on top of AI agents.

## Two kinds of contributions

### 1. Schema and spec changes — use the RFC process

Any change to the passport schema, trust ladder, permission manifest, or governance model requires an RFC (Request for Comments). This keeps the standard stable and gives the community a voice before breaking changes ship.

**How to submit an RFC:**

1. Copy `rfcs/0000-template.md` to `rfcs/NNNN-your-title.md` where `NNNN` is the next available number.
2. Fill in the template — motivation, proposed change, backwards compatibility notes.
3. Open a pull request. The PR is the discussion thread.
4. RFCs stay open for a minimum of 14 days for community comment.
5. The maintainer merges accepted RFCs and closes rejected ones with a written reason.

Schema changes that do not break existing passports (additive, optional fields) have a lighter review bar than breaking changes.

### 2. Everything else — open a PR

Bug fixes, CLI improvements, new badge styles, documentation, test coverage, new ecosystem adapters in `format_manifests` — these do not need an RFC. Open an issue for discussion on large changes, then submit a PR.

## Standards for contributions

- Include tests for behavior changes.
- Keep PRs scoped to one logical change.
- Do not introduce dependencies without discussion.
- All code in this repository is MIT licensed. Contributions are made under the same license.

## Passport quality standards

- Auto-generated draft passports must never be presented as verified or trusted.
- Permission manifests must reflect what the tool actually accesses, not just what it needs.
- Review attestations require disclosure of any conflicts of interest.
- Trust status claims must be backed by evidence in `review_history`.

## Adding support for a new tool format

If you want to add a new ecosystem to `format_manifests` in the passport schema:

1. Open an RFC describing the format, the fields needed, and 2-3 real tool examples.
2. Add the format to `passport-schema/passport.schema.json` under `format_manifests`.
3. Add a worked example to `passport-schema/examples/`.
4. Update the passport generator extractors if applicable.

## Code of conduct

Be direct and technical. Critique ideas, not people. Conflicts of interest in trust reviews must be disclosed.

## Questions

Open a GitHub Discussion for questions about the spec or contribution process.
