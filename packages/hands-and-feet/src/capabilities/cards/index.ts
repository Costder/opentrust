import { MoonClient } from './moon-client.js';
import { enforceTrust } from '../../trust.js';
import type { PassportClaims } from '../../types.js';
import { readConfig } from '../../config.js';
import { SecretsError } from '../../secrets.js';

function getMoonClient(): MoonClient {
  const consumerKey = process.env.MOON_CONSUMER_KEY;
  const consumerSecret = process.env.MOON_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) {
    throw new SecretsError(
      'Moon credentials not set. Set MOON_CONSUMER_KEY and MOON_CONSUMER_SECRET env vars.',
    );
  }
  const cfg = readConfig();
  const sandbox = process.env.MOON_API_ENV === 'sandbox' ||
    cfg.capabilities.cards?.sandbox === true;
  return new MoonClient({ consumerKey, consumerSecret, sandbox });
}

export const CARD_TOOLS = {
  create_virtual_card: { name: 'create_virtual_card', minTrustLevel: 4 as const },
  get_card_details: { name: 'get_card_details', minTrustLevel: 3 as const },
  add_funds_to_card: { name: 'add_funds_to_card', minTrustLevel: 4 as const },
  top_up_moon_credit: { name: 'top_up_moon_credit', minTrustLevel: 4 as const },
  freeze_card: { name: 'freeze_card', minTrustLevel: 3 as const },
  delete_card: { name: 'delete_card', minTrustLevel: 3 as const },
  get_card_transactions: { name: 'get_card_transactions', minTrustLevel: 3 as const },
} as const;

export async function createVirtualCard(
  params: { label?: string; product?: 'moon_x' | 'moon_1x'; amount?: number },
  claims: PassportClaims,
): Promise<{ cardId: string; label: string; product: string }> {
  enforceTrust(claims, CARD_TOOLS.create_virtual_card);
  const client = getMoonClient();
  const card = await client.post<{ id: string; product: string }>('/cards', {
    product: params.product ?? 'moon_x',
    ...(params.amount != null && { amount: params.amount }),
  });
  return { cardId: card.id, label: params.label ?? card.id, product: card.product };
}

export async function getCardDetails(
  params: { label: string },
  claims: PassportClaims,
): Promise<{ cardId: string; number: string; cvv: string; expiry: string }> {
  enforceTrust(claims, CARD_TOOLS.get_card_details);
  const client = getMoonClient();
  const card = await client.get<{ id: string; number: string; cvv: string; expiry: string }>(`/cards/${params.label}`);
  return { cardId: card.id, number: card.number, cvv: card.cvv, expiry: card.expiry };
}

export async function addFundsToCard(
  params: { label: string; amount: number },
  claims: PassportClaims,
): Promise<{ success: boolean; newBalance: number }> {
  enforceTrust(claims, CARD_TOOLS.add_funds_to_card);
  const client = getMoonClient();
  const result = await client.post<{ success: boolean; balance: number }>(`/cards/${params.label}/fund`, { amount: params.amount });
  return { success: result.success, newBalance: result.balance };
}

export async function topUpMoonCredit(
  params: { amount: number },
  claims: PassportClaims,
): Promise<{ depositAddress: string; amountUsdc: number; note: string }> {
  enforceTrust(claims, CARD_TOOLS.top_up_moon_credit);
  const client = getMoonClient();
  const deposit = await client.get<{ address: string; chain: string }>('/balance/deposit-address');
  // Note: actual USDC-Polygon transfer is done via wallet capability (send_usdc with chain: 'polygon')
  // This returns the deposit address so the agent can call send_usdc separately
  return {
    depositAddress: deposit.address,
    amountUsdc: params.amount,
    note: 'Send USDC on Polygon to depositAddress using send_usdc with chain:"polygon". Then poll Moon Credit balance.',
  };
}

export async function freezeCard(
  params: { label: string },
  claims: PassportClaims,
): Promise<{ frozen: boolean }> {
  enforceTrust(claims, CARD_TOOLS.freeze_card);
  const client = getMoonClient();
  await client.patch(`/cards/${params.label}`, { status: 'frozen' });
  return { frozen: true };
}

export async function deleteCard(
  params: { label: string },
  claims: PassportClaims,
): Promise<{ deleted: boolean }> {
  enforceTrust(claims, CARD_TOOLS.delete_card);
  const client = getMoonClient();
  await client.delete(`/cards/${params.label}`);
  return { deleted: true };
}

export async function getCardTransactions(
  params: { label: string; limit?: number },
  claims: PassportClaims,
): Promise<{ transactions: unknown[] }> {
  enforceTrust(claims, CARD_TOOLS.get_card_transactions);
  const client = getMoonClient();
  const limit = params.limit ?? 10;
  const result = await client.get<{ transactions: unknown[] }>(`/cards/${params.label}/transactions?limit=${limit}`);
  return { transactions: result.transactions };
}
