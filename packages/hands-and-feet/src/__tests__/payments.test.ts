import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TrustError } from '../trust.js';
import type { PassportClaims } from '../types.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../capabilities/wallet/index.js', () => ({
  sendUsdc: vi.fn().mockResolvedValue({ txHash: '0xtxhash', amount: 10, chain: 'base' }),
  WALLET_TOOLS: {
    create_wallet: { name: 'create_wallet', minTrustLevel: 3 },
    get_address: { name: 'get_address', minTrustLevel: 2 },
    get_balance: { name: 'get_balance', minTrustLevel: 2 },
    send_usdc: { name: 'send_usdc', minTrustLevel: 4, spendPolicy: { maxPerCallUsdc: 1000, dailyCapUsdc: 10000 } },
    sign_message: { name: 'sign_message', minTrustLevel: 3 },
    sign_typed_data: { name: 'sign_typed_data', minTrustLevel: 4 },
  },
}));

vi.mock('ethers', () => {
  const mockReceipt = {
    status: 1,
    blockNumber: 100,
  };
  const mockProvider = {
    getTransactionReceipt: vi.fn().mockResolvedValue(mockReceipt),
    getBlockNumber: vi.fn().mockResolvedValue(106),
  };
  return {
    ethers: {
      JsonRpcProvider: vi.fn(() => mockProvider),
      __mockProvider: mockProvider,
    },
  };
});

import { payWithUsdc, getPaymentStatus } from '../capabilities/payments/index.js';
import { sendUsdc } from '../capabilities/wallet/index.js';
import { ethers } from 'ethers';

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

function makeL2Claims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return { ...makeL4Claims(), trustLevel: 2, trustStatus: 'creator_claimed', ...overrides };
}

describe('payments capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendUsdc).mockResolvedValue({ txHash: '0xtxhash', amount: 10, chain: 'base' });
  });

  // -------------------------------------------------------------------------
  // pay_with_usdc
  // -------------------------------------------------------------------------

  describe('payWithUsdc', () => {
    it('requires L4 trust — rejects L3', async () => {
      const l3 = { ...makeL4Claims(), trustLevel: 3 as const, trustStatus: 'seller_confirmed' as const };
      await expect(
        payWithUsdc({ from_label: 'x', to_address: '0x1', amount: 10 }, l3),
      ).rejects.toThrow(TrustError);
    });

    it('rejects disputed passport', async () => {
      await expect(
        payWithUsdc(
          { from_label: 'x', to_address: '0x1', amount: 10 },
          makeL4Claims({ isDisputed: true }),
        ),
      ).rejects.toThrow();
    });

    it('always calls sendUsdc with chain=base (enforces Base-only rule)', async () => {
      await payWithUsdc(
        { from_label: 'my-wallet', to_address: '0xabc', amount: 10 },
        makeL4Claims(),
      );
      expect(sendUsdc).toHaveBeenCalledWith(
        expect.objectContaining({ chain: 'base' }),
        expect.anything(),
      );
    });

    it('forwards memo to the result', async () => {
      const result = await payWithUsdc(
        { from_label: 'my-wallet', to_address: '0xabc', amount: 10, memo: 'invoice-123' },
        makeL4Claims(),
      );
      expect(result.memo).toBe('invoice-123');
    });

    it('returns txHash, amount, and chain: base', async () => {
      const result = await payWithUsdc(
        { from_label: 'my-wallet', to_address: '0xabc', amount: 10 },
        makeL4Claims(),
      );
      expect(result.txHash).toBe('0xtxhash');
      expect(result.amount).toBe(10);
      expect(result.chain).toBe('base');
    });

    it('propagates TrustError from sendUsdc (spend cap enforced by wallet layer)', async () => {
      vi.mocked(sendUsdc).mockRejectedValue(new TrustError('Daily cap exceeded'));
      await expect(
        payWithUsdc({ from_label: 'wallet', to_address: '0x1', amount: 50 }, makeL4Claims()),
      ).rejects.toThrow(TrustError);
    });
  });

  // -------------------------------------------------------------------------
  // get_payment_status
  // -------------------------------------------------------------------------

  describe('getPaymentStatus', () => {
    it('requires L2 trust — rejects L1', async () => {
      await expect(
        getPaymentStatus(
          { tx_hash: '0xtx' },
          makeL2Claims({ trustLevel: 1, trustStatus: 'auto_generated_draft' }),
        ),
      ).rejects.toThrow(TrustError);
    });

    it('returns confirmed status when receipt.status === 1', async () => {
      const result = await getPaymentStatus({ tx_hash: '0xtx' }, makeL2Claims());
      expect(result.status).toBe('confirmed');
      expect(result.confirmations).toBe(6); // 106 - 100
    });

    it('returns failed status when receipt.status === 0', async () => {
      const mockProvider = (ethers as unknown as { __mockProvider: { getTransactionReceipt: ReturnType<typeof vi.fn>; getBlockNumber: ReturnType<typeof vi.fn> } }).__mockProvider;
      mockProvider.getTransactionReceipt.mockResolvedValue({ status: 0, blockNumber: 100 });
      const result = await getPaymentStatus({ tx_hash: '0xtx' }, makeL2Claims());
      expect(result.status).toBe('failed');
    });

    it('returns pending when receipt is null', async () => {
      const mockProvider = (ethers as unknown as { __mockProvider: { getTransactionReceipt: ReturnType<typeof vi.fn>; getBlockNumber: ReturnType<typeof vi.fn> } }).__mockProvider;
      mockProvider.getTransactionReceipt.mockResolvedValue(null);
      const result = await getPaymentStatus({ tx_hash: '0xpending' }, makeL2Claims());
      expect(result.status).toBe('pending');
      expect(result.confirmations).toBe(0);
    });
  });
});
