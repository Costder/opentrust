# AgentMail Integration — Design

Status: **Draft — awaiting sign-off**
Author: Claude Opus 4.8
Date: 2026-06-01

Incorporate **AgentMail** (agentmail.to) as a hosted-inbox email transport for the
`hands-body-and-feet` MCP server, so agents get real send **and** receive without
running a self-hosted SMTP server.

---

## Why

The current email capability abstracts a transport (`local | postmark | resend`),
but:
- **postmark / resend only send.** They cannot receive.
- **receiving today = `LocalTransport`**, a self-hosted `smtp-server` the agent must
  run persistently with a public IP, open SMTP port, and MX/DNS config. Fragile,
  and unworkable on serverless / ephemeral hosts.

AgentMail gives each agent a **hosted inbox** (send + receive + webhooks + real
deliverability via DKIM/SPF/DMARC) behind a single API key — exactly the "don't
reinvent the wheel" path. It slots in as a 4th transport that finally makes
*receiving* real.

---

## Decision

1. Add `agentmail` as a 4th email transport (full send + receive). `local`,
   `postmark`, `resend` stay unchanged — opt-in, backward compatible.
2. **Polling now**: `read_inbox` / `wait_for_email` read from AgentMail via
   `messages.list`, upserting into the existing `emails` table.
3. **Webhook ingest too**: an endpoint that accepts AgentMail `message.received`
   events, verifies them, upserts to the `emails` table, and fires triggers — so
   event-driven agents get real-time mail.

---

## AgentMail SDK surface (verified from docs)

```ts
import { AgentMailClient } from "agentmail";
const client = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY! });

const inbox = await client.inboxes.create({ clientId: "agent-x" }); // -> inbox.inboxId, address
await client.inboxes.messages.send(inbox.inboxId, { to, subject, text, html });
const res = await client.inboxes.messages.list(inbox.inboxId, { limit });
// res.messages[].subject, .extractedText ?? .text, .from, .messageId
```

Webhook events: `message.received`, `message.sent`, `message.delivered`,
`message.bounced`, … Payloads capped at 1 MB (text/html omitted when over).

npm package: `agentmail`.

---

## Implementation

### 1. `AgentMailTransport` — `capabilities/email/agentmail-transport.ts`

Implements the transport contract used by `email/index.ts`:

```ts
class AgentMailTransport {
  readonly name = 'agentmail';
  constructor() { /* require AGENTMAIL_API_KEY */ }

  async createInbox(clientId: string): Promise<{ address: string; inboxId: string }>;
  async sendEmail(opts: SendEmailOpts): Promise<{ messageId: string }>;
  async listMessages(inboxId: string, limit: number): Promise<RawMessage[]>;
}
```

- `sendEmail` → `client.inboxes.messages.send(inboxId, {...})`. The `from` maps to
  the agent's AgentMail inbox; we resolve `inboxId` from the mailbox record.
- Lazy `import('agentmail')` like postmark/resend do, so the dep is optional.

### 2. Mailbox record carries the inbox id

`create_mailbox` for the agentmail transport calls `client.inboxes.create()` and
stores the returned `inboxId` + real `address` in the `mailboxes` table (add an
`inbox_id` column, nullable — additive migration). Other transports leave it null.

### 3. Wire the existing tools

| Tool | agentmail behavior |
|---|---|
| `create_mailbox` (L2) | `inboxes.create()` → store address + inbox_id; return real address |
| `send_email` (L2) | `messages.send()` |
| `read_inbox` (L2) | `messages.list()` → upsert into `emails` → return rows |
| `wait_for_email` (L2) | poll `messages.list()` (same loop, AgentMail source) |
| `delete_mailbox` (L3) | delete local rows (+ optionally `inboxes.delete`) |

Upsert uses the **same `emails` schema** the LocalTransport uses
(mailbox_address, message_id, subject, from_address, body_text, body_html,
received_at) and fires `matchAndFire('email', …)` so triggers work identically.

### 4. Webhook ingest — reuse existing webhook capability

The server already has a `webhookReceiver`. Add an AgentMail handler:
- Endpoint receives AgentMail `message.received` POSTs
- Verify the request (shared secret / signature header per AgentMail webhook config)
- Upsert the message into `emails` for the target mailbox + fire triggers
- Dedup by `message_id` (INSERT OR IGNORE, already the pattern)

### 5. Config + types

```ts
email?: {
  transport: 'local' | 'postmark' | 'resend' | 'agentmail';
  localPort?: number;
}
```
Env: `AGENTMAIL_API_KEY`. `init` flow gains an `agentmail` choice. `.env.example`
documents the key.

---

## Tests (TDD, mirror existing email tests)

- `agentmail-transport.test.ts`: send maps to `messages.send`; list maps to
  `messages.list`; createInbox returns address+inboxId — all with the SDK mocked.
- `email/index` with `transport: 'agentmail'`: create→send→read happy path;
  `wait_for_email` resolves when a matching message appears; trust gates unchanged.
- Webhook ingest: a `message.received` payload upserts to `emails` and fires a
  trigger; bad signature rejected; duplicate message_id ignored.
- Existing local/postmark/resend tests stay green.

---

## Out of Scope

- Migrating existing local-SMTP agents (local stays; this is additive)
- Attachments beyond pass-through (AgentMail supports them; full handling later)
- Custom-domain provisioning UI (use AgentMail's domain config directly)
- IMAP/SMTP access mode (we use the REST SDK)

---

## Sign-Off Criteria

- [ ] `transport: 'agentmail'` sends real email via AgentMail
- [ ] `create_mailbox` provisions a real hosted inbox (address + inbox_id stored)
- [ ] `read_inbox` / `wait_for_email` return real received mail via polling
- [ ] Webhook ingest upserts `message.received` events + fires triggers, verified + deduped
- [ ] Trust levels unchanged (create/send/read L2, delete L3)
- [ ] local / postmark / resend untouched; full haf test suite green
- [ ] `AGENTMAIL_API_KEY` documented in .env.example
