# Payment Contracts

This package defines the abstract payment interface for OpenTrust registries.

Registry operators who want to enable paid tool access implement the `PaymentGateway`, `EscrowProvider`, and `SubscriptionManager` interfaces against the OpenTrust schema. The reference registry ships these as stubs returning `501 Not Implemented` — real USDC/payment provider code lives in the registry operator's own implementation, outside this repo.

The schema driving these interfaces is in `passport-schema/commercial-status.schema.json` and `passport-schema/escrow.schema.json`.
