import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TrustError } from '../trust.js';
import { SecretsError } from '../secrets.js';
import type { PassportClaims } from '../types.js';

// ────────────────────────────────────────────────────────────
// Module mocks
// ────────────────────────────────────────────────────────────
vi.mock('../capabilities/triggers/index.js', () => ({
  matchAndFire: vi.fn().mockResolvedValue(undefined),
  loadActiveTriggers: vi.fn(),
}));

// ────────────────────────────────────────────────────────────
// Hoisted mocks
// ────────────────────────────────────────────────────────────
const { mockXmppClient, mockXmppXml } = vi.hoisted(() => {
  const mockStart = vi.fn().mockResolvedValue(undefined);
  const mockStop = vi.fn().mockResolvedValue(undefined);
  const mockSend = vi.fn().mockResolvedValue(undefined);
  const mockOn = vi.fn().mockReturnThis();

  const xmppInstance = { start: mockStart, stop: mockStop, send: mockSend, on: mockOn };
  const mockXmppClient = vi.fn().mockReturnValue(xmppInstance);
  const mockXmppXml = vi.fn((_name: string, attrs?: Record<string, string>, ...children: unknown[]) => ({
    name: _name,
    attrs,
    children,
  }));

  return { mockXmppClient, mockXmppXml };
});

vi.mock('@xmpp/client', () => ({
  client: mockXmppClient,
  xml: mockXmppXml,
  jid: vi.fn(),
}));

vi.mock('../config.js', () => ({
  readConfig: vi.fn(),
  CONFIG_DIR: '/tmp/test-haf-jmp',
  ensureConfigDir: vi.fn(),
}));

import {
  provisionPhoneNumberJmp,
  sendSmsJmp,
  readSmsJmp,
  releasePhoneNumberJmp,
  _resetXmppConn,
  _getInboundMessages,
} from '../capabilities/phone-jmp/index.js';
import { matchAndFire } from '../capabilities/triggers/index.js';

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
function makeL3Claims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return {
    passportId: 'p1',
    agentId: 'a1',
    trustLevel: 3,
    trustStatus: 'seller_confirmed',
    flags: [],
    isDisputed: false,
    version: '1',
    ...overrides,
  };
}

function makeL2Claims(): PassportClaims {
  return { ...makeL3Claims(), trustLevel: 2, trustStatus: 'creator_claimed' };
}

function setXmppEnv() {
  process.env['XMPP_JID'] = 'test@jmp.chat';
  process.env['XMPP_PASSWORD'] = 'secret123';
}

function clearXmppEnv() {
  delete process.env['XMPP_JID'];
  delete process.env['XMPP_PASSWORD'];
}

beforeEach(() => {
  _resetXmppConn();
  vi.clearAllMocks();
  setXmppEnv();
  // Reset start mock to resolve immediately
  const instance = mockXmppClient.mock.results[0]?.value ?? {
    start: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
  };
  if (instance.start) {
    (instance.start as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  }
  // Re-mock to return fresh instance each test
  const newInstance = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
  };
  mockXmppClient.mockReturnValue(newInstance);
});

afterEach(() => {
  clearXmppEnv();
  _resetXmppConn();
});

