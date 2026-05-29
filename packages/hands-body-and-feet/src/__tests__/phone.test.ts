import { vi, describe, it, expect, beforeEach, afterAll } from 'vitest';
import { TrustError } from '../trust.js';
import { SecretsError } from '../secrets.js';
import type { PassportClaims } from '../types.js';

// ---------------------------------------------------------------------------
// Hoisted mock functions — MUST be hoisted so they're available in vi.mock
// factories before the module is evaluated.
// ---------------------------------------------------------------------------

const {
  mockReadConfig,
  mockTwilioAvailableList,
  mockTwilioIncomingCreate,
  mockTwilioMessagesCreate,
  mockTwilioMessagesList,
  mockTwilioIncomingRemove,
} = vi.hoisted(() => ({
  mockReadConfig: vi.fn(),
  mockTwilioAvailableList: vi.fn(),
  mockTwilioIncomingCreate: vi.fn(),
  mockTwilioMessagesCreate: vi.fn(),
  mockTwilioMessagesList: vi.fn(),
  mockTwilioIncomingRemove: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('twilio', () => {
  const incomingPhoneNumbersInstance = vi.fn(() => ({
    remove: mockTwilioIncomingRemove,
  })) as ReturnType<typeof vi.fn> & { create: ReturnType<typeof vi.fn> };
  incomingPhoneNumbersInstance.create = mockTwilioIncomingCreate;

  const twilioClient = {
    availablePhoneNumbers: vi.fn(() => ({
      local: { list: mockTwilioAvailableList },
    })),
    incomingPhoneNumbers: incomingPhoneNumbersInstance,
    messages: {
      create: mockTwilioMessagesCreate,
      list: mockTwilioMessagesList,
    },
  };
  const ctor = vi.fn(() => twilioClient);
  return { default: ctor };
});

vi.mock('../config.js', () => ({
  readConfig: mockReadConfig,
  CONFIG_DIR: '/tmp/test-haf-phone',
  ensureConfigDir: vi.fn(),
}));

// Global fetch mock for SignalWire
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// SQLite mock — in-memory DB
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
  provisionPhoneNumber,
  sendSms,
  readSms,
  releasePhoneNumber,
} from '../capabilities/phone/index.js';
import { _resetDb } from '../spend-tracker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MockDatabase = Database as unknown as { resetDb: () => void };

function makeL3Claims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return {
    passportId: 'test-passport',
    agentId: 'test-agent',
    trustLevel: 3,
    trustStatus: 'seller_confirmed',
    flags: [],
    isDisputed: false,
    version: '1',
    ...overrides,
  };
}

function makeL2Claims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return { ...makeL3Claims(), trustLevel: 2, trustStatus: 'creator_claimed', ...overrides };
}

function setTwilioConfig() {
  mockReadConfig.mockReturnValue({
    version: 1,
    instanceId: 'test-instance',
    registryUrl: 'http://localhost:8000',
    passphraseHash: 'hash',
    capabilities: { phone: { provider: 'twilio' } },
  });
}

function setSignalWireConfig() {
  mockReadConfig.mockReturnValue({
    version: 1,
    instanceId: 'test-instance',
    registryUrl: 'http://localhost:8000',
    passphraseHash: 'hash',
    capabilities: { phone: { provider: 'signalwire' } },
  });
}

function setNoPhoneConfig() {
  mockReadConfig.mockReturnValue({
    version: 1,
    instanceId: 'test-instance',
    registryUrl: 'http://localhost:8000',
    passphraseHash: 'hash',
    capabilities: {},
  });
}

