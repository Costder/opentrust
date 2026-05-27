import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { CONFIG_DIR, ensureConfigDir } from './config.js';

const PBKDF2_ITER = 100_000;
const PBKDF2_KEYLEN = 32;

function getKeystorePath(): string {
  return join(CONFIG_DIR, 'keystore.enc');
}

export interface WalletEntry {
  label: string;
  privateKey: string;    // 0x-prefixed hex private key
  chains: ('base' | 'polygon')[];
  gasReserveUsdc: number;
  dailyCapUsdc: number;
  maxPerCallUsdc: number;
  createdAt: string;
}

// File format (all in one JSON blob, then AES-256-GCM encrypted):
// { salt: hex, iv: hex, authTag: hex, ciphertext: hex }

export function encryptData(data: string, passphrase: string): string {
  const salt = randomBytes(32);
  const key = pbkdf2Sync(passphrase, salt, PBKDF2_ITER, PBKDF2_KEYLEN, 'sha256');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: encrypted.toString('hex'),
  });
}

export function decryptData(encryptedJson: string, passphrase: string): string {
  const { salt, iv, authTag, ciphertext } = JSON.parse(encryptedJson) as {
    salt: string; iv: string; authTag: string; ciphertext: string;
  };
  const key = pbkdf2Sync(passphrase, Buffer.from(salt, 'hex'), PBKDF2_ITER, PBKDF2_KEYLEN, 'sha256');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  return decipher.update(Buffer.from(ciphertext, 'hex')) + decipher.final('utf8');
}

export function loadKeystore(passphrase: string): WalletEntry[] {
  const path = getKeystorePath();
  if (!existsSync(path)) return [];
  const encrypted = readFileSync(path, 'utf-8');
  const decrypted = decryptData(encrypted, passphrase);
  return JSON.parse(decrypted) as WalletEntry[];
}

export function saveKeystore(entries: WalletEntry[], passphrase: string): void {
  ensureConfigDir();
  const encrypted = encryptData(JSON.stringify(entries), passphrase);
  writeFileSync(getKeystorePath(), encrypted, { mode: 0o600 });
}

export function addWallet(entry: WalletEntry, passphrase: string): void {
  const entries = loadKeystore(passphrase);
  if (entries.find(e => e.label === entry.label)) {
    throw new Error(`Wallet with label "${entry.label}" already exists`);
  }
  entries.push(entry);
  saveKeystore(entries, passphrase);
}

export function getWallet(label: string, passphrase: string): WalletEntry | undefined {
  return loadKeystore(passphrase).find(e => e.label === label);
}
