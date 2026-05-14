# Payment Contracts

OpenTrust defines public payment contracts and ships an open-source mock provider for demos.

The reference API supports checkout creation and verification with `PAYMENT_PROVIDER=mock`. Production operators can implement `PaymentGateway`, `VerificationPricing`, `EscrowProvider`, and `SubscriptionManager` against the public schemas in their own deployments.

This separation is intentional: OpenTrust defines what a payment contract must declare (cost, network, wallet address, escrow conditions, refund policy) — not which payment provider processes it. Any provider that conforms to the schema is a valid implementation.
