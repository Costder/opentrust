import Database from 'better-sqlite3';
import { join } from 'path';
import { CONFIG_DIR, ensureConfigDir } from './config.js';
import { TrustError } from './trust.js';
import type { WalletEntry } from './keystore.js';

export function getDbPath(): string {
  return join(CONFIG_DIR, 'data.db');
}

let _db: Database.Database | null = null;

export function openDb(): Database.Database {
  if (_db) return _db;
  ensureConfigDir();
  _db = new Database(getDbPath());
  _db.exec(`
    CREATE TABLE IF NOT EXISTS spend_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_label TEXT NOT NULL,
      chain TEXT NOT NULL,
      amount_usdc REAL NOT NULL,
      tool_name TEXT NOT NULL,
      tx_hash TEXT,
      logged_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bridge_log (
      bridge_id TEXT PRIMARY KEY,
      direction TEXT NOT NULL,
      from_label TEXT NOT NULL,
      amount_usdc REAL NOT NULL,
      status TEXT NOT NULL,
      initiated_at TEXT NOT NULL,
      completed_at TEXT,
      tx_hash TEXT
    );
    CREATE TABLE IF NOT EXISTS phone_numbers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT UNIQUE NOT NULL,
      provider TEXT NOT NULL,
      sid TEXT NOT NULL,
      area_code TEXT,
      provisioned_at TEXT NOT NULL,
      released_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sms_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL,
      sid TEXT UNIQUE NOT NULL,
      from_number TEXT NOT NULL,
      to_number TEXT NOT NULL,
      body TEXT NOT NULL,
      direction TEXT NOT NULL,
      status TEXT NOT NULL,
      date_sent TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mailboxes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mailbox_address TEXT NOT NULL,
      message_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      from_address TEXT NOT NULL,
      body_text TEXT NOT NULL,
      body_html TEXT,
      received_at TEXT NOT NULL,
      FOREIGN KEY (mailbox_address) REFERENCES mailboxes(address) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS tunnels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT UNIQUE NOT NULL,
      tunnel_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      url TEXT NOT NULL,
      port INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      closed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT UNIQUE NOT NULL,
      path TEXT NOT NULL,
      secret_token TEXT NOT NULL,
      max_payload_bytes INTEGER NOT NULL DEFAULT 1048576,
      retention_days INTEGER NOT NULL DEFAULT 30,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      webhook_label TEXT NOT NULL,
      headers TEXT NOT NULL,
      body TEXT NOT NULL,
      received_at TEXT NOT NULL,
      FOREIGN KEY (webhook_label) REFERENCES webhooks(label) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT UNIQUE NOT NULL,
      cron_expression TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      tool_args TEXT NOT NULL,
      passport_id TEXT NOT NULL,
      passport_version TEXT NOT NULL,
      permission_snapshot TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      last_fired_at TEXT,
      last_fire_status TEXT
    );
  `);
  return _db;
}

/** For tests — reset the singleton so each test gets a fresh DB */
export function _resetDb(): void {
  _db = null;
}

export function logSpend(
  walletLabel: string,
  chain: string,
  amountUsdc: number,
  toolName: string,
  txHash?: string,
): void {
  const db = openDb();
  db.prepare(`
    INSERT INTO spend_log (wallet_label, chain, amount_usdc, tool_name, tx_hash, logged_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(walletLabel, chain, amountUsdc, toolName, txHash ?? null, new Date().toISOString());
}

export function getDailySpend(walletLabel: string): number {
  const db = openDb();
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const result = db.prepare(`
    SELECT COALESCE(SUM(amount_usdc), 0) as total
    FROM spend_log
    WHERE wallet_label = ? AND logged_at >= ?
  `).get(walletLabel, midnight.toISOString()) as { total: number };
  return result.total;
}

export function checkSpendAllowed(
  walletLabel: string,
  entry: WalletEntry,
  proposedAmountUsdc: number,
): void {
  const effectiveCap = entry.dailyCapUsdc - entry.gasReserveUsdc;
  if (proposedAmountUsdc > entry.maxPerCallUsdc) {
    throw new TrustError(
      `Amount ${proposedAmountUsdc} USDC exceeds per-call cap ${entry.maxPerCallUsdc} USDC`,
    );
  }
  const spent = getDailySpend(walletLabel);
  if (spent + proposedAmountUsdc > effectiveCap) {
    throw new TrustError(
      `Daily cap exceeded: ${spent + proposedAmountUsdc} USDC would exceed ${effectiveCap} USDC (cap ${entry.dailyCapUsdc} - reserve ${entry.gasReserveUsdc})`,
    );
  }
}
