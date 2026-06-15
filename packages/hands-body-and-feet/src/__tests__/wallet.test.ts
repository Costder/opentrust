import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TrustError, DisputedError } from '../trust.js';
import type { PassportClaims } from '../types.js';
import type { WalletEntry } from '../keystore.js';

// ---------------------------------------------------------------------------
// Mocks — all hoisted
// ---------------------------------------------------------------------------

vi.mock('ethers', () => {
  const mockWallet = {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    signMessage: vi.fn().mockResolvedValue('0xsignature'),
  };

  const mockProvider = {
    getBalance: vi.fn().mockResolvedValue(BigInt('1000000000000000000')), // 1 ETH
  };

  const mockContract = {
    balanceOf: vi.fn().mockResolvedValue(BigInt('10000000')), // 10 USDC (6 decimals)
    transfer: vi.fn().mockResolvedValue({ hash: '0xtxhash' }),
  };

  return {
    ethers: {
      Wallet: {
        createRandom: vi.fn(() => mockWallet),
        // Also allow "new ethers.Wallet(key)" and "new ethers.Wallet(key, provider)"
      },
      JsonRpcProvider: vi.fn(function () {
        return mockProvider;
      }),
      Contract: vi.fn(function () {
        return mockContract;
      }),
      formatEther: vi.fn(() => '1.0'),
      formatUnits: vi.fn(() => '10.0'),
      parseUnits: vi.fn(() => BigInt('10000000')),
      // Allow wallet constructor as class
      __mockWallet: mockWallet,
      __mockProvider: mockProvider,
      __mockContract: mockContract,
    },
  };
});

vi.mock('../keystore.js', () => ({
  addWallet: vi.fn(),
  getWallet: vi.fn(),
  loadKeystore: vi.fn(),
}));

vi.mock('../spend-tracker.js', () => ({
  checkSpendAllowed: vi.fn(),
  logSpend: vi.fn(),
}));

vi.mock('../capabilities/notify/index.js', () => ({
  notifyHuman: vi.fn().mockResolvedValue({ sent: true, topic: 'test' }),
}));

// ---------------------------------------------------------------------------
// After mocks, patch ethers.Wallet constructor to return the mock wallet
// ---------------------------------------------------------------------------

import { ethers } from 'ethers';

// Patch the Wallet class so "new ethers.Wallet(key)" returns our mock
const mockWalletInstance = (ethers as unknown as { __mockWallet: { address: string; privateKey: string; signMessage: ReturnType<typeof vi.fn> } }).__mockWallet;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(ethers as unknown as any).Wallet = Object.assign(
  vi.fn(function () {
    return mockWalletInstance;
  }),
  { createRandom: vi.fn(() => mockWalletInstance) },
);

import {
  createWallet,
  getAddress,
  getBalance,
  sendUsdc,
  signMessage,
  signTypedData,
  walletList,
} from '../capabilities/wallet/index.js';
import { addWallet, getWallet, loadKeystore } from '../keystore.js';
import { checkSpendAllowed, logSpend } from '../spend-tracker.js';

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

