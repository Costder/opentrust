import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { PassportClaims } from '../types.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../trust.js', () => ({
  enforceTrust: vi.fn(),
}));

vi.mock('../capabilities/wallet/index.js', () => ({
  getBalance: vi.fn(),
}));

vi.mock('../capabilities/bridge/index.js', () => ({
  bridgeToBase: vi.fn(),
  getBridgeStatus: vi.fn(),
}));

vi.mock('../capabilities/payments/index.js', () => ({
  payWithUsdc: vi.fn(),
}));

import { preparePayment } from '../capabilities/payments/prepare-payment.js';
import { getBalance } from '../capabilities/wallet/index.js';
import { bridgeToBase, getBridgeStatus } from '../capabilities/bridge/index.js';
import { payWithUsdc } from '../capabilities/payments/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SYSTEM_CLAIMS: PassportClaims = {
  passportId: 'test-passport',
  agentId: 'test-agent',
  trustLevel: 7,
  trustStatus: 'continuously_monitored',
  flags: [],
  isDisputed: false,
  version: '0.2.0',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('preparePayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Case 1: sufficient balance → direct pay → success
  // -------------------------------------------------------------------------

  it('pays directly when balance is sufficient', async () => {
    vi.mocked(getBalance).mockResolvedValue({ native: '0.1', usdc: '100', chain: 'base' });
    vi.mocked(payWithUsdc).mockResolvedValue({ txHash: '0xdirect', amount: 25, chain: 'base' });

    const receipt = await preparePayment(
      { from_label: 'my-wallet', to_address: '0xrecipient', amount_usdc: 25 },
      SYSTEM_CLAIMS,
    );

    expect(receipt.status).toBe('success');
    expect(receipt.txHash).toBe('0xdirect');
    expect(receipt.amountSent).toBe(25);
    expect(receipt.bridged).toBe(false);
    expect(receipt.bridge_id).toBeUndefined();
    expect(vi.mocked(bridgeToBase)).not.toHaveBeenCalled();
    expect(vi.mocked(payWithUsdc)).toHaveBeenCalledWith(
      expect.objectContaining({ from_label: 'my-wallet', to_address: '0xrecipient', amount: 25 }),
      SYSTEM_CLAIMS,
    );
  });

  // -------------------------------------------------------------------------
  // Case 2: insufficient balance + bridge enabled → bridge + poll → success
  // -------------------------------------------------------------------------

  it('bridges and polls until minted, then pays', async () => {
    vi.mocked(getBalance).mockResolvedValue({ native: '0', usdc: '0', chain: 'base' });
    vi.mocked(bridgeToBase).mockResolvedValue({
      bridge_id: 'bridge-123',
      status: 'locked',
      note: '',
    });
    vi.mocked(getBridgeStatus)
      .mockResolvedValueOnce({
        bridge_id: 'bridge-123',
        status: 'in-flight',
        direction: 'polygon_to_base',
        amount_usdc: 25,
      })
      .mockResolvedValueOnce({
        bridge_id: 'bridge-123',
        status: 'minted',
        direction: 'polygon_to_base',
        amount_usdc: 25,
      });
    vi.mocked(payWithUsdc).mockResolvedValue({ txHash: '0xabc', amount: 25, chain: 'base' });

    const receipt = await preparePayment(
      {
        from_label: 'my-wallet',
        to_address: '0xrecipient',
        amount_usdc: 25,
        bridge_poll_interval_ms: 1,
        bridge_timeout_ms: 10_000,
      },
      SYSTEM_CLAIMS,
    );

    expect(receipt.status).toBe('success');
    expect(receipt.txHash).toBe('0xabc');
    expect(receipt.bridged).toBe(true);
    expect(receipt.bridge_id).toBe('bridge-123');
    expect(vi.mocked(getBridgeStatus)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(payWithUsdc)).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Case 3: insufficient balance + bridge disabled → failed
  // -------------------------------------------------------------------------

  it('returns failed when balance is insufficient and bridge is disabled', async () => {
    vi.mocked(getBalance).mockResolvedValue({ native: '0', usdc: '0', chain: 'base' });

    const receipt = await preparePayment(
      {
        from_label: 'my-wallet',
        to_address: '0xrecipient',
        amount_usdc: 25,
        bridge_if_needed: false,
      },
      SYSTEM_CLAIMS,
    );

    expect(receipt.status).toBe('failed');
    expect(receipt.error).toContain('insufficient');
    expect(vi.mocked(bridgeToBase)).not.toHaveBeenCalled();
    expect(vi.mocked(payWithUsdc)).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Case 4: bridge fails (stuck) → failed
  // -------------------------------------------------------------------------

  it('returns failed when bridge status is stuck', async () => {
    vi.mocked(getBalance).mockResolvedValue({ native: '0', usdc: '0', chain: 'base' });
    vi.mocked(bridgeToBase).mockResolvedValue({
      bridge_id: 'bridge-stuck',
      status: 'pending',
      note: '',
    });
    vi.mocked(getBridgeStatus).mockResolvedValue({
      bridge_id: 'bridge-stuck',
      status: 'stuck',
      direction: 'polygon_to_base',
      amount_usdc: 50,
    });

    const receipt = await preparePayment(
      {
        from_label: 'my-wallet',
        to_address: '0xrecipient',
        amount_usdc: 50,
        bridge_poll_interval_ms: 1,
        bridge_timeout_ms: 10_000,
      },
      SYSTEM_CLAIMS,
    );

    expect(receipt.status).toBe('failed');
    expect(receipt.error).toContain('bridge failed');
    expect(receipt.bridge_id).toBe('bridge-stuck');
    expect(vi.mocked(payWithUsdc)).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Case 5: bridge timeout → failed
  // -------------------------------------------------------------------------

  it('returns failed on bridge timeout when status never becomes minted', async () => {
    vi.mocked(getBalance).mockResolvedValue({ native: '0', usdc: '0', chain: 'base' });
    vi.mocked(bridgeToBase).mockResolvedValue({
      bridge_id: 'bridge-slow',
      status: 'pending',
      note: '',
    });
    vi.mocked(getBridgeStatus).mockResolvedValue({
      bridge_id: 'bridge-slow',
      status: 'in-flight',
      direction: 'polygon_to_base',
      amount_usdc: 10,
    });

    const receipt = await preparePayment(
      {
        from_label: 'my-wallet',
        to_address: '0xrecipient',
        amount_usdc: 10,
        bridge_timeout_ms: 100,
        bridge_poll_interval_ms: 10,
      },
      SYSTEM_CLAIMS,
    );

    expect(receipt.status).toBe('failed');
    expect(receipt.error).toContain('timeout');
    expect(vi.mocked(payWithUsdc)).not.toHaveBeenCalled();
  });
});
