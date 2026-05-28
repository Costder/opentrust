import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TrustError, DisputedError } from '../trust.js';
import { SecretsError } from '../secrets.js';
import type { PassportClaims } from '../types.js';

// ---------------------------------------------------------------------------
// Mocks — all hoisted before imports
// ---------------------------------------------------------------------------

// Mock MoonClient
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock('../capabilities/cards/moon-client.js', () => ({
  MoonClient: vi.fn().mockImplementation(() => ({
    get: mockGet,
    post: mockPost,
    patch: mockPatch,
    delete: mockDelete,
  })),
}));

// Mock config to control sandbox flag
vi.mock('../config.js', () => ({
  readConfig: vi.fn().mockReturnValue({
    version: 1,
    instanceId: 'test-instance',
    registryUrl: 'http://localhost:8000',
    passphraseHash: 'hash',
    capabilities: {
      cards: { sandbox: true },
    },
  }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  createVirtualCard,
  getCardDetails,
  addFundsToCard,
  topUpMoonCredit,
  freezeCard,
  deleteCard,
  getCardTransactions,
} from '../capabilities/cards/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeL4Claims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return {
    passportId: 'test-passport',
    agentId: 'test-agent',
    trustLevel: 4,
    trustStatus: 'community_reviewed',
    flags: [],
    isDisputed: false,
    version: '1',
    ...overrides,
  };
}

function makeL3Claims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return { ...makeL4Claims(), trustLevel: 3, trustStatus: 'seller_confirmed', ...overrides };
}

