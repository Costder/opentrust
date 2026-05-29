import { LocalTransport } from './local-transport.js';
import { PostmarkTransport, ResendTransport } from './api-transport.js';
import { openDb } from '../../spend-tracker.js';
import { enforceTrust } from '../../trust.js';
import { readConfig } from '../../config.js';
import { SecretsError } from '../../secrets.js';
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

function getTransport() {
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
    default:
      throw new SecretsError(`Unknown email transport: ${transport as string}`);
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

  while (Date.now() < deadline) {
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

export async function deleteMailbox(
  params: { address: string },
  claims: PassportClaims,
): Promise<{ deleted: boolean }> {
  enforceTrust(claims, EMAIL_TOOLS.delete_mailbox);
  const db = openDb();
  db.prepare('DELETE FROM mailboxes WHERE address = ?').run(params.address);
  return { deleted: true };
}
