import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { openDb } from '../../spend-tracker.js';

export interface SendEmailOpts {
  from: string;
  to: string | string[];
  subject: string;
  body: string;
  html?: string;
}

export class LocalTransport {
  readonly name = 'local' as const;
  private smtpServer?: SMTPServer;

  constructor(private port: number = 2525) {}

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.smtpServer = new SMTPServer({
        allowInsecureAuth: true,
        authOptional: true,
        onData: (stream, _session, callback) => {
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            simpleParser(Buffer.concat(chunks)).then((parsed) => {
              try {
                const db = openDb();
                const toField = parsed.to;
                let toAddresses: string[] = [];
                if (Array.isArray(toField)) {
                  toAddresses = toField.flatMap(
                    (a) => (a as { value: Array<{ address?: string }> }).value.map((v) => v.address ?? ''),
                  );
                } else if (toField) {
                  toAddresses = (toField as { value: Array<{ address?: string }> }).value.map(
                    (v) => v.address ?? '',
                  );
                }

                for (const addr of toAddresses) {
                  if (!addr) continue;
                  const mailbox = db
                    .prepare('SELECT address FROM mailboxes WHERE address = ?')
                    .get(addr);
                  if (mailbox) {
                    db.prepare(`
                      INSERT OR IGNORE INTO emails (mailbox_address, message_id, subject, from_address, body_text, body_html, received_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?)
                    `).run(
                      addr,
                      parsed.messageId ?? `msg-${Date.now()}`,
                      parsed.subject ?? '(no subject)',
                      typeof parsed.from === 'object' && parsed.from
                        ? (parsed.from as { text: string }).text
                        : '',
                      parsed.text ?? '',
                      parsed.html || null,
                      new Date().toISOString(),
                    );
                  }
                }
                callback();
              } catch (err) {
                callback(err as Error);
              }
            }).catch((err: Error) => callback(err));
          });
        },
      });

      this.smtpServer.listen(this.port, (err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.smtpServer) {
        this.smtpServer.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  async sendEmail(opts: SendEmailOpts): Promise<{ messageId: string }> {
    const transporter = nodemailer.createTransport({
      host: '127.0.0.1',
      port: this.port,
      secure: false,
      tls: { rejectUnauthorized: false },
    });
    const info = await transporter.sendMail({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      text: opts.body,
      html: opts.html,
    });
    return { messageId: info.messageId as string };
  }
}
