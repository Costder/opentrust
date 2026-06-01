import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { PassportClaims } from '../types.js';

// ── Hoisted SDK mock ────────────────────────────────────────────────────────────

const { mockCreate, mockSend, mockList, mockReadConfig } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockSend: vi.fn(),
  mockList: vi.fn(),
  mockReadConfig: vi.fn(),
}));

vi.mock('agentmail', () => ({
  AgentMailClient: vi.fn(() => ({
    inboxes: {
      create: mockCreate,
      messages: { send: mockSend, list: mockList },
    },
  })),
}));

vi.mock('../config.js', () => ({
  readConfig: mockReadConfig,
  CONFIG_DIR: '/tmp/test-haf-agentmail',
  ensureConfigDir: vi.fn(),
}));

// In-memory sqlite for the routed-tool tests
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

import Database from 'better-sqlite3';
import { AgentMailTransport } from '../capabilities/email/agentmail-transport.js';
import { createMailbox, readInbox, ingestAgentMailWebhook } from '../capabilities/email/index.js';
import { _resetDb } from '../spend-tracker.js';

const MockDatabase = Database as unknown as { resetDb: () => void };

function makeL2Claims(): PassportClaims {
  return {
    passportId: 'p', agentId: 'a', trustLevel: 2, trustStatus: 'creator_claimed',
    flags: [], isDisputed: false, version: '1',
  };
}

function setAgentMailConfig() {
  mockReadConfig.mockReturnValue({
    version: 1, instanceId: 'test', registryUrl: 'http://localhost:8000',
    passphraseHash: 'h', capabilities: { email: { transport: 'agentmail' } },
  });
}

describe('AgentMailTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENTMAIL_API_KEY = 'test-agentmail-key';
  });

  it('throws if AGENTMAIL_API_KEY is not set', () => {
    delete process.env.AGENTMAIL_API_KEY;
    expect(() => new AgentMailTransport()).toThrow(/AGENTMAIL_API_KEY/);
  });

  it('createInbox returns address (from .email) and inboxId', async () => {
    mockCreate.mockResolvedValue({ inboxId: 'inb_123', email: 'agent@agentmail.to' });
    const t = new AgentMailTransport();
    const res = await t.createInbox('agent-x');
    expect(res.address).toBe('agent@agentmail.to');
    expect(res.inboxId).toBe('inb_123');
    expect(mockCreate).toHaveBeenCalledWith({ clientId: 'agent-x' });
  });

  it('sendEmail calls messages.send and returns messageId', async () => {
    mockSend.mockResolvedValue({ messageId: 'am-msg-001' });
    const t = new AgentMailTransport();
    const res = await t.sendEmail({
      inboxId: 'inb_123',
      from: 'agent@agentmail.to',
      to: 'someone@example.com',
      subject: 'Hi',
      body: 'Plain',
      html: '<p>Plain</p>',
    });
    expect(res.messageId).toBe('am-msg-001');
    expect(mockSend).toHaveBeenCalledWith('inb_123', expect.objectContaining({
      to: 'someone@example.com',
      subject: 'Hi',
      text: 'Plain',
      html: '<p>Plain</p>',
    }));
  });

  it('listMessages maps AgentMail messages to the local shape', async () => {
    mockList.mockResolvedValue({
      messages: [
        { messageId: 'm1', subject: 'Hello', from: 'a@x.com', extractedText: 'body one', html: '<p>1</p>' },
        { messageId: 'm2', subject: 'Yo', from: 'b@x.com', text: 'body two', html: null },
      ],
    });
    const t = new AgentMailTransport();
    const msgs = await t.listMessages('inb_123', 10);
    expect(mockList).toHaveBeenCalledWith('inb_123', { limit: 10 });
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual(expect.objectContaining({
      message_id: 'm1', subject: 'Hello', from_address: 'a@x.com', body_text: 'body one', body_html: '<p>1</p>',
    }));
    // falls back to .text when extractedText is absent
    expect(msgs[1].body_text).toBe('body two');
  });
});

// ── Tools routed through the agentmail transport ────────────────────────────────

