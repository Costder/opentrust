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

The registry API exposes open-source demo payment endpoints (`POST /payments/checkout`, `/payments/verify`, `/subscriptions/create`) backed by the mock provider. Escrow remains outside the demo flow and is defined by the OpenTrust payment contract schema for operators that need it.

**Registry operators** who deploy their own instance of this registry can replace the mock provider against the schema in `passport-schema/commercial-status.schema.json` and `passport-schema/escrow.schema.json`. The reference registry defines what a conforming payment integration must look like. Contributions implementing production providers are welcome via RFC and PR.
