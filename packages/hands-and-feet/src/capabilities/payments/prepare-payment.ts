import type { PassportClaims } from '../../types.js';
import { getBalance } from '../wallet/index.js';
import { bridgeToBase, getBridgeStatus } from '../bridge/index.js';
import { payWithUsdc } from './index.js';

export interface PreparePaymentParams {
  from_label: string;
  to_address: string;
  amount_usdc: number;
  memo?: string;
  /** default true — bridge from Polygon if balance insufficient */
  bridge_if_needed?: boolean;
  /** default 120_000 (2 min) */
  bridge_timeout_ms?: number;
  /** default 5_000 */
  bridge_poll_interval_ms?: number;
}

export interface PreparePaymentReceipt {
  status: 'success' | 'failed';
  txHash?: string;
  amountSent?: number;
  chain?: string;
  bridged?: boolean;
  bridge_id?: string;
  error?: string;
}

export async function preparePayment(
  params: PreparePaymentParams,
  claims: PassportClaims,
): Promise<PreparePaymentReceipt> {
  const bridgeIfNeeded = params.bridge_if_needed !== false;
  const bridgeTimeoutMs = params.bridge_timeout_ms ?? 120_000;
  const bridgePollIntervalMs = params.bridge_poll_interval_ms ?? 5_000;

  // Step 1: Check balance on Base
  const balanceResult = await getBalance(
    { label: params.from_label, chain: 'base' },
    claims,
  );
  const currentBalance = parseFloat(balanceResult.usdc);

  let bridged = false;
  let bridge_id: string | undefined;

  // Step 2: Bridge if needed
  if (currentBalance < params.amount_usdc) {
    if (!bridgeIfNeeded) {
      return {
        status: 'failed',
        error: 'insufficient balance and bridge disabled',
      };
    }

    const bridgeResult = await bridgeToBase(
      { from_label: params.from_label, amount: params.amount_usdc },
      claims,
    );
    bridge_id = bridgeResult.bridge_id;

    // Poll until minted, failed, stuck, or timeout
    const startTime = Date.now();
    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= bridgeTimeoutMs) {
        return { status: 'failed', error: 'bridge timeout', bridge_id };
      }

      await new Promise<void>((r) => setTimeout(r, bridgePollIntervalMs));

      const statusResult = await getBridgeStatus({ bridge_id }, claims);
      if (statusResult.status === 'minted') {
        bridged = true;
        break;
      }
      if (statusResult.status === 'failed' || statusResult.status === 'stuck') {
        return {
          status: 'failed',
          error: `bridge failed: ${statusResult.status}`,
          bridge_id,
        };
      }
      // pending | locked | in-flight — keep polling
    }
  }

  // Step 3: Pay with USDC on Base
  const payResult = await payWithUsdc(
    {
      from_label: params.from_label,
      to_address: params.to_address,
      amount: params.amount_usdc,
      memo: params.memo,
    },
    claims,
  );

  return {
    status: 'success',
    txHash: payResult.txHash,
    amountSent: payResult.amount,
    chain: payResult.chain,
    bridged,
    bridge_id,
  };
}
