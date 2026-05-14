# Architecture

OpenTrust is a neutral open standard. This repo is the complete reference implementation — there is no private companion repo.

The public repo contains everything:

- **Schemas** — `passport-schema/` is the canonical spec (JSON Schema)
- **Registry API** — `api/` FastAPI app: passport CRUD, search, GitHub OAuth, badges, claim flow
- **CLI** — `cli/` opentrust CLI: inspect, validate, search, claim, badge
- **Web** — `web/` Next.js frontend: directory, passport pages, claim flow
- **Generators** — `passport-generator/`, `badge-generator/`, `manifest-validator/`
- **Docs and RFCs** — `docs/`, `rfcs/`

## Payment endpoints

The registry API exposes payment endpoint stubs (`POST /payments/checkout`, `/payments/verify`, `/subscriptions/create`, `/escrow/create`) that return `501 Not Implemented`. These are placeholders defined by the OpenTrust payment contract schema.

**Registry operators** who deploy their own instance of this registry implement these endpoints against the schema in `passport-schema/commercial-status.schema.json` and `passport-schema/escrow.schema.json`. The reference registry does not process payments — it defines what a conforming payment integration must look like. Contributions implementing a real provider are welcome via RFC and PR.
