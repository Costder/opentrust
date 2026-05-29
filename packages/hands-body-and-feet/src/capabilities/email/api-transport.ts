import type { SendEmailOpts } from './local-transport.js';

export class PostmarkTransport {
  readonly name = 'postmark' as const;

  constructor() {
    if (!process.env.POSTMARK_SERVER_TOKEN) {
      throw new Error('POSTMARK_SERVER_TOKEN env var not set');
    }
  }

  async sendEmail(opts: SendEmailOpts): Promise<{ messageId: string }> {
    const { ServerClient } = await import('postmark');
    const client = new ServerClient(process.env.POSTMARK_SERVER_TOKEN!);
    const result = await client.sendEmail({
      From: opts.from,
      To: Array.isArray(opts.to) ? opts.to.join(',') : opts.to,
      Subject: opts.subject,
      TextBody: opts.body,
      HtmlBody: opts.html,
    });
    return { messageId: result.MessageID };
  }
}

export class ResendTransport {
  readonly name = 'resend' as const;

  constructor() {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY env var not set');
    }
  }

  async sendEmail(opts: SendEmailOpts): Promise<{ messageId: string }> {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY!);
    const result = await resend.emails.send({
      from: opts.from,
      to: Array.isArray(opts.to) ? opts.to : [opts.to],
      subject: opts.subject,
      text: opts.body,
      html: opts.html,
    });
    return { messageId: result.data?.id ?? 'unknown' };
  }
}
