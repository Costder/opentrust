import { LocalTransport } from './local-transport.js';
import { PostmarkTransport, ResendTransport } from './api-transport.js';
import { AgentMailTransport } from './agentmail-transport.js';
import { openDb } from '../../spend-tracker.js';
import { enforceTrust } from '../../trust.js';
import { readConfig } from '../../config.js';
import { SecretsError } from '../../secrets.js';
import { matchAndFire } from '../triggers/index.js';
import type { PassportClaims } from '../../types.js';

// Singleton for the running local transport
let _localTransport: LocalTransport | null = null;

export function getLocalTransport(): LocalTransport | null {
  return _localTransport;
}

export async function startLocalTransportIfConfigured(): Promise<void> {
  const cfg = readConfig();
  if (cfg.capabilities.email?.transport === 'local') {
    const port = cfg.capabilities.email.localPort ?? 2525;
    _localTransport = new LocalTransport(port);
    await _localTransport.start();
    console.log(`Local SMTP server listening on port ${port}`);
  }
}

// Send-only transport surface. AgentMail is handled separately (it needs an
// inboxId), so it is intentionally not part of this union.
type SendTransport = LocalTransport | PostmarkTransport | ResendTransport;

function getTransport(): SendTransport {
  const cfg = readConfig();
  const transport = cfg.capabilities.email?.transport;
  if (!transport) {
    throw new SecretsError('Email capability not configured. Run "hands-body-and-feet init" first.');
  }
  switch (transport) {
    case 'local':
      if (!_localTransport) {
        const port = cfg.capabilities.email?.localPort ?? 2525;
        _localTransport = new LocalTransport(port);
      }
      return _localTransport;
    case 'postmark':
      return new PostmarkTransport();
    case 'resend':
      return new ResendTransport();
    case 'agentmail':
      // AgentMail send goes through the inboxId-aware path in sendEmail().
      throw new SecretsError('AgentMail transport is handled via the inbox-aware path');
    default:
      throw new SecretsError(`Unknown email transport: ${transport as string}`);
  }
}

function isAgentMail(): boolean {
  return readConfig().capabilities.email?.transport === 'agentmail';
}

/** Resolve a mailbox's AgentMail inbox_id from its address. */
function inboxIdFor(address: string): string | null {
  const db = openDb();
  const row = db.prepare('SELECT inbox_id FROM mailboxes WHERE address = ?').get(address) as
    | { inbox_id: string | null }
    | undefined;
  return row?.inbox_id ?? null;
}