describe('email tools with agentmail transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetDb();
    MockDatabase.resetDb();
    process.env.AGENTMAIL_API_KEY = 'test-key';
    setAgentMailConfig();
  });

  it('create_mailbox provisions a real AgentMail inbox and stores inbox_id', async () => {
    mockCreate.mockResolvedValue({ inboxId: 'inb_real', email: 'agent7@agentmail.to' });
    const res = await createMailbox({ address: 'agent7' }, makeL2Claims());
    expect(res.address).toBe('agent7@agentmail.to');
    expect(mockCreate).toHaveBeenCalled();

    const { openDb } = await import('../spend-tracker.js');
    const row = openDb()
      .prepare('SELECT address, inbox_id FROM mailboxes WHERE address = ?')
      .get('agent7@agentmail.to') as { address: string; inbox_id: string } | undefined;
    expect(row?.inbox_id).toBe('inb_real');
  });

  it('read_inbox pulls from AgentMail, upserts, and returns messages', async () => {
    mockCreate.mockResolvedValue({ inboxId: 'inb_r', email: 'reader@agentmail.to' });
    await createMailbox({ address: 'reader' }, makeL2Claims());
    mockList.mockResolvedValue({
      messages: [{ messageId: 'am1', subject: 'Hi there', from: 'x@y.com', extractedText: 'hello' }],
    });
    const res = await readInbox({ address: 'reader@agentmail.to' }, makeL2Claims());
    expect(mockList).toHaveBeenCalledWith('inb_r', { limit: 20 });
    expect(res.messages.length).toBeGreaterThanOrEqual(1);
    expect((res.messages[0] as { subject: string }).subject).toBe('Hi there');
  });
});

describe('ingestAgentMailWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetDb();
    MockDatabase.resetDb();
    setAgentMailConfig();
  });

  it('upserts a message.received event into emails', async () => {
    const { openDb } = await import('../spend-tracker.js');
    openDb()
      .prepare('INSERT OR IGNORE INTO mailboxes (address, inbox_id, created_at) VALUES (?, ?, ?)')
      .run('hook@agentmail.to', 'inb_hook', new Date().toISOString());

    const result = ingestAgentMailWebhook({
      type: 'message.received',
      message: {
        inboxId: 'inb_hook',
        messageId: 'wh1',
        subject: 'Pushed mail',
        from: 'sender@x.com',
        extractedText: 'real-time body',
      },
    });
    expect(result.ingested).toBe(true);

    const row = openDb()
      .prepare('SELECT subject, body_text FROM emails WHERE message_id = ?')
      .get('wh1') as { subject: string; body_text: string } | undefined;
    expect(row?.subject).toBe('Pushed mail');
    expect(row?.body_text).toBe('real-time body');
  });

  it('ignores duplicate message ids', async () => {
    const { openDb } = await import('../spend-tracker.js');
    openDb()
      .prepare('INSERT OR IGNORE INTO mailboxes (address, inbox_id, created_at) VALUES (?, ?, ?)')
      .run('dup@agentmail.to', 'inb_dup', new Date().toISOString());
    const payload = {
      type: 'message.received' as const,
      message: { inboxId: 'inb_dup', messageId: 'dup1', subject: 'S', from: 'a@b.com', text: 'x' },
    };
    ingestAgentMailWebhook(payload);
    ingestAgentMailWebhook(payload);
    const rows = openDb().prepare('SELECT * FROM emails WHERE message_id = ?').all('dup1');
    expect(rows).toHaveLength(1);
  });

  it('ignores non-message.received events', () => {
    const result = ingestAgentMailWebhook({ type: 'message.delivered', message: { inboxId: 'x', messageId: 'y' } });
    expect(result.ingested).toBe(false);
  });

  it('ignores events for unknown inboxes', () => {
    const result = ingestAgentMailWebhook({
      type: 'message.received',
      message: { inboxId: 'inb_unknown', messageId: 'z', subject: 'S', from: 'a@b.com', text: 't' },
    });
    expect(result.ingested).toBe(false);
  });
});
