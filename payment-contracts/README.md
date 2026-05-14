# Payment Contracts

This package defines the abstract payment interface for OpenTrust registries.

Registry operators who want to enable paid tool access implement the `PaymentGateway`, `EscrowProvider`, and `SubscriptionManager` interfaces against the OpenTrust schema. The reference registry ships a mock checkout provider for demos and keeps production secrets out of source control.

The schema driving these interfaces is in `passport-schema/commercial-status.schema.json` and `passport-schema/escrow.schema.json`.
