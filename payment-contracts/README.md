# Payment Contracts

This package defines the public payment interface pattern for OpenTrust.

`opentrust-private` imports this package and implements real USDC/Circle checkout, verification, subscriptions, refunds, webhook handling, and escrow. The public repo intentionally contains no real payment provider code, no secrets, no wallet connection code, and no production payment flow.
