import { vi, describe, it, expect, beforeEach, afterAll } from 'vitest';
import { TrustError } from '../trust.js';
import { SecretsError } from '../secrets.js';
import type { PassportClaims } from '../types.js';

// ---------------------------------------------------------------------------
// Hoisted mock functions
// ---------------------------------------------------------------------------

const { mockReadConfig, mockNodemailerSendMail } = vi.hoisted(() => ({
  mockReadConfig: vi.fn(),
  mockNodemailerSendMail: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../config.js', () => ({
  readConfig: mockReadConfig,
  CONFIG_DIR: '/tmp/test-haf-email',
  ensureConfigDir: vi.fn(),
}));

// Mock smtp-server — stub start/stop only, no real socket
vi.mock('smtp-server', () => {
  const SMTPServer = vi.fn(() => ({
    listen: vi.fn((_port: number, cb: (err?: Error) => void) => cb()),
    close: vi.fn((cb: () => void) => cb()),
  }));
  return { SMTPServer };
});

// Mock mailparser
vi.mock('mailparser', () => ({
  simpleParser: vi.fn(),
}));

// Mock nodemailer
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockNodemailerSendMail,
    })),
  },
}));

// Mock postmark
vi.mock('postmark', () => ({
  ServerClient: vi.fn(() => ({
    sendEmail: vi.fn().mockResolvedValue({ MessageID: 'postmark-msg-id-001' }),
  })),
}));

// Mock resend
vi.mock('resend', () => ({
  Resend: vi.fn(() => ({
    emails: {
      send: vi.fn().mockResolvedValue({ data: { id: 'resend-msg-id-001' }, error: null }),
    },
  })),
}));

// SQLite mock — in-memory DB singleton
vi.mock('better-sqlite3', () => {
  let db: import('better-sqlite3').Database | null = null;
  const Ctor = vi.fn((_path: string) => {
    if (!db) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
      const RealDB = (require('better-sqlite3') as any) as new (path: string) => import('better-sqlite3').Database;
      db = new RealDB(':memory:');
    }
    return db;
  });
  (Ctor as unknown as { resetDb: () => void }).resetDb = () => { db = null; };
  return { default: Ctor };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import Database from 'better-sqlite3';
import {
  createMailbox,
  sendEmail,
  readInbox,
  waitForEmail,
  deleteMailbox,
} from '../capabilities/email/index.js';
import { PostmarkTransport, ResendTransport } from '../capabilities/email/api-transport.js';
import { _resetDb } from '../spend-tracker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MockDatabase = Database as unknown as { resetDb: () => void };

function makeL2Claims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return {
    passportId: 'test-passport',
    agentId: 'test-agent',
    trustLevel: 2,
    trustStatus: 'creator_claimed',
    flags: [],
    isDisputed: false,
    version: '1',
    ...overrides,
  };
}

function makeL3Claims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return {
    ...makeL2Claims(),
    trustLevel: 3,
    trustStatus: 'seller_confirmed',
    ...overrides,
  };
}

function makeL1Claims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return {
    ...makeL2Claims(),
    trustLevel: 1,
    trustStatus: 'auto_generated_draft',
    ...overrides,
  };
}

function setLocalEmailConfig() {
  mockReadConfig.mockReturnValue({
    version: 1,
    instanceId: 'test-instance',
    registryUrl: 'http://localhost:8000',
    passphraseHash: 'hash',
    capabilities: { email: { transport: 'local', localPort: 2525 } },
  });
}

function setNoEmailConfig() {
  mockReadConfig.mockReturnValue({
    version: 1,
    instanceId: 'test-instance',
    registryUrl: 'http://localhost:8000',
    passphraseHash: 'hash',
    capabilities: {},
  });
}

function setPostmarkConfig() {
  mockReadConfig.mockReturnValue({
    version: 1,
    instanceId: 'test-instance',
    registryUrl: 'http://localhost:8000',
    passphraseHash: 'hash',
    capabilities: { email: { transport: 'postmark' } },
  });
}

