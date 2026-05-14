# API

API prefix: `/api/v1`.

Payment routes (`/payments/*`, `/subscriptions/*`, `/escrow/*`) return `501 Not Implemented` in the reference registry. Registry operators implement these endpoints against the payment contract schema. See `passport-schema/commercial-status.schema.json`.