function makeL2Claims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return { ...makeL4Claims(), trustLevel: 2, trustStatus: 'creator_claimed', ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cards capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: credentials present
    process.env.MOON_CONSUMER_KEY = 'test-key';
    process.env.MOON_CONSUMER_SECRET = 'test-secret';
    delete process.env.MOON_API_ENV;
  });

  // -------------------------------------------------------------------------
  // Missing credentials
  // -------------------------------------------------------------------------

  describe('getMoonClient', () => {
    it('throws SecretsError when MOON_CONSUMER_KEY is missing', async () => {
      delete process.env.MOON_CONSUMER_KEY;
      await expect(createVirtualCard({}, makeL4Claims())).rejects.toThrow(SecretsError);
    });

    it('throws SecretsError when MOON_CONSUMER_SECRET is missing', async () => {
      delete process.env.MOON_CONSUMER_SECRET;
      await expect(createVirtualCard({}, makeL4Claims())).rejects.toThrow(SecretsError);
    });

    it('throws SecretsError with descriptive message', async () => {
      delete process.env.MOON_CONSUMER_KEY;
      await expect(createVirtualCard({}, makeL4Claims())).rejects.toThrow(
        /MOON_CONSUMER_KEY.*MOON_CONSUMER_SECRET/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // create_virtual_card
  // -------------------------------------------------------------------------

  describe('createVirtualCard', () => {
    it('requires L4 — rejects L3', async () => {
      await expect(createVirtualCard({}, makeL3Claims())).rejects.toThrow(TrustError);
    });

    it('rejects disputed passport', async () => {
      await expect(createVirtualCard({}, makeL4Claims({ isDisputed: true }))).rejects.toThrow(DisputedError);
    });

    it('calls POST /cards with default product moon_x', async () => {
      mockPost.mockResolvedValue({ id: 'card-123', product: 'moon_x' });
      const result = await createVirtualCard({}, makeL4Claims());
      expect(mockPost).toHaveBeenCalledWith('/cards', { product: 'moon_x' });
      expect(result.cardId).toBe('card-123');
      expect(result.product).toBe('moon_x');
    });

    it('uses provided label, falls back to card id', async () => {
      mockPost.mockResolvedValue({ id: 'card-456', product: 'moon_1x' });
      const withLabel = await createVirtualCard({ label: 'my-card', product: 'moon_1x' }, makeL4Claims());
      expect(withLabel.label).toBe('my-card');

      mockPost.mockResolvedValue({ id: 'card-789', product: 'moon_x' });
      const withoutLabel = await createVirtualCard({}, makeL4Claims());
      expect(withoutLabel.label).toBe('card-789');
    });

    it('includes amount in POST body when provided', async () => {
      mockPost.mockResolvedValue({ id: 'c1', product: 'moon_x' });
      await createVirtualCard({ amount: 50 }, makeL4Claims());
      expect(mockPost).toHaveBeenCalledWith('/cards', { product: 'moon_x', amount: 50 });
    });

    it('omits amount from POST body when not provided', async () => {
      mockPost.mockResolvedValue({ id: 'c2', product: 'moon_x' });
      await createVirtualCard({}, makeL4Claims());
      expect(mockPost).toHaveBeenCalledWith('/cards', { product: 'moon_x' });
    });
  });

  // -------------------------------------------------------------------------
  // get_card_details
  // -------------------------------------------------------------------------

  describe('getCardDetails', () => {
    it('requires L3 — rejects L2', async () => {
      await expect(getCardDetails({ label: 'card-1' }, makeL2Claims())).rejects.toThrow(TrustError);
    });

    it('calls GET /cards/{label} and returns card details', async () => {
      mockGet.mockResolvedValue({
        id: 'card-1',
        number: '4111111111111111',
        cvv: '123',
        expiry: '12/27',
      });
      const result = await getCardDetails({ label: 'card-1' }, makeL3Claims());
      expect(mockGet).toHaveBeenCalledWith('/cards/card-1');
      expect(result).toEqual({
        cardId: 'card-1',
        number: '4111111111111111',
        cvv: '123',
        expiry: '12/27',
      });
    });
  });

  // -------------------------------------------------------------------------
  // add_funds_to_card
  // -------------------------------------------------------------------------

  describe('addFundsToCard', () => {
    it('requires L4 — rejects L3', async () => {
      await expect(addFundsToCard({ label: 'card-1', amount: 20 }, makeL3Claims())).rejects.toThrow(TrustError);
    });

    it('calls POST /cards/{label}/fund with amount and returns result', async () => {
      mockPost.mockResolvedValue({ success: true, balance: 120 });
      const result = await addFundsToCard({ label: 'card-1', amount: 20 }, makeL4Claims());
      expect(mockPost).toHaveBeenCalledWith('/cards/card-1/fund', { amount: 20 });
      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(120);
    });
  });

  // -------------------------------------------------------------------------
  // top_up_moon_credit
  // -------------------------------------------------------------------------

  describe('topUpMoonCredit', () => {
    it('requires L4 — rejects L3', async () => {
      await expect(topUpMoonCredit({ amount: 100 }, makeL3Claims())).rejects.toThrow(TrustError);
    });

    it('calls GET /balance/deposit-address and returns deposit info', async () => {
      mockGet.mockResolvedValue({ address: '0xDepositAddr', chain: 'polygon' });
      const result = await topUpMoonCredit({ amount: 50 }, makeL4Claims());
      expect(mockGet).toHaveBeenCalledWith('/balance/deposit-address');
      expect(result.depositAddress).toBe('0xDepositAddr');
      expect(result.amountUsdc).toBe(50);
    });

    it('returns instructional note about send_usdc with polygon chain', async () => {
      mockGet.mockResolvedValue({ address: '0xAddr', chain: 'polygon' });
      const result = await topUpMoonCredit({ amount: 100 }, makeL4Claims());
      expect(result.note).toContain('send_usdc');
      expect(result.note).toContain('polygon');
    });
  });

  // -------------------------------------------------------------------------
  // freeze_card
  // -------------------------------------------------------------------------

  describe('freezeCard', () => {
    it('requires L3 — rejects L2', async () => {
      await expect(freezeCard({ label: 'card-1' }, makeL2Claims())).rejects.toThrow(TrustError);
    });

    it('calls PATCH /cards/{label} with status: frozen', async () => {
      mockPatch.mockResolvedValue({});
      const result = await freezeCard({ label: 'card-abc' }, makeL3Claims());
      expect(mockPatch).toHaveBeenCalledWith('/cards/card-abc', { status: 'frozen' });
      expect(result.frozen).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // delete_card
  // -------------------------------------------------------------------------

  describe('deleteCard', () => {
    it('requires L3 — rejects L2', async () => {
      await expect(deleteCard({ label: 'card-1' }, makeL2Claims())).rejects.toThrow(TrustError);
    });

    it('calls DELETE /cards/{label} and returns deleted: true', async () => {
      mockDelete.mockResolvedValue({});
      const result = await deleteCard({ label: 'card-abc' }, makeL3Claims());
      expect(mockDelete).toHaveBeenCalledWith('/cards/card-abc');
      expect(result.deleted).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // get_card_transactions
  // -------------------------------------------------------------------------

  describe('getCardTransactions', () => {
    it('requires L3 — rejects L2', async () => {
      await expect(getCardTransactions({ label: 'card-1' }, makeL2Claims())).rejects.toThrow(TrustError);
    });

    it('calls GET /cards/{label}/transactions with default limit 10', async () => {
      mockGet.mockResolvedValue({ transactions: [{ id: 'tx1' }] });
      const result = await getCardTransactions({ label: 'card-1' }, makeL3Claims());
      expect(mockGet).toHaveBeenCalledWith('/cards/card-1/transactions?limit=10');
      expect(result.transactions).toHaveLength(1);
    });

    it('uses provided limit', async () => {
      mockGet.mockResolvedValue({ transactions: [] });
      await getCardTransactions({ label: 'card-1', limit: 25 }, makeL3Claims());
      expect(mockGet).toHaveBeenCalledWith('/cards/card-1/transactions?limit=25');
    });

    it('returns the transactions array from the API response', async () => {
      const txs = [{ id: 'tx1', amount: 10 }, { id: 'tx2', amount: 5 }];
      mockGet.mockResolvedValue({ transactions: txs });
      const result = await getCardTransactions({ label: 'card-2' }, makeL3Claims());
      expect(result.transactions).toEqual(txs);
    });
  });

  // -------------------------------------------------------------------------
  // Disputed passport across all tools
  // -------------------------------------------------------------------------

  describe('disputed passport', () => {
    const disputed = makeL4Claims({ isDisputed: true });

    it('createVirtualCard throws DisputedError', async () => {
      await expect(createVirtualCard({}, disputed)).rejects.toThrow(DisputedError);
    });
    it('getCardDetails throws DisputedError', async () => {
      await expect(getCardDetails({ label: 'x' }, disputed)).rejects.toThrow(DisputedError);
    });
    it('freezeCard throws DisputedError', async () => {
      await expect(freezeCard({ label: 'x' }, disputed)).rejects.toThrow(DisputedError);
    });
    it('deleteCard throws DisputedError', async () => {
      await expect(deleteCard({ label: 'x' }, disputed)).rejects.toThrow(DisputedError);
    });
  });
});
