import { ethers } from 'ethers';
import { enforceTrust } from '../../trust.js';
import { sendUsdc } from '../wallet/index.js';
import type { PassportClaims } from '../../types.js';

export const PAYMENT_TOOLS = {
  pay_with_usdc: {
    name: 'pay_with_usdc',
    minTrustLevel: 4 as const,
    spendPolicy: { maxPerCallUsdc: 1000, dailyCapUsdc: 10000 },
  },
  get_payment_status: { name: 'get_payment_status', minTrustLevel: 2 as const },
} as const;

const BASE_RPC = process.env.BASE_RPC_URL ?? 'https://mainnet.base.org';

export async function payWithUsdc(
  params: { from_label: string; to_address: string; amount: number; memo?: string },
  claims: PassportClaims,
): Promise<{ txHash: string; amount: number; chain: 'base'; memo?: string }> {
  // Pay on Base only (spec: OpenTrust payments always on Base)
  enforceTrust(claims, PAYMENT_TOOLS.pay_with_usdc);
  const result = await sendUsdc(
    { from_label: params.from_label, to_address: params.to_address, amount: params.amount, chain: 'base' },
    claims,
  );
  return { txHash: result.txHash, amount: result.amount, chain: 'base', memo: params.memo };
}

export async function getPaymentStatus(
  params: { tx_hash: string },
  claims: PassportClaims,
): Promise<{ status: 'pending' | 'confirmed' | 'failed'; confirmations: number }> {
  enforceTrust(claims, PAYMENT_TOOLS.get_payment_status);
  const provider = new ethers.JsonRpcProvider(BASE_RPC);
  const receipt = await provider.getTransactionReceipt(params.tx_hash);
  if (!receipt) return { status: 'pending', confirmations: 0 };
  const block = await provider.getBlockNumber();
  const confirmations = block - receipt.blockNumber;
  return {
    status: receipt.status === 1 ? 'confirmed' : 'failed',
    confirmations,
  };
}
