import { ethers } from 'ethers';
import { enforceTrust } from '../../trust.js';
import { addWallet, getWallet } from '../../keystore.js';
import { logSpend, checkSpendAllowed } from '../../spend-tracker.js';
import { notifyHuman } from '../notify/index.js';
import type { PassportClaims } from '../../types.js';

// Passport for notifyHuman calls from wallet (system-level notification)
// Uses a synthetic L7 passport for internal calls
const SYSTEM_CLAIMS: PassportClaims = {
  passportId: 'system',
  agentId: 'hands-and-feet-system',
  trustLevel: 7,
  trustStatus: 'continuously_monitored',
  flags: [],
  isDisputed: false,
  version: '1',
};

const BASE_RPC = process.env.BASE_RPC_URL ?? 'https://mainnet.base.org';
const POLYGON_RPC = process.env.POLYGON_RPC_URL ?? 'https://polygon-rpc.com';

// USDC contract addresses
const USDC_ADDRESSES: Record<string, string> = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
};

// Minimal ERC-20 ABI
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

function getProvider(chain: 'base' | 'polygon'): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(chain === 'base' ? BASE_RPC : POLYGON_RPC);
}

function requirePassphrase(): string {
  const pp = process.env.HANDS_BODY_AND_FEET_PASSPHRASE;
  if (!pp) {
    throw new Error(
      'HANDS_BODY_AND_FEET_PASSPHRASE env var is required for wallet operations. ' +
      'Set it before running "hands-body-and-feet serve".',
    );
  }
  return pp;
}

// Tool definitions for trust enforcement
export const WALLET_TOOLS = {
  create_wallet: { name: 'create_wallet', minTrustLevel: 3 as const },
  get_address: { name: 'get_address', minTrustLevel: 2 as const },
  get_balance: { name: 'get_balance', minTrustLevel: 2 as const },
  send_usdc: {
    name: 'send_usdc',
    minTrustLevel: 4 as const,
    spendPolicy: { maxPerCallUsdc: 1000, dailyCapUsdc: 10000 },
  },
  sign_message: { name: 'sign_message', minTrustLevel: 3 as const },
  sign_typed_data: { name: 'sign_typed_data', minTrustLevel: 4 as const },
} as const;

export async function createWallet(
  params: { label?: string; chain?: 'base' | 'polygon' },
  claims: PassportClaims,
): Promise<{ address: string; label: string }> {
  enforceTrust(claims, WALLET_TOOLS.create_wallet);
  const passphrase = requirePassphrase();
  const label = params.label ?? `wallet-${Date.now()}`;
  const wallet = ethers.Wallet.createRandom();
  addWallet({
    label,
    privateKey: wallet.privateKey,
    chains: [params.chain ?? 'base'],
    gasReserveUsdc: 5,
    dailyCapUsdc: 100,
    maxPerCallUsdc: 50,
    createdAt: new Date().toISOString(),
  }, passphrase);
  return { address: wallet.address, label };
}

export async function getAddress(
  params: { label: string },
  claims: PassportClaims,
): Promise<{ address: string }> {
  enforceTrust(claims, WALLET_TOOLS.get_address);
  const passphrase = requirePassphrase();
  const entry = getWallet(params.label, passphrase);
  if (!entry) throw new Error(`Wallet "${params.label}" not found`);
  const wallet = new ethers.Wallet(entry.privateKey);
  return { address: wallet.address };
}

export async function getBalance(
  params: { label: string; token?: 'ETH' | 'MATIC' | 'USDC'; chain?: 'base' | 'polygon' },
  claims: PassportClaims,
): Promise<{ native: string; usdc: string; chain: string }> {
  enforceTrust(claims, WALLET_TOOLS.get_balance);
  const passphrase = requirePassphrase();
  const entry = getWallet(params.label, passphrase);
  if (!entry) throw new Error(`Wallet "${params.label}" not found`);
  const chain = params.chain ?? (entry.chains[0] ?? 'base');
  const provider = getProvider(chain as 'base' | 'polygon');
  const wallet = new ethers.Wallet(entry.privateKey, provider);
  const [native, usdcBalance] = await Promise.all([
    provider.getBalance(wallet.address),
    (async () => {
      const usdcAddress = USDC_ADDRESSES[chain];
      if (!usdcAddress) return '0';
      const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, provider);
      return (await usdc.balanceOf(wallet.address) as bigint).toString();
    })(),
  ]);
  return {
    native: ethers.formatEther(native),
    usdc: ethers.formatUnits(usdcBalance, 6),
    chain,
  };
}

export async function sendUsdc(
  params: { from_label: string; to_address: string; amount: number; chain?: 'base' | 'polygon' },
  claims: PassportClaims,
): Promise<{ txHash: string; amount: number; chain: string }> {
  enforceTrust(claims, WALLET_TOOLS.send_usdc);
  const passphrase = requirePassphrase();
  const entry = getWallet(params.from_label, passphrase);
  if (!entry) throw new Error(`Wallet "${params.from_label}" not found`);
  const chain = params.chain ?? 'base';
  checkSpendAllowed(params.from_label, entry, params.amount);

  const provider = getProvider(chain as 'base' | 'polygon');
  const wallet = new ethers.Wallet(entry.privateKey, provider);
  const usdcAddress = USDC_ADDRESSES[chain];
  const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, wallet);
  const amountWei = ethers.parseUnits(params.amount.toString(), 6);
  const tx = await usdc.transfer(params.to_address, amountWei) as ethers.ContractTransactionResponse;

  logSpend(params.from_label, chain, params.amount, 'send_usdc', tx.hash);
  return { txHash: tx.hash, amount: params.amount, chain };
}

export async function signMessage(
  params: { label: string; text: string },
  claims: PassportClaims,
): Promise<{ signature: string }> {
  enforceTrust(claims, WALLET_TOOLS.sign_message);
  const passphrase = requirePassphrase();
  const entry = getWallet(params.label, passphrase);
  if (!entry) throw new Error(`Wallet "${params.label}" not found`);
  const wallet = new ethers.Wallet(entry.privateKey);
  const signature = await wallet.signMessage(params.text);
  return { signature };
}

export async function signTypedData(
  params: { label: string; domain: Record<string, unknown>; types: Record<string, unknown>; value: Record<string, unknown> },
  claims: PassportClaims,
): Promise<{ signature: string }> {
  enforceTrust(claims, WALLET_TOOLS.sign_typed_data);
  // First-use: REJECT + notify_human (from spec: always reject first-use of any new domain/primaryType pair)
  // TODO: Implement per-passport allowlist in allowlist-add-typed-data CLI command (Plan A stub)
  // For now, always reject with instructions
  await notifyHuman({
    message: `sign_typed_data rejected: New EIP-712 domain ${JSON.stringify(params.domain)} with primaryType. Use CLI to allowlist: hands-body-and-feet allowlist-add-typed-data`,
    priority: 'urgent',
    title: 'EIP-712 First-Use Rejection',
  }, SYSTEM_CLAIMS).catch(() => undefined); // don't fail if notify is not configured

  throw new Error(
    'UNTRUSTED_TYPED_DATA: First-use of this EIP-712 domain/primaryType is rejected. ' +
    'Run: hands-body-and-feet allowlist-add-typed-data <passport-id> <domain-json> <primary-type>',
  );
}