function makeWalletEntry(overrides: Partial<WalletEntry> = {}): WalletEntry {
  return {
    label: 'test-wallet',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    chains: ['base'],
    gasReserveUsdc: 5,
    dailyCapUsdc: 100,
    maxPerCallUsdc: 50,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('wallet capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HANDS_BODY_AND_FEET_PASSPHRASE = 'test-passphrase';
  });

  // -------------------------------------------------------------------------
  // create_wallet
  // -------------------------------------------------------------------------

  describe('createWallet', () => {
    it('requires L3 trust — rejects L2 passport', async () => {
      await expect(createWallet({}, makeL2Claims())).rejects.toThrow(TrustError);
    });

    it('rejects disputed passport', async () => {
      await expect(createWallet({}, makeL4Claims({ isDisputed: true }))).rejects.toThrow(DisputedError);
    });

    it('creates a wallet and calls addWallet with the generated entry', async () => {
      vi.mocked(addWallet).mockImplementation(() => undefined);
      const result = await createWallet({ label: 'my-wallet', chain: 'base' }, makeL3Claims());
      expect(addWallet).toHaveBeenCalledOnce();
      const storedEntry = vi.mocked(addWallet).mock.calls[0][0] as WalletEntry;
      expect(storedEntry.label).toBe('my-wallet');
      expect(storedEntry.chains).toEqual(['base']);
      expect(result.label).toBe('my-wallet');
      expect(result.address).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    });

    it('auto-generates label when not provided', async () => {
      vi.mocked(addWallet).mockImplementation(() => undefined);
      const result = await createWallet({}, makeL3Claims());
      expect(result.label).toMatch(/^wallet-\d+$/);
    });

    it('throws if HANDS_BODY_AND_FEET_PASSPHRASE is not set', async () => {
      delete process.env.HANDS_BODY_AND_FEET_PASSPHRASE;
      await expect(createWallet({}, makeL3Claims())).rejects.toThrow(/HANDS_BODY_AND_FEET_PASSPHRASE/);
    });
  });

  // -------------------------------------------------------------------------
  // get_address
  // -------------------------------------------------------------------------

  describe('getAddress', () => {
    it('requires L2 trust — rejects L1', async () => {
      await expect(
        getAddress({ label: 'x' }, makeL2Claims({ trustLevel: 1, trustStatus: 'auto_generated_draft' })),
      ).rejects.toThrow(TrustError);
    });

    it('returns address for known wallet', async () => {
      vi.mocked(getWallet).mockReturnValue(makeWalletEntry());
      const result = await getAddress({ label: 'test-wallet' }, makeL2Claims());
      expect(result.address).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    });

    it('throws when wallet is not found', async () => {
      vi.mocked(getWallet).mockReturnValue(undefined);
      await expect(getAddress({ label: 'missing' }, makeL2Claims())).rejects.toThrow(
        'Wallet "missing" not found',
      );
    });
  });

  // -------------------------------------------------------------------------
  // wallet_list
  // -------------------------------------------------------------------------

  describe('walletList', () => {
    it('requires L2 trust - rejects L1', async () => {
      await expect(
        walletList({}, makeL2Claims({ trustLevel: 1, trustStatus: 'auto_generated_draft' })),
      ).rejects.toThrow(TrustError);
    });

    it('returns labels, addresses, and chains without private keys', async () => {
      vi.mocked(loadKeystore).mockReturnValue([
        makeWalletEntry({ label: 'primary', chains: ['base'] }),
        makeWalletEntry({ label: 'polygon-hot', chains: ['polygon'] }),
      ]);

      const result = await walletList({}, makeL2Claims());

      expect(result.wallets).toEqual([
        { label: 'primary', address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', chain: 'base' },
        { label: 'polygon-hot', address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', chain: 'polygon' },
      ]);
      expect(JSON.stringify(result)).not.toContain('privateKey');
      expect(JSON.stringify(result)).not.toContain('ac0974');
    });
  });

  // -------------------------------------------------------------------------
  // get_balance
  // -------------------------------------------------------------------------

  describe('getBalance', () => {
    it('requires L2 trust — rejects L1', async () => {
      await expect(
        getBalance({ label: 'x' }, makeL2Claims({ trustLevel: 1, trustStatus: 'auto_generated_draft' })),
      ).rejects.toThrow(TrustError);
    });

    it('returns native and usdc balances', async () => {
      vi.mocked(getWallet).mockReturnValue(makeWalletEntry());
      const result = await getBalance({ label: 'test-wallet' }, makeL2Claims());
      expect(result).toMatchObject({ native: '1.0', usdc: '10.0', chain: 'base' });
    });

    it('throws when wallet is not found', async () => {
      vi.mocked(getWallet).mockReturnValue(undefined);
      await expect(getBalance({ label: 'missing' }, makeL2Claims())).rejects.toThrow(
        'Wallet "missing" not found',
      );
    });
  });

  // -------------------------------------------------------------------------
  // send_usdc
  // -------------------------------------------------------------------------

  describe('sendUsdc', () => {
    it('requires L4 trust — rejects L3', async () => {
      await expect(
        sendUsdc({ from_label: 'x', to_address: '0x1', amount: 10 }, makeL3Claims()),
      ).rejects.toThrow(TrustError);
    });

    it('calls checkSpendAllowed before broadcasting', async () => {
      const callOrder: string[] = [];
      vi.mocked(getWallet).mockReturnValue(makeWalletEntry());
      vi.mocked(checkSpendAllowed).mockImplementation(() => { callOrder.push('check'); });
      vi.mocked(logSpend).mockImplementation(() => { callOrder.push('log'); });
      await sendUsdc({ from_label: 'test-wallet', to_address: '0x1', amount: 10 }, makeL4Claims());
      expect(callOrder).toEqual(['check', 'log']);
    });

    it('throws when checkSpendAllowed throws TrustError', async () => {
      vi.mocked(getWallet).mockReturnValue(makeWalletEntry());
      vi.mocked(checkSpendAllowed).mockImplementation(() => {
        throw new TrustError('Daily cap exceeded');
      });
      await expect(
        sendUsdc({ from_label: 'test-wallet', to_address: '0x1', amount: 10 }, makeL4Claims()),
      ).rejects.toThrow(TrustError);
      expect(logSpend).not.toHaveBeenCalled();
    });

    it('logs spend after successful transfer', async () => {
      vi.mocked(getWallet).mockReturnValue(makeWalletEntry());
      vi.mocked(checkSpendAllowed).mockImplementation(() => undefined);
      const result = await sendUsdc(
        { from_label: 'test-wallet', to_address: '0x1234', amount: 25, chain: 'base' },
        makeL4Claims(),
      );
      expect(logSpend).toHaveBeenCalledWith('test-wallet', 'base', 25, 'send_usdc', '0xtxhash');
      expect(result.txHash).toBe('0xtxhash');
      expect(result.amount).toBe(25);
      expect(result.chain).toBe('base');
    });

    it('throws when wallet is not found', async () => {
      vi.mocked(getWallet).mockReturnValue(undefined);
      await expect(
        sendUsdc({ from_label: 'missing', to_address: '0x1', amount: 10 }, makeL4Claims()),
      ).rejects.toThrow('Wallet "missing" not found');
    });
  });

  // -------------------------------------------------------------------------
  // sign_message
  // -------------------------------------------------------------------------

  describe('signMessage', () => {
    it('requires L3 trust — rejects L2', async () => {
      await expect(signMessage({ label: 'x', text: 'hello' }, makeL2Claims())).rejects.toThrow(TrustError);
    });

    it('returns signature for known wallet', async () => {
      vi.mocked(getWallet).mockReturnValue(makeWalletEntry());
      const result = await signMessage({ label: 'test-wallet', text: 'hello' }, makeL3Claims());
      expect(result.signature).toBe('0xsignature');
    });

    it('throws when wallet is not found', async () => {
      vi.mocked(getWallet).mockReturnValue(undefined);
      await expect(signMessage({ label: 'missing', text: 'hi' }, makeL3Claims())).rejects.toThrow(
        'Wallet "missing" not found',
      );
    });
  });

  // -------------------------------------------------------------------------
  // sign_typed_data — always rejected on first use
  // -------------------------------------------------------------------------

  describe('signTypedData', () => {
    it('requires L4 trust — rejects L3', async () => {
      await expect(
        signTypedData({ label: 'x', domain: {}, types: {}, value: {} }, makeL3Claims()),
      ).rejects.toThrow(TrustError);
    });

    it('always rejects with UNTRUSTED_TYPED_DATA on first use', async () => {
      vi.mocked(getWallet).mockReturnValue(makeWalletEntry());
      await expect(
        signTypedData(
          { label: 'test-wallet', domain: { name: 'Test' }, types: {}, value: {} },
          makeL4Claims(),
        ),
      ).rejects.toThrow('UNTRUSTED_TYPED_DATA');
    });

    it('fires notifyHuman when rejecting', async () => {
      const { notifyHuman } = await import('../capabilities/notify/index.js');
      vi.mocked(getWallet).mockReturnValue(makeWalletEntry());
      await expect(
        signTypedData(
          { label: 'test-wallet', domain: { name: 'MyDomain' }, types: {}, value: {} },
          makeL4Claims(),
        ),
      ).rejects.toThrow();
      expect(notifyHuman).toHaveBeenCalledOnce();
      const notifyArgs = vi.mocked(notifyHuman).mock.calls[0][0];
      expect(notifyArgs.priority).toBe('urgent');
    });
  });
});