// ────────────────────────────────────────────────────────────
// Trust level tests
// ────────────────────────────────────────────────────────────
describe('trust level enforcement', () => {
  it('provision_phone_number_jmp throws TrustError for L2', async () => {
    await expect(
      provisionPhoneNumberJmp({}, makeL2Claims()),
    ).rejects.toThrow(TrustError);
  });

  it('send_sms_jmp throws TrustError for L2', async () => {
    await expect(
      sendSmsJmp({ to: '+15551234567', message: 'hi' }, makeL2Claims()),
    ).rejects.toThrow(TrustError);
  });

  it('release_phone_number_jmp throws TrustError for L2', async () => {
    await expect(
      releasePhoneNumberJmp({ number: '+15551234567' }, makeL2Claims()),
    ).rejects.toThrow(TrustError);
  });

  it('read_sms_jmp succeeds for L2', async () => {
    // L2 should not throw TrustError (will throw SecretsError if XMPP succeeds)
    // Since XMPP_JID is set, it should work
    const result = await readSmsJmp({}, makeL2Claims());
    expect(result.messages).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────
// SecretsError when XMPP vars missing
// ────────────────────────────────────────────────────────────
describe('SecretsError when credentials missing', () => {
  it('provision_phone_number_jmp throws SecretsError when XMPP_JID not set', async () => {
    clearXmppEnv();
    _resetXmppConn();
    await expect(
      provisionPhoneNumberJmp({}, makeL3Claims()),
    ).rejects.toThrow(SecretsError);
  });

  it('send_sms_jmp throws SecretsError when XMPP_PASSWORD not set', async () => {
    delete process.env['XMPP_PASSWORD'];
    _resetXmppConn();
    await expect(
      sendSmsJmp({ to: '+15551234567', message: 'hello' }, makeL3Claims()),
    ).rejects.toThrow(SecretsError);
  });

  it('read_sms_jmp throws SecretsError when XMPP vars not set', async () => {
    clearXmppEnv();
    _resetXmppConn();
    await expect(
      readSmsJmp({}, makeL2Claims()),
    ).rejects.toThrow(SecretsError);
  });
});

// ────────────────────────────────────────────────────────────
// send_sms_jmp
// ────────────────────────────────────────────────────────────
describe('send_sms_jmp', () => {
  it('sends XMPP message to number@jmp.chat', async () => {
    const result = await sendSmsJmp(
      { to: '+15551234567', message: 'Hello from agent' },
      makeL3Claims(),
    );

    expect(result.sent).toBe(true);
    expect(result.to).toBe('+15551234567@jmp.chat');

    // Check xml was called to build the stanza
    expect(mockXmppXml).toHaveBeenCalledWith('message', { to: '+15551234567@jmp.chat', type: 'chat' }, expect.anything());
  });

  it('uses number@jmp.chat if number already has @', async () => {
    const result = await sendSmsJmp(
      { to: '+15551234567@jmp.chat', message: 'test' },
      makeL3Claims(),
    );
    expect(result.to).toBe('+15551234567@jmp.chat');
  });
});

// ────────────────────────────────────────────────────────────
// provision_phone_number_jmp
// ────────────────────────────────────────────────────────────
describe('provision_phone_number_jmp', () => {
  it('sends provisioning request to JMP gateway', async () => {
    const result = await provisionPhoneNumberJmp({ area_code: '415' }, makeL3Claims());
    expect(result.gateway).toContain('415');
    expect(result.message).toContain('415');
    expect(mockXmppXml).toHaveBeenCalledWith('message', expect.objectContaining({ to: expect.stringContaining('415') }), expect.anything());
  });

  it('uses default area code 555 if not provided', async () => {
    const result = await provisionPhoneNumberJmp({}, makeL3Claims());
    expect(result.gateway).toContain('555');
  });
});

// ────────────────────────────────────────────────────────────
// read_sms_jmp
// ────────────────────────────────────────────────────────────
describe('read_sms_jmp', () => {
  it('L2 succeeds and returns empty when no messages', async () => {
    const result = await readSmsJmp({}, makeL2Claims());
    expect(result.messages).toEqual([]);
    expect(result.count).toBe(0);
  });

  it('returns buffered inbound messages', async () => {
    // Manually seed the inbound map
    const msgs = _getInboundMessages();
    msgs.set('+15559876543@jmp.chat', [
      { from: '+15559876543@jmp.chat', body: 'inbound test', received_at: new Date().toISOString() },
    ]);

    // Ensure XMPP client is connected first
    await readSmsJmp({}, makeL2Claims());

    const result = await readSmsJmp({ number: '+15559876543' }, makeL2Claims());
    expect(result.count).toBe(1);
    expect(result.messages[0].body).toBe('inbound test');
  });

  it('calls matchAndFire with sms source and payload when stanza arrives', async () => {
    // Connect the XMPP client so the stanza handler is registered
    await readSmsJmp({}, makeL2Claims());

    // Find the xmpp instance that was created and extract the stanza handler
    const xmppInstance = mockXmppClient.mock.results[mockXmppClient.mock.results.length - 1]?.value as {
      on: ReturnType<typeof vi.fn>;
    };
    const onCalls: Array<[string, (...args: unknown[]) => void]> = xmppInstance.on.mock.calls as Array<[string, (...args: unknown[]) => void]>;
    const stanzaEntry = onCalls.find(([event]) => event === 'stanza');
    expect(stanzaEntry).toBeDefined();
    const stanzaHandler = stanzaEntry![1];

    // Simulate an inbound JMP stanza
    const fakeStanza = {
      is: (tag: string) => tag === 'message',
      attrs: { from: '+15550001111@jmp.chat' },
      getChildText: (tag: string) => tag === 'body' ? 'hello from test' : null,
    };
    stanzaHandler(fakeStanza);

    // Allow the microtask queue to flush
    await Promise.resolve();

    expect(matchAndFire).toHaveBeenCalledWith('sms', expect.objectContaining({
      from_number: expect.any(String),
      body: expect.any(String),
    }));
  });
});

// ────────────────────────────────────────────────────────────
// release_phone_number_jmp
// ────────────────────────────────────────────────────────────
describe('release_phone_number_jmp', () => {
  it('L3 required', async () => {
    await expect(
      releasePhoneNumberJmp({ number: '+15551234567' }, makeL2Claims()),
    ).rejects.toThrow(TrustError);
  });

  it('sends release command and clears inbox', async () => {
    // Seed inbox
    const msgs = _getInboundMessages();
    msgs.set('+15551234567@jmp.chat', [
      { from: '+15551234567@jmp.chat', body: 'msg', received_at: new Date().toISOString() },
    ]);

    const result = await releasePhoneNumberJmp({ number: '+15551234567' }, makeL3Claims());
    expect(result.released).toBe(true);
    expect(result.number).toBe('+15551234567');
    expect(mockXmppXml).toHaveBeenCalledWith('message', expect.objectContaining({ to: expect.stringContaining('inum.net') }), expect.anything());

    // Inbox cleared
    expect(msgs.has('+15551234567@jmp.chat')).toBe(false);
  });
});
