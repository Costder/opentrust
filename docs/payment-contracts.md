# Payment Contracts

The OpenTrust payment contract is defined in the schema — not implemented in the reference registry.

Registry operators implement `PaymentGateway`, `VerificationPricing`, `EscrowProvider`, and `SubscriptionManager` against the schema in `passport-schema/commercial-status.schema.json` and `passport-schema/escrow.schema.json`. The reference API routes return `501 Not Implemented` as spec-conforming placeholders.

This separation is intentional: OpenTrust defines what a payment contract must declare (cost, network, wallet address, escrow conditions, refund policy) — not which payment provider processes it. Any provider that conforms to the schema is a valid implementation.