afterAll(() => {
  _resetDb();
  MockDatabase.resetDb();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('email capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetDb();
    MockDatabase.resetDb();
    // Default: configure local transport
    setLocalEmailConfig();
    // Default nodemailer mock: succeeds
    mockNodemailerSendMail.mockResolvedValue({ messageId: 'test-msg-id-001' });
    // Reset env vars
    delete process.env.POSTMARK_SERVER_TOKEN;
    delete process.env.RESEND_API_KEY;
  });

  // -------------------------------------------------------------------------
  // 1. createMailbox — inserts into DB
  // -------------------------------------------------------------------------

  describe('createMailbox', () => {
    it('inserts address into mailboxes table and returns address', async () => {
      const result = await createMailbox({ address: 'agent@local.test' }, makeL2Claims());

      expect(result.address).toBe('agent@local.test');

      const { openDb } = await import('../spend-tracker.js');
      const db = openDb();
      const row = db
        .prepare('SELECT address FROM mailboxes WHERE address = ?')
        .get('agent@local.test') as { address: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.address).toBe('agent@local.test');
    });

    it('is idempotent (INSERT OR IGNORE)', async () => {
      await createMailbox({ address: 'idempotent@local.test' }, makeL2Claims());
      await createMailbox({ address: 'idempotent@local.test' }, makeL2Claims());

      const { openDb } = await import('../spend-tracker.js');
      const db = openDb();
      const rows = db
        .prepare('SELECT address FROM mailboxes WHERE address = ?')
        .all('idempotent@local.test') as unknown[];
      expect(rows).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 2. sendEmail — delegates to transport
  // -------------------------------------------------------------------------

  describe('sendEmail', () => {
    it('calls the local transport sendMail and returns messageId', async () => {
      setLocalEmailConfig();
      mockNodemailerSendMail.mockResolvedValue({ messageId: 'nm-test-id' });

      const result = await sendEmail(
        { from: 'a@local.test', to: 'b@local.test', subject: 'Hi', body: 'Hello' },
        makeL2Claims(),
      );

      expect(result.messageId).toBe('nm-test-id');
      expect(mockNodemailerSendMail).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // 3. readInbox — queries DB, returns messages
  // -------------------------------------------------------------------------

  describe('readInbox', () => {
    it('returns messages for the given address', async () => {
      // Seed the DB
      const { openDb } = await import('../spend-tracker.js');
      const db = openDb();
      db.prepare('INSERT OR IGNORE INTO mailboxes (address, created_at) VALUES (?, ?)').run(
        'inbox@local.test',
        new Date().toISOString(),
      );
      db.prepare(
        'INSERT INTO emails (mailbox_address, message_id, subject, from_address, body_text, received_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        'inbox@local.test',
        'msg-001',
        'Test Subject',
        'sender@example.com',
        'Hello world',
        new Date().toISOString(),
      );

      const result = await readInbox({ address: 'inbox@local.test' }, makeL2Claims());

      expect(result.messages).toHaveLength(1);
      expect((result.messages[0] as { subject: string }).subject).toBe('Test Subject');
    });

    it('returns empty array for mailbox with no messages', async () => {
      const { openDb } = await import('../spend-tracker.js');
      const db = openDb();
      db.prepare('INSERT OR IGNORE INTO mailboxes (address, created_at) VALUES (?, ?)').run(
        'empty@local.test',
        new Date().toISOString(),
      );

      const result = await readInbox({ address: 'empty@local.test' }, makeL2Claims());
      expect(result.messages).toHaveLength(0);
    });

    it('respects the limit parameter', async () => {
      const { openDb } = await import('../spend-tracker.js');
      const db = openDb();
      db.prepare('INSERT OR IGNORE INTO mailboxes (address, created_at) VALUES (?, ?)').run(
        'limited@local.test',
        new Date().toISOString(),
      );
      for (let i = 0; i < 5; i++) {
        db.prepare(
          'INSERT INTO emails (mailbox_address, message_id, subject, from_address, body_text, received_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(
          'limited@local.test',
          `msg-00${i}`,
          `Subject ${i}`,
          'sender@example.com',
          'Body',
          new Date().toISOString(),
        );
      }

      const result = await readInbox({ address: 'limited@local.test', limit: 3 }, makeL2Claims());
      expect(result.messages).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // 4. waitForEmail — returns message when filter matches
  // -------------------------------------------------------------------------

  describe('waitForEmail', () => {
    it('returns immediately when a matching message exists', async () => {
      const { openDb } = await import('../spend-tracker.js');
      const db = openDb();
      db.prepare('INSERT OR IGNORE INTO mailboxes (address, created_at) VALUES (?, ?)').run(
        'wait@local.test',
        new Date().toISOString(),
      );
      db.prepare(
        'INSERT INTO emails (mailbox_address, message_id, subject, from_address, body_text, received_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        'wait@local.test',
        'msg-wait-001',
        'Welcome to the platform',
        'noreply@example.com',
        'Thanks for signing up',
        new Date().toISOString(),
      );

      const result = await waitForEmail(
        {
          address: 'wait@local.test',
          filter: { subject_contains: 'Welcome', from_contains: 'noreply' },
          timeout_ms: 5000,
        },
        makeL2Claims(),
      );

      expect(result.message).toBeDefined();
      expect((result.message as { subject: string }).subject).toBe('Welcome to the platform');
    });

    it('filter with body_contains works', async () => {
      const { openDb } = await import('../spend-tracker.js');
      const db = openDb();
      db.prepare('INSERT OR IGNORE INTO mailboxes (address, created_at) VALUES (?, ?)').run(
        'body-filter@local.test',
        new Date().toISOString(),
      );
      db.prepare(
        'INSERT INTO emails (mailbox_address, message_id, subject, from_address, body_text, received_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        'body-filter@local.test',
        'msg-body-001',
        'Your code',
        'codes@example.com',
        'Your verification code is 123456',
        new Date().toISOString(),
      );

      const result = await waitForEmail(
        {
          address: 'body-filter@local.test',
          filter: { body_contains: '123456' },
          timeout_ms: 5000,
        },
        makeL2Claims(),
      );

      expect((result.message as { body_text: string }).body_text).toContain('123456');
    });
  });

  // -------------------------------------------------------------------------
  // 5. waitForEmail — throws timeout error
  // -------------------------------------------------------------------------

  describe('waitForEmail timeout', () => {
    it('throws with timeout message after timeout_ms', async () => {
      const { openDb } = await import('../spend-tracker.js');
      const db = openDb();
      db.prepare('INSERT OR IGNORE INTO mailboxes (address, created_at) VALUES (?, ?)').run(
        'timeout@local.test',
        new Date().toISOString(),
      );

      await expect(
        waitForEmail(
          { address: 'timeout@local.test', timeout_ms: 100 },
          makeL2Claims(),
        ),
      ).rejects.toThrow(/timed out after 100ms/);
    });
  });

  // -------------------------------------------------------------------------
  // 6. deleteMailbox — deletes from DB (cascade)
  // -------------------------------------------------------------------------

  describe('deleteMailbox', () => {
    it('deletes the mailbox and cascades to emails', async () => {
      const { openDb } = await import('../spend-tracker.js');
      const db = openDb();
      db.pragma('foreign_keys = ON');
      db.prepare('INSERT OR IGNORE INTO mailboxes (address, created_at) VALUES (?, ?)').run(
        'delete@local.test',
        new Date().toISOString(),
      );
      db.prepare(
        'INSERT INTO emails (mailbox_address, message_id, subject, from_address, body_text, received_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        'delete@local.test',
        'msg-del-001',
        'Delete me',
        'sender@example.com',
        'Body',
        new Date().toISOString(),
      );

      const result = await deleteMailbox({ address: 'delete@local.test' }, makeL3Claims());

      expect(result.deleted).toBe(true);

      const mailboxRow = db
        .prepare('SELECT address FROM mailboxes WHERE address = ?')
        .get('delete@local.test');
      expect(mailboxRow).toBeUndefined();

      // Cascade: email should also be gone (requires foreign_keys pragma)
      const emailRows = db
        .prepare("SELECT * FROM emails WHERE mailbox_address = 'delete@local.test'")
        .all();
      expect(emailRows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 7. send_email with L1 passport — throws TrustError
  // -------------------------------------------------------------------------

  describe('trust gating', () => {
    it('send_email with L1 passport throws TrustError', async () => {
      setLocalEmailConfig();
      await expect(
        sendEmail(
          { from: 'a@local.test', to: 'b@local.test', subject: 'Hi', body: 'Hello' },
          makeL1Claims(),
        ),
      ).rejects.toThrow(TrustError);
    });

    // -----------------------------------------------------------------------
    // 8. delete_mailbox with L2 passport — throws TrustError (requires L3)
    // -----------------------------------------------------------------------

    it('delete_mailbox with L2 passport throws TrustError', async () => {
      await expect(
        deleteMailbox({ address: 'any@local.test' }, makeL2Claims()),
      ).rejects.toThrow(TrustError);
    });

    it('create_mailbox with L2 succeeds', async () => {
      await expect(
        createMailbox({ address: 'create-l2@local.test' }, makeL2Claims()),
      ).resolves.toBeDefined();
    });

    it('read_inbox with L2 succeeds', async () => {
      await expect(
        readInbox({ address: 'readl2@local.test' }, makeL2Claims()),
      ).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 9. API transport (Postmark) — mock, verify sendEmail called
  // -------------------------------------------------------------------------

  describe('PostmarkTransport', () => {
    it('calls postmark ServerClient.sendEmail and returns messageId', async () => {
      process.env.POSTMARK_SERVER_TOKEN = 'test-postmark-token';

      const { ServerClient } = await import('postmark');
      const mockSendEmail = vi.fn().mockResolvedValue({ MessageID: 'pm-msg-id-001' });
      vi.mocked(ServerClient).mockImplementation(() => ({
        sendEmail: mockSendEmail,
      }) as unknown as InstanceType<typeof ServerClient>);

      const transport = new PostmarkTransport();
      const result = await transport.sendEmail({
        from: 'from@example.com',
        to: 'to@example.com',
        subject: 'Hello',
        body: 'Plain text',
      });

      expect(result.messageId).toBe('pm-msg-id-001');
      expect(mockSendEmail).toHaveBeenCalledOnce();
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          From: 'from@example.com',
          To: 'to@example.com',
          Subject: 'Hello',
          TextBody: 'Plain text',
        }),
      );
    });

    it('throws if POSTMARK_SERVER_TOKEN is not set', () => {
      delete process.env.POSTMARK_SERVER_TOKEN;
      expect(() => new PostmarkTransport()).toThrow(/POSTMARK_SERVER_TOKEN/);
    });
  });

  // -------------------------------------------------------------------------
  // 10. Unconfigured email throws SecretsError
  // -------------------------------------------------------------------------

  describe('unconfigured email', () => {
    it('sendEmail throws SecretsError when email not configured', async () => {
      setNoEmailConfig();
      await expect(
        sendEmail(
          { from: 'a@local.test', to: 'b@local.test', subject: 'Hi', body: 'Body' },
          makeL2Claims(),
        ),
      ).rejects.toThrow(SecretsError);
    });

    it('SecretsError message mentions hands-body-and-feet init', async () => {
      setNoEmailConfig();
      await expect(
        sendEmail(
          { from: 'a@local.test', to: 'b@local.test', subject: 'Hi', body: 'Body' },
          makeL2Claims(),
        ),
      ).rejects.toThrow(/hands-body-and-feet init/);
    });
  });

  // -------------------------------------------------------------------------
  // 11. ResendTransport — throws if RESEND_API_KEY not set
  // -------------------------------------------------------------------------

  describe('ResendTransport', () => {
    it('throws if RESEND_API_KEY is not set', () => {
      delete process.env.RESEND_API_KEY;
      expect(() => new ResendTransport()).toThrow(/RESEND_API_KEY/);
    });

    it('calls resend emails.send and returns messageId', async () => {
      process.env.RESEND_API_KEY = 'test-resend-key';

      const { Resend } = await import('resend');
      const mockSend = vi.fn().mockResolvedValue({ data: { id: 'rs-msg-id-001' }, error: null });
      vi.mocked(Resend).mockImplementation(() => ({
        emails: { send: mockSend },
      }) as unknown as InstanceType<typeof Resend>);

      const transport = new ResendTransport();
      const result = await transport.sendEmail({
        from: 'from@example.com',
        to: 'to@example.com',
        subject: 'Hello',
        body: 'Plain text',
      });

      expect(result.messageId).toBe('rs-msg-id-001');
    });
  });

  // -------------------------------------------------------------------------
  // 12. sendEmail via postmark config uses PostmarkTransport
  // -------------------------------------------------------------------------

  describe('sendEmail with postmark transport config', () => {
    it('uses PostmarkTransport when config says postmark', async () => {
      process.env.POSTMARK_SERVER_TOKEN = 'pm-token';
      setPostmarkConfig();

      const { ServerClient } = await import('postmark');
      const mockSendEmail = vi.fn().mockResolvedValue({ MessageID: 'pm-routed-id' });
      vi.mocked(ServerClient).mockImplementation(() => ({
        sendEmail: mockSendEmail,
      }) as unknown as InstanceType<typeof ServerClient>);

      const result = await sendEmail(
        { from: 'a@example.com', to: 'b@example.com', subject: 'Routed', body: 'Body' },
        makeL2Claims(),
      );

      expect(result.messageId).toBe('pm-routed-id');
    });
  });
});
