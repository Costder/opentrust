/**
 * AgentMail (agentmail.to) transport — hosted inboxes with real send AND receive.
 *
 * Unlike postmark/resend (send-only) and local SMTP (self-hosted), AgentMail
 * gives each agent a hosted inbox behind one API key the operator supplies via
 * AGENTMAIL_API_KEY. The SDK is lazy-imported so the dependency stays optional.
 */

export interface AgentMailSendOpts {
  inboxId: string;
  from: string;
  to: string | string[];
  subject: string;
  body: string;
  html?: string;
}

/** Local-shape message row (matches the `emails` table columns). */
export interface MappedMessage {
  message_id: string;
  subject: string;
  from_address: string;
  body_text: string;
  body_html: string | null;
}

interface RawAgentMailMessage {
  messageId?: string;
  message_id?: string;
  subject?: string;
  from?: string;
  from_address?: string;
  extractedText?: string;
  text?: string;
  html?: string | null;
}

export class AgentMailTransport {
  readonly name = 'agentmail' as const;

  constructor() {
    if (!process.env.AGENTMAIL_API_KEY) {
      throw new Error('AGENTMAIL_API_KEY env var not set');
    }
  }

  private async client() {
    const { AgentMailClient } = await import('agentmail');
    return new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY! });
  }

  /** Provision a real hosted inbox. clientId enables idempotent retries. */
  async createInbox(clientId: string): Promise<{ address: string; inboxId: string }> {
    const client = await this.client();
    const inbox = await client.inboxes.create({ clientId });
    // The SDK's Inbox carries the address on `.email`.
    return { address: inbox.email, inboxId: inbox.inboxId };
  }

  async sendEmail(opts: AgentMailSendOpts): Promise<{ messageId: string }> {
    const client = await this.client();
    const result = await client.inboxes.messages.send(opts.inboxId, {
      to: opts.to,
      subject: opts.subject,
      text: opts.body,
      html: opts.html,
    });
    return { messageId: result.messageId ?? 'unknown' };
  }

  /** List received messages, mapped to the local `emails` row shape. */
  async listMessages(inboxId: string, limit: number): Promise<MappedMessage[]> {
    const client = await this.client();
    const res = await client.inboxes.messages.list(inboxId, { limit });
    const messages: RawAgentMailMessage[] = res.messages ?? [];
    return messages.map((m) => ({
      message_id: m.messageId ?? m.message_id ?? `am-${Date.now()}`,
      subject: m.subject ?? '(no subject)',
      from_address: m.from ?? m.from_address ?? '',
      body_text: m.extractedText ?? m.text ?? '',
      body_html: m.html ?? null,
    }));
  }
}