afterAll(() => {
  _resetDb();
  MockDatabase.resetDb();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('phone capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetDb();
    MockDatabase.resetDb();
    // Set Twilio credentials by default
    process.env.TWILIO_ACCOUNT_SID = 'ACtest123';
    process.env.TWILIO_AUTH_TOKEN = 'auth-token-test';
    delete process.env.SIGNALWIRE_PROJECT_ID;
    delete process.env.SIGNALWIRE_AUTH_TOKEN;
    delete process.env.SIGNALWIRE_SPACE_URL;
  });

  // -------------------------------------------------------------------------
  // 1. provisionPhoneNumber — trust gating
  // -------------------------------------------------------------------------

  describe('provisionPhoneNumber trust gating', () => {
    it('L2 throws TrustError (requires L3)', async () => {
      setTwilioConfig();
      await expect(provisionPhoneNumber({}, makeL2Claims())).rejects.toThrow(TrustError);
    });

    it('L3 proceeds (does not throw TrustError)', async () => {
      setTwilioConfig();
      mockTwilioAvailableList.mockResolvedValue([{ phoneNumber: '+12025551234' }]);
      mockTwilioIncomingCreate.mockResolvedValue({ phoneNumber: '+12025551234', sid: 'PN123' });
      await expect(provisionPhoneNumber({}, makeL3Claims())).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Twilio provider — provisions and stores in DB
  // -------------------------------------------------------------------------

  describe('TwilioProvider provisioning', () => {
    it('provisions a number and stores it in the DB', async () => {
      setTwilioConfig();
      mockTwilioAvailableList.mockResolvedValue([{ phoneNumber: '+12025551234' }]);
      mockTwilioIncomingCreate.mockResolvedValue({ phoneNumber: '+12025551234', sid: 'PN123' });

      const result = await provisionPhoneNumber({ area_code: '202' }, makeL3Claims());

      expect(result.number).toBe('+12025551234');
      expect(result.provider).toBe('twilio');
      // Verify it was stored in DB
      const { openDb } = await import('../spend-tracker.js');
      const db = openDb();
      const row = db.prepare('SELECT * FROM phone_numbers WHERE number = ?').get('+12025551234') as
        { number: string; provider: string; sid: string; area_code: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.provider).toBe('twilio');
      expect(row?.sid).toBe('PN123');
      expect(row?.area_code).toBe('202');
    });

    it('throws when no numbers are available', async () => {
      setTwilioConfig();
      mockTwilioAvailableList.mockResolvedValue([]);
      await expect(provisionPhoneNumber({ area_code: '999' }, makeL3Claims())).rejects.toThrow(
        /No phone numbers available/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // 3. SignalWire provider — uses fetch, not twilio client
  // -------------------------------------------------------------------------

  describe('SignalWireProvider provisioning', () => {
    beforeEach(() => {
      process.env.SIGNALWIRE_PROJECT_ID = 'sw-project-id';
      process.env.SIGNALWIRE_AUTH_TOKEN = 'sw-auth-token';
      process.env.SIGNALWIRE_SPACE_URL = 'https://example.signalwire.com';
    });

    it('uses fetch (not twilio client) for provisioning', async () => {
      setSignalWireConfig();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            available_phone_numbers: [{ phone_number: '+13105551234' }],
          }),
          text: async () => '',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ phone_number: '+13105551234', sid: 'SW-SID-001' }),
          text: async () => '',
        });

      const result = await provisionPhoneNumber({ area_code: '310' }, makeL3Claims());

      expect(result.number).toBe('+13105551234');
      expect(result.provider).toBe('signalwire');
      // Twilio SDK constructor should NOT have been called for SignalWire
      const twilioModule = await import('twilio');
      const twilioDefault = twilioModule.default as unknown as ReturnType<typeof vi.fn>;
      expect(twilioDefault).not.toHaveBeenCalled();
      // fetch MUST have been called
      expect(mockFetch).toHaveBeenCalled();
    });

    it('stores SignalWire number in DB with correct provider', async () => {
      setSignalWireConfig();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            available_phone_numbers: [{ phone_number: '+13105559876' }],
          }),
          text: async () => '',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ phone_number: '+13105559876', sid: 'SW-SID-002' }),
          text: async () => '',
        });

      await provisionPhoneNumber({}, makeL3Claims());

      const { openDb } = await import('../spend-tracker.js');
      const db = openDb();
      const row = db.prepare('SELECT * FROM phone_numbers WHERE number = ?').get('+13105559876') as
        { provider: string } | undefined;
      expect(row?.provider).toBe('signalwire');
    });
  });

  // -------------------------------------------------------------------------
  // 4. sendSms — trust gating
  // -------------------------------------------------------------------------

  describe('sendSms trust gating', () => {
    it('L2 fails with TrustError', async () => {
      setTwilioConfig();
      await expect(
        sendSms({ from_number: '+12025551234', to: '+13105559876', message: 'hi' }, makeL2Claims()),
      ).rejects.toThrow(TrustError);
    });

    it('L3 succeeds', async () => {
      setTwilioConfig();
      mockTwilioMessagesCreate.mockResolvedValue({ sid: 'SM-send-001' });

      const result = await sendSms(
        { from_number: '+12025551234', to: '+13105559876', message: 'Hello' },
        makeL3Claims(),
      );
      expect(result.sid).toBe('SM-send-001');
    });
  });

  // -------------------------------------------------------------------------
  // 5. readSms — L2 succeeds, upserts to DB
  // -------------------------------------------------------------------------

  describe('readSms', () => {
    it('L2 succeeds', async () => {
      setTwilioConfig();
      mockTwilioMessagesList.mockResolvedValue([]);
      await expect(readSms({ number: '+12025551234' }, makeL2Claims())).resolves.toBeDefined();
    });

    it('upserts messages to sms_inbox DB table', async () => {
      setTwilioConfig();
      const fakeMsgs = [
        {
          sid: 'SM-001',
          from: '+19995551234',
          to: '+12025551234',
          body: 'Test message',
          direction: 'inbound',
          status: 'received',
          dateSent: new Date('2026-05-26T10:00:00Z'),
        },
      ];
      mockTwilioMessagesList.mockResolvedValue(fakeMsgs);

      const result = await readSms({ number: '+12025551234', limit: 5 }, makeL2Claims());

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].sid).toBe('SM-001');

      const { openDb } = await import('../spend-tracker.js');
      const db = openDb();
      const row = db.prepare('SELECT * FROM sms_inbox WHERE sid = ?').get('SM-001') as
        | { body: string; from_number: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.body).toBe('Test message');
      expect(row?.from_number).toBe('+19995551234');
    });

    it('does not duplicate messages on second fetch (INSERT OR IGNORE)', async () => {
      setTwilioConfig();
      const fakeMsgs = [
        {
          sid: 'SM-DUP-001',
          from: '+19995551234',
          to: '+12025551234',
          body: 'Duplicate test',
          direction: 'inbound',
          status: 'received',
          dateSent: new Date('2026-05-26T11:00:00Z'),
        },
      ];
      mockTwilioMessagesList.mockResolvedValue(fakeMsgs);

      await readSms({ number: '+12025551234' }, makeL2Claims());
      await readSms({ number: '+12025551234' }, makeL2Claims()); // second call

      const { openDb } = await import('../spend-tracker.js');
      const db = openDb();
      const rows = db.prepare('SELECT * FROM sms_inbox WHERE sid = ?').all('SM-DUP-001') as unknown[];
      expect(rows).toHaveLength(1); // still only one row
    });
  });

  // -------------------------------------------------------------------------
  // 6. releasePhoneNumber — releases and updates DB
  // -------------------------------------------------------------------------

  describe('releasePhoneNumber', () => {
    it('releases number and updates released_at in DB', async () => {
      setTwilioConfig();
      // First provision a number so there's a DB row
      mockTwilioAvailableList.mockResolvedValue([{ phoneNumber: '+12025550001' }]);
      mockTwilioIncomingCreate.mockResolvedValue({ phoneNumber: '+12025550001', sid: 'PN-RELEASE' });
      await provisionPhoneNumber({}, makeL3Claims());

      mockTwilioIncomingRemove.mockResolvedValue(undefined);

      const result = await releasePhoneNumber({ number: '+12025550001' }, makeL3Claims());

      expect(result.released).toBe(true);
      const { openDb } = await import('../spend-tracker.js');
      const db = openDb();
      const row = db.prepare('SELECT released_at FROM phone_numbers WHERE number = ?').get(
        '+12025550001',
      ) as { released_at: string | null } | undefined;
      expect(row?.released_at).not.toBeNull();
    });

    it('throws if number is not in DB', async () => {
      setTwilioConfig();
      await expect(
        releasePhoneNumber({ number: '+10000000000' }, makeL3Claims()),
      ).rejects.toThrow(/not found/);
    });

    it('requires L3 — L2 throws TrustError', async () => {
      setTwilioConfig();
      await expect(
        releasePhoneNumber({ number: '+12025550001' }, makeL2Claims()),
      ).rejects.toThrow(TrustError);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Missing credentials throws SecretsError
  // -------------------------------------------------------------------------

  describe('missing credentials', () => {
    it('Twilio: missing TWILIO_ACCOUNT_SID throws SecretsError', async () => {
      setTwilioConfig();
      delete process.env.TWILIO_ACCOUNT_SID;
      await expect(provisionPhoneNumber({}, makeL3Claims())).rejects.toThrow(SecretsError);
    });

    it('Twilio: missing TWILIO_AUTH_TOKEN throws SecretsError', async () => {
      setTwilioConfig();
      delete process.env.TWILIO_AUTH_TOKEN;
      await expect(provisionPhoneNumber({}, makeL3Claims())).rejects.toThrow(SecretsError);
    });

    it('SignalWire: missing SIGNALWIRE_PROJECT_ID throws SecretsError', async () => {
      setSignalWireConfig();
      // no SignalWire env vars set
      await expect(provisionPhoneNumber({}, makeL3Claims())).rejects.toThrow(SecretsError);
    });

    it('SignalWire: missing SIGNALWIRE_SPACE_URL throws SecretsError', async () => {
      setSignalWireConfig();
      process.env.SIGNALWIRE_PROJECT_ID = 'sw-project';
      process.env.SIGNALWIRE_AUTH_TOKEN = 'sw-token';
      // SIGNALWIRE_SPACE_URL not set
      await expect(provisionPhoneNumber({}, makeL3Claims())).rejects.toThrow(SecretsError);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Unconfigured provider throws SecretsError
  // -------------------------------------------------------------------------

  describe('unconfigured provider', () => {
    it('throws SecretsError when phone capability is not in config', async () => {
      setNoPhoneConfig();
      await expect(provisionPhoneNumber({}, makeL3Claims())).rejects.toThrow(SecretsError);
    });

    it('SecretsError message mentions init command', async () => {
      setNoPhoneConfig();
      await expect(provisionPhoneNumber({}, makeL3Claims())).rejects.toThrow(/hands-body-and-feet init/);
    });
  });
});