/** Pull new mail from AgentMail into the local emails table; fire triggers. */
async function syncAgentMailInbox(address: string, limit: number): Promise<void> {
  const inboxId = inboxIdFor(address);
  if (!inboxId) return;
  const transport = new AgentMailTransport();
  const messages = await transport.listMessages(inboxId, limit);
  const db = openDb();
  const now = new Date().toISOString();
  for (const m of messages) {
    // Dedup by (mailbox_address, message_id) — no unique index on the table.
    const existing = db
      .prepare('SELECT 1 FROM emails WHERE mailbox_address = ? AND message_id = ?')
      .get(address, m.message_id);
    if (existing) continue;
    db.prepare(
      `INSERT INTO emails
       (mailbox_address, message_id, subject, from_address, body_text, body_html, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(address, m.message_id, m.subject, m.from_address, m.body_text, m.body_html, now);
    matchAndFire('email', {
      mailbox_address: address,
      from: m.from_address,
      subject: m.subject,
      body: m.body_text,
    }).catch((e: unknown) =>
      console.error('[triggers] agentmail matchAndFire error:', e instanceof Error ? e.message : String(e)),
    );
  }
}

export const EMAIL_TOOLS = {
  create_mailbox: { name: 'create_mailbox', minTrustLevel: 2 as const },
  send_email: { name: 'send_email', minTrustLevel: 2 as const },
  read_inbox: { name: 'read_inbox', minTrustLevel: 2 as const },
  wait_for_email: { name: 'wait_for_email', minTrustLevel: 2 as const },
  delete_mailbox: { name: 'delete_mailbox', minTrustLevel: 3 as const },
} as const;

export async function createMailbox(
  params: { address: string },
  claims: PassportClaims,
): Promise<{ address: string }> {
  enforceTrust(claims, EMAIL_TOOLS.create_mailbox);
  const db = openDb();
  if (isAgentMail()) {
    // Provision a real hosted inbox; the requested address is the clientId.
    const transport = new AgentMailTransport();
    const { address, inboxId } = await transport.createInbox(params.address);
    db.prepare('INSERT OR IGNORE INTO mailboxes (address, inbox_id, created_at) VALUES (?, ?, ?)')
      .run(address, inboxId, new Date().toISOString());
    return { address };
  }
  db.prepare('INSERT OR IGNORE INTO mailboxes (address, created_at) VALUES (?, ?)')
    .run(params.address, new Date().toISOString());
  return { address: params.address };
}

export interface EmailFilter {
  subject_contains?: string;
  from_contains?: string;
  body_contains?: string;
}

export async function sendEmail(
  params: { from: string; to: string; subject: string; body: string; html?: string },
  claims: PassportClaims,
): Promise<{ messageId: string }> {
  enforceTrust(claims, EMAIL_TOOLS.send_email);
  if (isAgentMail()) {
    const inboxId = inboxIdFor(params.from);
    if (!inboxId) {
      throw new SecretsError(`No AgentMail inbox for "${params.from}". Create the mailbox first.`);
    }
    return new AgentMailTransport().sendEmail({
      inboxId,
      from: params.from,
      to: params.to,
      subject: params.subject,
      body: params.body,
      html: params.html,
    });
  }
  const transport = getTransport();
  return transport.sendEmail(params);
}

export async function readInbox(
  params: { address: string; limit?: number },
  claims: PassportClaims,
): Promise<{ messages: unknown[] }> {
  enforceTrust(claims, EMAIL_TOOLS.read_inbox);
  const db = openDb();
  const limit = params.limit ?? 20;
  if (isAgentMail()) {
    // Pull fresh mail from AgentMail before reading the local cache.
    await syncAgentMailInbox(params.address, limit);
  }
  const messages = db
    .prepare(
      'SELECT * FROM emails WHERE mailbox_address = ? ORDER BY received_at DESC LIMIT ?',
    )
    .all(params.address, limit);
  return { messages };
}

export async function waitForEmail(
  params: { address: string; filter?: EmailFilter; timeout_ms: number },
  claims: PassportClaims,
): Promise<{ message: unknown }> {
  enforceTrust(claims, EMAIL_TOOLS.wait_for_email);
  const db = openDb();
  const deadline = Date.now() + params.timeout_ms;
  const filter = params.filter ?? {};
  const agentmail = isAgentMail();

  while (Date.now() < deadline) {
    if (agentmail) {
      await syncAgentMailInbox(params.address, 50);
    }
    const rows = db
      .prepare(
        'SELECT * FROM emails WHERE mailbox_address = ? ORDER BY received_at DESC LIMIT 50',
      )
      .all(params.address) as Array<{
        subject: string;
        from_address: string;
        body_text: string;
      }>;

    for (const row of rows) {
      const matchSubject =
        !filter.subject_contains ||
        row.subject.toLowerCase().includes(filter.subject_contains.toLowerCase());
      const matchFrom =
        !filter.from_contains ||
        row.from_address.toLowerCase().includes(filter.from_contains.toLowerCase());
      const matchBody =
        !filter.body_contains ||
        row.body_text.toLowerCase().includes(filter.body_contains.toLowerCase());

      if (matchSubject && matchFrom && matchBody) {
        return { message: row };
      }
    }

    // Wait 500ms before polling again
    await new Promise<void>((r) => setTimeout(r, 500));
  }

  throw new Error(`wait_for_email timed out after ${params.timeout_ms}ms`);
}

/**
 * Ingest an AgentMail webhook event (real-time receive path).
 *
 * Accepts a `message.received` payload, resolves the target mailbox by inbox_id,
 * upserts the message into the local `emails` table (deduped by message_id), and
 * fires email triggers for newly-inserted mail. Non-`message.received` events and
 * events for unknown inboxes are ignored. This complements polling: an event-driven
 * agent gets mail pushed in, then reads it via read_inbox / wait_for_email.
 */
export interface AgentMailWebhookEvent {
  type: string;
  message: {
    inboxId: string;
    messageId: string;
    subject?: string;
    from?: string;
    extractedText?: string;
    text?: string;
    html?: string | null;
  };
}

export function ingestAgentMailWebhook(event: AgentMailWebhookEvent): { ingested: boolean } {
  if (event.type !== 'message.received') return { ingested: false };
  const m = event.message;
  const db = openDb();
  const mailbox = db
    .prepare('SELECT address FROM mailboxes WHERE inbox_id = ?')
    .get(m.inboxId) as { address: string } | undefined;
  if (!mailbox) return { ingested: false };

  const subject = m.subject ?? '(no subject)';
  const from = m.from ?? '';
  const body = m.extractedText ?? m.text ?? '';

  // Dedup by (mailbox_address, message_id). The emails table has no unique index
  // on message_id, so INSERT OR IGNORE alone won't dedup — check explicitly.
  const existing = db
    .prepare('SELECT 1 FROM emails WHERE mailbox_address = ? AND message_id = ?')
    .get(mailbox.address, m.messageId);
  if (existing) return { ingested: false };

  db.prepare(
    `INSERT INTO emails
     (mailbox_address, message_id, subject, from_address, body_text, body_html, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(mailbox.address, m.messageId, subject, from, body, m.html ?? null, new Date().toISOString());

  matchAndFire('email', { mailbox_address: mailbox.address, from, subject, body }).catch(
    (e: unknown) =>
      console.error('[triggers] agentmail webhook matchAndFire error:', e instanceof Error ? e.message : String(e)),
  );
  return { ingested: true };
}

export async function deleteMailbox(
  params: { address: string },
  claims: PassportClaims,
): Promise<{ deleted: boolean }> {
  enforceTrust(claims, EMAIL_TOOLS.delete_mailbox);
  const db = openDb();
  db.prepare('DELETE FROM mailboxes WHERE address = ?').run(params.address);
  return { deleted: true };
}
