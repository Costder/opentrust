# Payment Webhook Handler

Public contract for payment events emitted by private payment providers.

Supported event types:

- `payment.completed`
- `payment.failed`
- `subscription.renewed`
- `escrow.disputed`

The actual Circle or payment-provider webhook subscription and signature verification live in `opentrust-private`.
