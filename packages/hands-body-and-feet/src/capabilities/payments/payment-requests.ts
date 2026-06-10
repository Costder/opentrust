/**
 * Payment-request (receive-only) capability.
 * Creates uniquified payment requests and polls Base for USDC Transfer events to confirm receipt.
 */
import { randomBytes } from 'crypto';
import { enforceTrust } from '../../trust.js';
import { openDb } from '../../spend-tracker.js';
import { getWallet } from '../../keystore.js';
import type { PassportClaims } from '../../types.js';

// ────────────────────────────────────────────────────────────
// Constants (reused from wallet)
// ────────────────────────────────────────────────────────────
const BASE_RPC = process.env.BASE_RPC_URL ?? 'https://mainnet.base.org';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_CHAIN_ID = 8453;

// ERC-20 Transfer event topic
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// ────────────────────────────────────────────────────────────
// Tool definitions
// ────────────────────────────────────────────────────────────
export const PAYMENT_REQUEST_TOOLS = {
  payment_request: { name: 'payment_request', minTrustLevel: 3 as const },
  payment_status: { name: 'payment_status', minTrustLevel: 2 as const },
  payment_list: { name: 'payment_list', minTrustLevel: 2 as const },
} as const;

// ────────────────────────────────────────────────────────────
// DB schema (additive — called from spend-tracker openDb migration section)
// ────────────────────────────────────────────────────────────
export function ensurePaymentRequestsSchema(): void {
  const db = openDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_requests (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      amount_usdc_requested REAL NOT NULL,
      amount_usdc_expected REAL NOT NULL,
      memo TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      chain TEXT NOT NULL DEFAULT 'base',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      paid_at TEXT,
      paid_tx_hash TEXT
    );
  `);

  // Ensure the 'payments' sentinel webhook row exists so FK on webhook_events is satisfied.
  // Uses INSERT OR IGNORE so it's safe to call multiple times.
  db.prepare(`
    INSERT OR IGNORE INTO webhooks (label, path, secret_token, max_payload_bytes, retention_days, created_at)
    VALUES ('payments', '/payments/internal', '', 0, 365, ?)
  `).run(new Date().toISOString());
}

// ────────────────────────────────────────────────────────────
// ID generation — 8-char base32 (a-z2-7)
// ────────────────────────────────────────────────────────────
const BASE32_CHARS = 'abcdefghijklmnopqrstuvwxyz234567';

function genId(): string {
  const bytes = randomBytes(5); // 5 bytes → 40 bits → 8 base32 chars
  let id = '';
  let bits = 0;
  let accum = 0;
  for (const byte of bytes) {
    accum = (accum << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      id += BASE32_CHARS[(accum >> bits) & 0x1f];
    }
  }
  return id.padEnd(8, BASE32_CHARS[0]);
}

// ────────────────────────────────────────────────────────────
// Amount uniquification
// ────────────────────────────────────────────────────────────
function getUniqueAmount(address: string, baseAmount: number): number {
  ensurePaymentRequestsSchema();
  const db = openDb();

  // Round base to 6dp (USDC precision)
  const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

  for (let attempt = 0; attempt < 100; attempt++) {
    const noise = 0.001 + Math.random() * 0.008; // 0.001–0.009
    const candidate = round6(baseAmount + noise);

    const conflict = db.prepare(
      `SELECT id FROM payment_requests WHERE address = ? AND amount_usdc_expected = ? AND status = 'pending'`,
    ).get(address, candidate);

    if (!conflict) return candidate;
  }

  // Fallback: increment by 0.001 from last attempt
  return round6(baseAmount + 0.009 + 0.001);
}

// ────────────────────────────────────────────────────────────
// Wallet label → address helper (mirrors wallet capability)
// ────────────────────────────────────────────────────────────
function resolveAddress(walletLabel: string | undefined): string {
  const passphrase = process.env.HANDS_BODY_AND_FEET_PASSPHRASE;
  if (!passphrase) {
    throw new Error(
      'HANDS_BODY_AND_FEET_PASSPHRASE env var is required. Set it before running "hands-body-and-feet serve".',
    );
  }

  const label = walletLabel ?? 'primary';
  const entry = getWallet(label, passphrase);
  if (!entry) throw new Error(`Wallet "${label}" not found`);

  // Derive address from private key (ethers not available in test env mock — use a simple checksum)
  // We import ethers lazily so that tests can mock it
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ethers } = require('ethers') as typeof import('ethers');
  const wallet = new ethers.Wallet(entry.privateKey);
  return wallet.address;
}

// ────────────────────────────────────────────────────────────
// EIP-681 URI builder
// ────────────────────────────────────────────────────────────
function buildEip681Uri(receivingAddress: string, amountUsdc: number): string {
  // uint256 value = amount * 1e6, must be integer
  const uint256 = BigInt(Math.round(amountUsdc * 1_000_000));
  return `ethereum:${USDC_BASE}@${BASE_CHAIN_ID}/transfer?address=${receivingAddress}&uint256=${uint256}`;
}

// ────────────────────────────────────────────────────────────
// RPC helpers
// ────────────────────────────────────────────────────────────
async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const resp = await fetch(BASE_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!resp.ok) throw new Error(`RPC HTTP error ${resp.status}`);
  const data = await resp.json() as { result?: unknown; error?: { message: string } };
  if (data.error) throw new Error(`RPC error: ${data.error.message}`);
  return data.result;
}

async function getLatestBlock(): Promise<{ number: string; timestamp: string }> {
  return rpcCall('eth_getBlockByNumber', ['latest', false]) as Promise<{ number: string; timestamp: string }>;
}

async function getBlockByNumber(hex: string): Promise<{ number: string; timestamp: string } | null> {
  return rpcCall('eth_getBlockByNumber', [hex, false]) as Promise<{ number: string; timestamp: string } | null>;
}

/** Binary-search for the block closest to (but not after) a given Unix timestamp */
async function findBlockNearTimestamp(targetTs: number): Promise<number> {
  const latest = await getLatestBlock();
  let high = parseInt(latest.number, 16);
  let low = Math.max(0, high - 50_000); // search at most ~7 days back

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const block = await getBlockByNumber('0x' + mid.toString(16));
    if (!block) {
      high = mid;
      continue;
    }
    const ts = parseInt(block.timestamp, 16);
    if (ts < targetTs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

interface LogEntry {
  topics: string[];
  data: string;
  transactionHash: string;
  blockNumber: string;
}

/** Fetch USDC Transfer logs to a specific address in a block range */
async function fetchTransferLogs(toAddress: string, fromBlock: number, toBlock: number): Promise<LogEntry[]> {
  // ERC-20 Transfer(address indexed from, address indexed to, uint256 value)
  // topic[0] = Transfer sig, topic[2] = to (padded)
  const paddedTo = '0x000000000000000000000000' + toAddress.slice(2).toLowerCase();
  const result = await rpcCall('eth_getLogs', [{
    fromBlock: '0x' + fromBlock.toString(16),
    toBlock: '0x' + toBlock.toString(16),
    address: USDC_BASE,
    topics: [TRANSFER_TOPIC, null, paddedTo],
  }]);
  return result as LogEntry[];
}

// ────────────────────────────────────────────────────────────
// Row type
// ────────────────────────────────────────────────────────────
interface PaymentRequestRow {
  id: string;
  address: string;
  amount_usdc_requested: number;
  amount_usdc_expected: number;
  memo: string;
  status: string;
  chain: string;
  created_at: string;
  expires_at: string;
  paid_at: string | null;
  paid_tx_hash: string | null;
}

// ────────────────────────────────────────────────────────────
// Tool: payment_request
// ────────────────────────────────────────────────────────────
export async function paymentRequest(
  params: {
    amount_usdc: number;
    memo: string;
    expiry_hours?: number;
    wallet_label?: string;
  },
  claims: PassportClaims,
): Promise<{
  request_id: string;
  address: string;
  amount_usdc_expected: number;
  memo: string;
  expires_at: string;
  eip681_uri: string;
  instructions: string;
}> {
  enforceTrust(claims, PAYMENT_REQUEST_TOOLS.payment_request);
  ensurePaymentRequestsSchema();

  const address = resolveAddress(params.wallet_label);
  const expiryHours = params.expiry_hours ?? 72;
  const amountExpected = getUniqueAmount(address, params.amount_usdc);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiryHours * 3600 * 1000).toISOString();
  const createdAt = now.toISOString();
  const id = genId();

  const db = openDb();
  db.prepare(`
    INSERT INTO payment_requests
      (id, address, amount_usdc_requested, amount_usdc_expected, memo, status, chain, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, 'pending', 'base', ?, ?)
  `).run(id, address, params.amount_usdc, amountExpected, params.memo, createdAt, expiresAt);

  return {
    request_id: id,
    address,
    amount_usdc_expected: amountExpected,
    memo: params.memo,
    expires_at: expiresAt,
    eip681_uri: buildEip681Uri(address, amountExpected),
    instructions: `Send exactly ${amountExpected} USDC on Base to ${address}.`,
  };
}

// ────────────────────────────────────────────────────────────
// Tool: payment_status
// ────────────────────────────────────────────────────────────
export async function paymentStatus(
  params: { request_id: string },
  claims: PassportClaims,
): Promise<PaymentRequestRow & { newly_paid?: boolean }> {
  enforceTrust(claims, PAYMENT_REQUEST_TOOLS.payment_status);
  ensurePaymentRequestsSchema();

  const db = openDb();
  const row = db.prepare('SELECT * FROM payment_requests WHERE id = ?').get(params.request_id) as PaymentRequestRow | undefined;
  if (!row) throw new Error(`Payment request "${params.request_id}" not found`);

  // Already settled
  if (row.status !== 'pending') return row;

  const now = new Date();

  // Check expiry first
  if (new Date(row.expires_at) <= now) {
    db.prepare(`UPDATE payment_requests SET status = 'expired' WHERE id = ?`).run(row.id);
    return { ...row, status: 'expired' };
  }

  // Scan Base for matching Transfer logs
  const createdTs = Math.floor(new Date(row.created_at).getTime() / 1000);
  const startBlock = await findBlockNearTimestamp(createdTs);

  const latest = await getLatestBlock();
  const latestBlock = parseInt(latest.number, 16);

  const logs = await fetchTransferLogs(row.address, startBlock, latestBlock);

  // Expected value in USDC micro-units (6 decimals)
  const expectedUnits = BigInt(Math.round(row.amount_usdc_expected * 1_000_000));

  for (const log of logs) {
    // data is the uint256 transfer value (padded 32-byte hex)
    const value = BigInt(log.data);
    if (value === expectedUnits) {
      const paidAt = now.toISOString();
      db.prepare(`
        UPDATE payment_requests SET status = 'paid', paid_at = ?, paid_tx_hash = ? WHERE id = ?
      `).run(paidAt, log.transactionHash, row.id);

      // Insert webhook_events row so wait_for_webhook/read_webhook_events can pick it up
      // The webhook_events table has a FK to webhooks(label) — but we insert with label='payments'
      // which may not exist as a registered webhook. We ensure the row is accepted by inserting
      // without the FK constraint (SQLite FK enforcement is opt-in; openDb does not enable it).
      const eventBody = JSON.stringify({
        type: 'payment_received',
        request_id: row.id,
        address: row.address,
        amount_usdc: row.amount_usdc_expected,
        memo: row.memo,
        tx_hash: log.transactionHash,
        paid_at: paidAt,
      });
      db.prepare(`
        INSERT INTO webhook_events (webhook_label, headers, body, received_at)
        VALUES (?, ?, ?, ?)
      `).run('payments', JSON.stringify({}), eventBody, paidAt);

      return {
        ...row,
        status: 'paid',
        paid_at: paidAt,
        paid_tx_hash: log.transactionHash,
        newly_paid: true,
      };
    }
  }

  return row;
}

// ────────────────────────────────────────────────────────────
// Tool: payment_list
// ────────────────────────────────────────────────────────────
export async function paymentList(
  params: { status?: 'pending' | 'paid' | 'expired' },
  claims: PassportClaims,
): Promise<PaymentRequestRow[]> {
  enforceTrust(claims, PAYMENT_REQUEST_TOOLS.payment_list);
  ensurePaymentRequestsSchema();

  const db = openDb();

  if (params.status) {
    return db.prepare(
      'SELECT * FROM payment_requests WHERE status = ? ORDER BY created_at DESC LIMIT 50',
    ).all(params.status) as PaymentRequestRow[];
  }

  return db.prepare(
    'SELECT * FROM payment_requests ORDER BY created_at DESC LIMIT 50',
  ).all() as PaymentRequestRow[];
}
