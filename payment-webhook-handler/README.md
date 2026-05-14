# Payment Webhook Handler

Contract for payment events emitted by registry payment providers.

Supported event types:

- `payment.completed`
- `payment.failed`
- `subscription.renewed`
- `escrow.disputed`

Registry operators who implement payment processing emit these events and register a webhook endpoint. The mock provider is available for demos; this handler defines the event contract that a conforming production implementation must emit.
