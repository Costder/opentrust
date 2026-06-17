import {
  isPaused
} from "./chunk-AWZFPYEH.js";
import {
  CONFIG_DIR,
  ensureConfigDir,
  readConfig
} from "./chunk-4KSGGIH6.js";

// src/server.ts
import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

// src/auth.ts
import { createHmac } from "crypto";
var AuthError = class extends Error {
  constructor(message, statusCode = 401) {
    super(message);
    this.statusCode = statusCode;
    this.name = "AuthError";
  }
  statusCode;
};
function extractBearerToken(authHeader) {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError("Missing or malformed Authorization header");
  }
  const token = authHeader.slice(7).trim();
  if (!token) throw new AuthError("Empty bearer token");
  return token;
}
function verifyLocalJwt(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AuthError("Invalid JWT format", 401);
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = createHmac("sha256", secret).update(signingInput).digest("base64url");
  if (expectedSig !== signatureB64) {
    throw new AuthError("Invalid JWT signature", 401);
  }
  const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf-8");
  return JSON.parse(payloadJson);
}
async function validatePassport(token, registryUrl) {
  const jwtSecret = process.env["OPENTRUST_JWT_SECRET"];
  if (jwtSecret) {
    return verifyLocalJwt(token, jwtSecret);
  }
  let response;
  try {
    response = await fetch(`${registryUrl}/api/v1/passports/validate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    throw new AuthError(`Registry unreachable: ${String(e)}`);
  }
  if (response.status === 401) {
    throw new AuthError("Invalid passport token", 401);
  }
  if (response.status === 403) {
    const body = await response.json();
    throw new AuthError(`Passport revoked (${body.reason ?? "unknown"})`, 403);
  }
  if (!response.ok) {
    throw new AuthError(`Registry error: ${response.status}`);
  }
  return response.json();
}

// src/trust.ts
var TrustError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "TrustError";
  }
};
var DisputedError = class extends Error {
  constructor(passportId) {
    super(`Passport ${passportId} is in disputed status \u2014 all operations halted`);
    this.name = "DisputedError";
  }
};
function enforceTrust(claims, tool) {
  if (claims.isDisputed || claims.trustStatus === "disputed") {
    throw new DisputedError(claims.passportId);
  }
  if (claims.trustLevel < tool.minTrustLevel) {
    throw new TrustError(
      `Tool '${tool.name}' requires trust level ${tool.minTrustLevel}, passport has level ${claims.trustLevel} (${claims.trustStatus})`
    );
  }
}

// src/secrets.ts
var SecretsError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "SecretsError";
  }
};
function loadSecrets() {
  const cfg = readConfig();
  return cfg.capabilities;
}
function getNotifyTopic() {
  const secrets = loadSecrets();
  if (!secrets.notify?.topic) {
    throw new SecretsError(
      'ntfy.sh topic not configured. Run "hands-and-feet init" to set it up.'
    );
  }
  return {
    topic: secrets.notify.topic,
    serverUrl: secrets.notify.serverUrl ?? "https://ntfy.sh"
  };
}

// src/capabilities/notify/index.ts
var NOTIFY_TOOL = {
  name: "notify_human",
  description: "Sends a push notification via ntfy.sh. Use to alert the human operator of important events, errors, or actions requiring attention.",
  inputSchema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "The notification message body"
      },
      title: {
        type: "string",
        description: 'Optional notification title (default: "Hands and Feet")'
      },
      priority: {
        type: "string",
        enum: ["min", "low", "default", "high", "urgent"],
        description: 'ntfy.sh priority level (default: "default")'
      }
    },
    required: ["message"]
  },
  minTrustLevel: 2,
  spendPolicy: void 0
};
async function notifyHuman(params, claims) {
  enforceTrust(claims, NOTIFY_TOOL);
  const { topic, serverUrl } = getNotifyTopic();
  const url = `${serverUrl.replace(/\/$/, "")}/${encodeURIComponent(topic)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      Title: params.title ?? "Hands and Feet",
      Priority: params.priority ?? "default"
    },
    body: params.message
  });
  if (!response.ok) {
    throw new Error(`ntfy.sh returned ${response.status}: ${await response.text()}`);
  }
  return { sent: true, topic };
}

// src/capabilities/wallet/index.ts
import { ethers } from "ethers";

// src/keystore.ts
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
var PBKDF2_ITER = 1e5;
var PBKDF2_KEYLEN = 32;
function getKeystorePath() {
  return join(CONFIG_DIR, "keystore.enc");
}
function encryptData(data, passphrase) {
  const salt = randomBytes(32);
  const key = pbkdf2Sync(passphrase, salt, PBKDF2_ITER, PBKDF2_KEYLEN, "sha256");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    ciphertext: encrypted.toString("hex")
  });
}
function decryptData(encryptedJson, passphrase) {
  const { salt, iv, authTag, ciphertext } = JSON.parse(encryptedJson);
  const key = pbkdf2Sync(passphrase, Buffer.from(salt, "hex"), PBKDF2_ITER, PBKDF2_KEYLEN, "sha256");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(authTag, "hex"));
  return decipher.update(Buffer.from(ciphertext, "hex")) + decipher.final("utf8");
}
function loadKeystore(passphrase) {
  const path = getKeystorePath();
  if (!existsSync(path)) return [];
  const encrypted = readFileSync(path, "utf-8");
  const decrypted = decryptData(encrypted, passphrase);
  return JSON.parse(decrypted);
}
function saveKeystore(entries, passphrase) {
  ensureConfigDir();
  const encrypted = encryptData(JSON.stringify(entries), passphrase);
  writeFileSync(getKeystorePath(), encrypted, { mode: 384 });
}
function addWallet(entry, passphrase) {
  const entries = loadKeystore(passphrase);
  if (entries.find((e) => e.label === entry.label)) {
    throw new Error(`Wallet with label "${entry.label}" already exists`);
  }
  entries.push(entry);
  saveKeystore(entries, passphrase);
}
function getWallet(label, passphrase) {
  return loadKeystore(passphrase).find((e) => e.label === label);
}

// src/spend-tracker.ts
import Database from "better-sqlite3";
import { join as join2 } from "path";
function getDbPath() {
  return join2(CONFIG_DIR, "data.db");
}
var _db = null;
function openDb() {
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
    CREATE TABLE IF NOT EXISTS rss_feeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      link TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rss_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_label TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      url TEXT,
      guid TEXT,
      date TEXT NOT NULL,
      FOREIGN KEY (feed_label) REFERENCES rss_feeds(label) ON DELETE CASCADE
    );
  `);
  return _db;
}
function logSpend(walletLabel, chain, amountUsdc, toolName, txHash) {
  const db = openDb();
  db.prepare(`
    INSERT INTO spend_log (wallet_label, chain, amount_usdc, tool_name, tx_hash, logged_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(walletLabel, chain, amountUsdc, toolName, txHash ?? null, (/* @__PURE__ */ new Date()).toISOString());
}
function getDailySpend(walletLabel) {
  const db = openDb();
  const midnight = /* @__PURE__ */ new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const result = db.prepare(`
    SELECT COALESCE(SUM(amount_usdc), 0) as total
    FROM spend_log
    WHERE wallet_label = ? AND logged_at >= ?
  `).get(walletLabel, midnight.toISOString());
  return result.total;
}
function checkSpendAllowed(walletLabel, entry, proposedAmountUsdc) {
  const effectiveCap = entry.dailyCapUsdc - entry.gasReserveUsdc;
  if (proposedAmountUsdc > entry.maxPerCallUsdc) {
    throw new TrustError(
      `Amount ${proposedAmountUsdc} USDC exceeds per-call cap ${entry.maxPerCallUsdc} USDC`
    );
  }
  const spent = getDailySpend(walletLabel);
  if (spent + proposedAmountUsdc > effectiveCap) {
    throw new TrustError(
      `Daily cap exceeded: ${spent + proposedAmountUsdc} USDC would exceed ${effectiveCap} USDC (cap ${entry.dailyCapUsdc} - reserve ${entry.gasReserveUsdc})`
    );
  }
}

// src/capabilities/wallet/index.ts
var SYSTEM_CLAIMS = {
  passportId: "system",
  agentId: "hands-and-feet-system",
  trustLevel: 7,
  trustStatus: "continuously_monitored",
  flags: [],
  isDisputed: false,
  version: "1"
};
var BASE_RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
var POLYGON_RPC = process.env.POLYGON_RPC_URL ?? "https://polygon-rpc.com";
var USDC_ADDRESSES = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"
};
var ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 amount) returns (bool)"
];
function getProvider(chain) {
  return new ethers.JsonRpcProvider(chain === "base" ? BASE_RPC : POLYGON_RPC);
}
function requirePassphrase() {
  const pp = process.env.HANDS_AND_FEET_PASSPHRASE;
  if (!pp) {
    throw new Error(
      'HANDS_AND_FEET_PASSPHRASE env var is required for wallet operations. Set it before running "hands-and-feet serve".'
    );
  }
  return pp;
}
var WALLET_TOOLS = {
  create_wallet: { name: "create_wallet", minTrustLevel: 3 },
  get_address: { name: "get_address", minTrustLevel: 2 },
  get_balance: { name: "get_balance", minTrustLevel: 2 },
  send_usdc: {
    name: "send_usdc",
    minTrustLevel: 4,
    spendPolicy: { maxPerCallUsdc: 1e3, dailyCapUsdc: 1e4 }
  },
  sign_message: { name: "sign_message", minTrustLevel: 3 },
  sign_typed_data: { name: "sign_typed_data", minTrustLevel: 4 }
};
async function createWallet(params, claims) {
  enforceTrust(claims, WALLET_TOOLS.create_wallet);
  const passphrase = requirePassphrase();
  const label = params.label ?? `wallet-${Date.now()}`;
  const wallet = ethers.Wallet.createRandom();
  addWallet({
    label,
    privateKey: wallet.privateKey,
    chains: [params.chain ?? "base"],
    gasReserveUsdc: 5,
    dailyCapUsdc: 100,
    maxPerCallUsdc: 50,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  }, passphrase);
  return { address: wallet.address, label };
}
async function getAddress(params, claims) {
  enforceTrust(claims, WALLET_TOOLS.get_address);
  const passphrase = requirePassphrase();
  const entry = getWallet(params.label, passphrase);
  if (!entry) throw new Error(`Wallet "${params.label}" not found`);
  const wallet = new ethers.Wallet(entry.privateKey);
  return { address: wallet.address };
}
async function getBalance(params, claims) {
  enforceTrust(claims, WALLET_TOOLS.get_balance);
  const passphrase = requirePassphrase();
  const entry = getWallet(params.label, passphrase);
  if (!entry) throw new Error(`Wallet "${params.label}" not found`);
  const chain = params.chain ?? (entry.chains[0] ?? "base");
  const provider = getProvider(chain);
  const wallet = new ethers.Wallet(entry.privateKey, provider);
  const [native, usdcBalance] = await Promise.all([
    provider.getBalance(wallet.address),
    (async () => {
      const usdcAddress = USDC_ADDRESSES[chain];
      if (!usdcAddress) return "0";
      const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, provider);
      return (await usdc.balanceOf(wallet.address)).toString();
    })()
  ]);
  return {
    native: ethers.formatEther(native),
    usdc: ethers.formatUnits(usdcBalance, 6),
    chain
  };
}
async function sendUsdc(params, claims) {
  enforceTrust(claims, WALLET_TOOLS.send_usdc);
  const passphrase = requirePassphrase();
  const entry = getWallet(params.from_label, passphrase);
  if (!entry) throw new Error(`Wallet "${params.from_label}" not found`);
  const chain = params.chain ?? "base";
  checkSpendAllowed(params.from_label, entry, params.amount);
  const provider = getProvider(chain);
  const wallet = new ethers.Wallet(entry.privateKey, provider);
  const usdcAddress = USDC_ADDRESSES[chain];
  const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, wallet);
  const amountWei = ethers.parseUnits(params.amount.toString(), 6);
  const tx = await usdc.transfer(params.to_address, amountWei);
  logSpend(params.from_label, chain, params.amount, "send_usdc", tx.hash);
  return { txHash: tx.hash, amount: params.amount, chain };
}
async function signMessage(params, claims) {
  enforceTrust(claims, WALLET_TOOLS.sign_message);
  const passphrase = requirePassphrase();
  const entry = getWallet(params.label, passphrase);
  if (!entry) throw new Error(`Wallet "${params.label}" not found`);
  const wallet = new ethers.Wallet(entry.privateKey);
  const signature = await wallet.signMessage(params.text);
  return { signature };
}
async function signTypedData(params, claims) {
  enforceTrust(claims, WALLET_TOOLS.sign_typed_data);
  await notifyHuman({
    message: `sign_typed_data rejected: New EIP-712 domain ${JSON.stringify(params.domain)} with primaryType. Use CLI to allowlist: hands-and-feet allowlist-add-typed-data`,
    priority: "urgent",
    title: "EIP-712 First-Use Rejection"
  }, SYSTEM_CLAIMS).catch(() => void 0);
  throw new Error(
    "UNTRUSTED_TYPED_DATA: First-use of this EIP-712 domain/primaryType is rejected. Run: hands-and-feet allowlist-add-typed-data <passport-id> <domain-json> <primary-type>"
  );
}

// src/capabilities/bridge/index.ts
import { randomUUID } from "crypto";
var BRIDGE_TOOLS = {
  bridge_to_polygon: { name: "bridge_to_polygon", minTrustLevel: 4 },
  bridge_to_base: { name: "bridge_to_base", minTrustLevel: 4 },
  get_bridge_status: { name: "get_bridge_status", minTrustLevel: 2 }
};
async function bridgeToPolygon(params, claims) {
  enforceTrust(claims, BRIDGE_TOOLS.bridge_to_polygon);
  const db = openDb();
  const bridgeId = randomUUID();
  db.prepare(`
    INSERT INTO bridge_log (bridge_id, direction, from_label, amount_usdc, status, initiated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(bridgeId, "base_to_polygon", params.from_label, params.amount, "pending", (/* @__PURE__ */ new Date()).toISOString());
  return {
    bridge_id: bridgeId,
    status: "pending",
    note: "Across Protocol SDK integration pending. Bridge intent logged. Poll get_bridge_status."
  };
}
async function bridgeToBase(params, claims) {
  enforceTrust(claims, BRIDGE_TOOLS.bridge_to_base);
  const db = openDb();
  const bridgeId = randomUUID();
  db.prepare(`
    INSERT INTO bridge_log (bridge_id, direction, from_label, amount_usdc, status, initiated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(bridgeId, "polygon_to_base", params.from_label, params.amount, "pending", (/* @__PURE__ */ new Date()).toISOString());
  return {
    bridge_id: bridgeId,
    status: "pending",
    note: "Across Protocol SDK integration pending. Bridge intent logged."
  };
}
async function getBridgeStatus(params, claims) {
  enforceTrust(claims, BRIDGE_TOOLS.get_bridge_status);
  const db = openDb();
  const row = db.prepare("SELECT * FROM bridge_log WHERE bridge_id = ?").get(params.bridge_id);
  if (!row) throw new Error(`Bridge ${params.bridge_id} not found`);
  return {
    bridge_id: row.bridge_id,
    status: row.status,
    direction: row.direction,
    amount_usdc: row.amount_usdc
  };
}

// src/capabilities/payments/index.ts
import { ethers as ethers2 } from "ethers";

// src/capabilities/payments/prepare-payment.ts
import { parseUnits } from "ethers";
var PREPARE_PAYMENT_TOOL = {
  name: "prepare_payment",
  minTrustLevel: 4
};
async function preparePayment(params, claims) {
  enforceTrust(claims, PREPARE_PAYMENT_TOOL);
  const bridgeIfNeeded = params.bridge_if_needed !== false;
  const bridgeTimeoutMs = params.bridge_timeout_ms ?? 12e4;
  const bridgePollIntervalMs = params.bridge_poll_interval_ms ?? 5e3;
  const balanceResult = await getBalance(
    { label: params.from_label, chain: "base" },
    claims
  );
  const balanceMicro = parseUnits(balanceResult.usdc, 6);
  const requiredMicro = parseUnits(params.amount_usdc.toString(), 6);
  let bridged = false;
  let bridge_id;
  if (balanceMicro < requiredMicro) {
    if (!bridgeIfNeeded) {
      return {
        status: "failed",
        error: "insufficient balance and bridge disabled"
      };
    }
    const bridgeResult = await bridgeToBase(
      { from_label: params.from_label, amount: params.amount_usdc },
      claims
    );
    bridge_id = bridgeResult.bridge_id;
    const startTime = Date.now();
    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= bridgeTimeoutMs) {
        return { status: "failed", error: "bridge timeout", bridge_id };
      }
      await new Promise((r) => setTimeout(r, bridgePollIntervalMs));
      const statusResult = await getBridgeStatus({ bridge_id }, claims);
      if (statusResult.status === "minted") {
        bridged = true;
        break;
      }
      if (statusResult.status === "failed" || statusResult.status === "stuck") {
        return {
          status: "failed",
          error: `bridge failed: ${statusResult.status}`,
          bridge_id
        };
      }
    }
  }
  const payResult = await payWithUsdc(
    {
      from_label: params.from_label,
      to_address: params.to_address,
      amount: params.amount_usdc,
      memo: params.memo
    },
    claims
  );
  return {
    status: "success",
    txHash: payResult.txHash,
    amountSent: payResult.amount,
    chain: payResult.chain,
    bridged,
    bridge_id
  };
}

// src/capabilities/payments/index.ts
var PAYMENT_TOOLS = {
  pay_with_usdc: {
    name: "pay_with_usdc",
    minTrustLevel: 4,
    spendPolicy: { maxPerCallUsdc: 1e3, dailyCapUsdc: 1e4 }
  },
  get_payment_status: { name: "get_payment_status", minTrustLevel: 2 },
  prepare_payment: { name: "prepare_payment", minTrustLevel: 4 }
};
var BASE_RPC2 = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
async function payWithUsdc(params, claims) {
  enforceTrust(claims, PAYMENT_TOOLS.pay_with_usdc);
  const result = await sendUsdc(
    { from_label: params.from_label, to_address: params.to_address, amount: params.amount, chain: "base" },
    claims
  );
  return { txHash: result.txHash, amount: result.amount, chain: "base", memo: params.memo };
}
async function getPaymentStatus(params, claims) {
  enforceTrust(claims, PAYMENT_TOOLS.get_payment_status);
  const provider = new ethers2.JsonRpcProvider(BASE_RPC2);
  const receipt = await provider.getTransactionReceipt(params.tx_hash);
  if (!receipt) return { status: "pending", confirmations: 0 };
  const block = await provider.getBlockNumber();
  const confirmations = block - receipt.blockNumber;
  return {
    status: receipt.status === 1 ? "confirmed" : "failed",
    confirmations
  };
}

// src/capabilities/cards/moon-client.ts
import OAuth from "oauth-1.0a";
import { createHmac as createHmac2 } from "crypto";
var MoonClient = class {
  oauth;
  baseUrl;
  constructor(config) {
    this.baseUrl = config.sandbox ? "https://sandbox.api.paywithmoon.com/v1" : "https://api.paywithmoon.com/v1";
    this.oauth = new OAuth({
      consumer: { key: config.consumerKey, secret: config.consumerSecret },
      signature_method: "HMAC-SHA1",
      hash_function(baseString, key) {
        return createHmac2("sha1", key).update(baseString).digest("base64");
      }
    });
  }
  async request(method, path, body) {
    const url = `${this.baseUrl}${path}`;
    const requestData = { url, method };
    const authHeader = this.oauth.toHeader(this.oauth.authorize(requestData));
    const response = await fetch(url, {
      method,
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: body != null ? JSON.stringify(body) : void 0
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Moon API ${response.status}: ${text}`);
    }
    return response.json();
  }
  get(path) {
    return this.request("GET", path);
  }
  post(path, body) {
    return this.request("POST", path, body);
  }
  patch(path, body) {
    return this.request("PATCH", path, body);
  }
  delete(path) {
    return this.request("DELETE", path);
  }
};

// src/capabilities/cards/index.ts
function getMoonClient() {
  const consumerKey = process.env.MOON_CONSUMER_KEY;
  const consumerSecret = process.env.MOON_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) {
    throw new SecretsError(
      "Moon credentials not set. Set MOON_CONSUMER_KEY and MOON_CONSUMER_SECRET env vars."
    );
  }
  const cfg = readConfig();
  const sandbox = process.env.MOON_API_ENV === "sandbox" || cfg.capabilities.cards?.sandbox === true;
  return new MoonClient({ consumerKey, consumerSecret, sandbox });
}
var CARD_TOOLS = {
  create_virtual_card: { name: "create_virtual_card", minTrustLevel: 4 },
  get_card_details: { name: "get_card_details", minTrustLevel: 3 },
  add_funds_to_card: { name: "add_funds_to_card", minTrustLevel: 4 },
  top_up_moon_credit: { name: "top_up_moon_credit", minTrustLevel: 4 },
  freeze_card: { name: "freeze_card", minTrustLevel: 3 },
  delete_card: { name: "delete_card", minTrustLevel: 3 },
  get_card_transactions: { name: "get_card_transactions", minTrustLevel: 3 }
};
async function createVirtualCard(params, claims) {
  enforceTrust(claims, CARD_TOOLS.create_virtual_card);
  const client = getMoonClient();
  const card = await client.post("/cards", {
    product: params.product ?? "moon_x",
    ...params.amount != null && { amount: params.amount }
  });
  return { cardId: card.id, label: params.label ?? card.id, product: card.product };
}
async function getCardDetails(params, claims) {
  enforceTrust(claims, CARD_TOOLS.get_card_details);
  const client = getMoonClient();
  const card = await client.get(`/cards/${params.label}`);
  return { cardId: card.id, number: card.number, cvv: card.cvv, expiry: card.expiry };
}
async function addFundsToCard(params, claims) {
  enforceTrust(claims, CARD_TOOLS.add_funds_to_card);
  const client = getMoonClient();
  const result = await client.post(`/cards/${params.label}/fund`, { amount: params.amount });
  return { success: result.success, newBalance: result.balance };
}
async function topUpMoonCredit(params, claims) {
  enforceTrust(claims, CARD_TOOLS.top_up_moon_credit);
  const client = getMoonClient();
  const deposit = await client.get("/balance/deposit-address");
  return {
    depositAddress: deposit.address,
    amountUsdc: params.amount,
    note: 'Send USDC on Polygon to depositAddress using send_usdc with chain:"polygon". Then poll Moon Credit balance.'
  };
}
async function freezeCard(params, claims) {
  enforceTrust(claims, CARD_TOOLS.freeze_card);
  const client = getMoonClient();
  await client.patch(`/cards/${params.label}`, { status: "frozen" });
  return { frozen: true };
}
async function deleteCard(params, claims) {
  enforceTrust(claims, CARD_TOOLS.delete_card);
  const client = getMoonClient();
  await client.delete(`/cards/${params.label}`);
  return { deleted: true };
}
async function getCardTransactions(params, claims) {
  enforceTrust(claims, CARD_TOOLS.get_card_transactions);
  const client = getMoonClient();
  const limit = params.limit ?? 10;
  const result = await client.get(`/cards/${params.label}/transactions?limit=${limit}`);
  return { transactions: result.transactions };
}

// src/capabilities/phone/index.ts
import twilio from "twilio";
var TwilioProvider = class {
  name = "twilio";
  client;
  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      throw new SecretsError("Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN env vars");
    }
    this.client = twilio(accountSid, authToken);
  }
  async provisionNumber(areaCode) {
    const available = await this.client.availablePhoneNumbers("US").local.list({
      areaCode: areaCode ? parseInt(areaCode) : void 0,
      limit: 1
    });
    if (!available.length) throw new Error("No phone numbers available for that area code");
    const purchased = await this.client.incomingPhoneNumbers.create({
      phoneNumber: available[0].phoneNumber
    });
    return { number: purchased.phoneNumber, sid: purchased.sid };
  }
  async sendSms(from, to, body) {
    const msg = await this.client.messages.create({ from, to, body });
    return { sid: msg.sid };
  }
  async listMessages(number, limit) {
    const messages = await this.client.messages.list({ to: number, limit });
    return messages.map((m) => ({
      sid: m.sid,
      from: m.from,
      to: m.to,
      body: m.body,
      direction: m.direction,
      status: m.status,
      dateSent: m.dateSent?.toISOString() ?? (/* @__PURE__ */ new Date()).toISOString()
    }));
  }
  async releaseNumber(_number, sid) {
    await this.client.incomingPhoneNumbers(sid).remove();
  }
};
var SignalWireProvider = class {
  name = "signalwire";
  constructor() {
    const projectId = process.env.SIGNALWIRE_PROJECT_ID;
    const authToken = process.env.SIGNALWIRE_AUTH_TOKEN;
    const spaceUrl = process.env.SIGNALWIRE_SPACE_URL;
    if (!projectId || !authToken || !spaceUrl) {
      throw new SecretsError(
        "Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_AUTH_TOKEN, and SIGNALWIRE_SPACE_URL env vars"
      );
    }
  }
  // SignalWire uses Twilio-compatible REST API directly via fetch
  async swRequest(method, path, body) {
    const projectId = process.env.SIGNALWIRE_PROJECT_ID;
    const authToken = process.env.SIGNALWIRE_AUTH_TOKEN;
    const spaceUrl = process.env.SIGNALWIRE_SPACE_URL;
    const url = `${spaceUrl}/api/laml/2010-04-01/Accounts/${projectId}${path}`;
    const credentials = Buffer.from(`${projectId}:${authToken}`).toString("base64");
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: body?.toString()
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SignalWire API ${response.status}: ${text}`);
    }
    return response.json();
  }
  async provisionNumber(areaCode) {
    const available = await this.swRequest("GET", `/AvailablePhoneNumbers/US/Local.json?AreaCode=${areaCode ?? ""}&PageSize=1`);
    const phoneNumber = available.available_phone_numbers[0]?.phone_number;
    if (!phoneNumber) throw new Error("No numbers available");
    const purchaseBody = new URLSearchParams({ PhoneNumber: phoneNumber });
    const purchased = await this.swRequest(
      "POST",
      "/IncomingPhoneNumbers.json",
      purchaseBody
    );
    return { number: purchased.phone_number, sid: purchased.sid };
  }
  async sendSms(from, to, message) {
    const body = new URLSearchParams({ From: from, To: to, Body: message });
    const result = await this.swRequest("POST", "/Messages.json", body);
    return { sid: result.sid };
  }
  async listMessages(number, limit) {
    const result = await this.swRequest("GET", `/Messages.json?To=${encodeURIComponent(number)}&PageSize=${limit}`);
    return result.messages.map((m) => ({
      sid: m.sid,
      from: m.from,
      to: m.to,
      body: m.body,
      direction: m.direction,
      status: m.status,
      dateSent: m.date_sent
    }));
  }
  async releaseNumber(_number, sid) {
    await this.swRequest("DELETE", `/IncomingPhoneNumbers/${sid}.json`);
  }
};
function getProvider2() {
  const cfg = readConfig();
  const provider = cfg.capabilities.phone?.provider;
  if (!provider) {
    throw new SecretsError('Phone capability not configured. Run "hands-and-feet init" first.');
  }
  return provider === "twilio" ? new TwilioProvider() : new SignalWireProvider();
}
var PHONE_TOOLS = {
  provision_phone_number: {
    name: "provision_phone_number",
    minTrustLevel: 3,
    spendPolicy: { maxPerCallUsdc: 5, dailyCapUsdc: 50 }
  },
  send_sms: {
    name: "send_sms",
    minTrustLevel: 3,
    spendPolicy: { maxPerCallUsdc: 0.01, dailyCapUsdc: 1 }
  },
  read_sms: { name: "read_sms", minTrustLevel: 2 },
  release_phone_number: { name: "release_phone_number", minTrustLevel: 3 }
};
async function provisionPhoneNumber(params, claims) {
  enforceTrust(claims, PHONE_TOOLS.provision_phone_number);
  const provider = getProvider2();
  const { number, sid } = await provider.provisionNumber(params.area_code);
  const db = openDb();
  db.prepare(`
    INSERT OR REPLACE INTO phone_numbers (number, provider, sid, area_code, provisioned_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(number, provider.name, sid, params.area_code ?? null, (/* @__PURE__ */ new Date()).toISOString());
  return { number, provider: provider.name };
}
async function sendSms(params, claims) {
  enforceTrust(claims, PHONE_TOOLS.send_sms);
  const provider = getProvider2();
  return provider.sendSms(params.from_number, params.to, params.message);
}
async function readSms(params, claims) {
  enforceTrust(claims, PHONE_TOOLS.read_sms);
  const provider = getProvider2();
  const limit = params.limit ?? 20;
  const messages = await provider.listMessages(params.number, limit);
  const db = openDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO sms_inbox
      (number, sid, from_number, to_number, body, direction, status, date_sent, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const msg of messages) {
    insert.run(
      params.number,
      msg.sid,
      msg.from,
      msg.to,
      msg.body,
      msg.direction,
      msg.status,
      msg.dateSent,
      (/* @__PURE__ */ new Date()).toISOString()
    );
  }
  return { messages };
}
async function releasePhoneNumber(params, claims) {
  enforceTrust(claims, PHONE_TOOLS.release_phone_number);
  const db = openDb();
  const row = db.prepare("SELECT sid FROM phone_numbers WHERE number = ?").get(params.number);
  if (!row) throw new Error(`Phone number ${params.number} not found`);
  const provider = getProvider2();
  await provider.releaseNumber(params.number, row.sid);
  db.prepare("UPDATE phone_numbers SET released_at = ? WHERE number = ?").run(
    (/* @__PURE__ */ new Date()).toISOString(),
    params.number
  );
  return { released: true };
}

// src/capabilities/email/local-transport.ts
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
var LocalTransport = class {
  constructor(port = 2525) {
    this.port = port;
  }
  port;
  name = "local";
  smtpServer;
  async start() {
    return new Promise((resolve, reject) => {
      this.smtpServer = new SMTPServer({
        allowInsecureAuth: true,
        authOptional: true,
        onData: (stream, _session, callback) => {
          const chunks = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("end", () => {
            simpleParser(Buffer.concat(chunks)).then((parsed) => {
              try {
                const db = openDb();
                const toField = parsed.to;
                let toAddresses = [];
                if (Array.isArray(toField)) {
                  toAddresses = toField.flatMap(
                    (a) => a.value.map((v) => v.address ?? "")
                  );
                } else if (toField) {
                  toAddresses = toField.value.map(
                    (v) => v.address ?? ""
                  );
                }
                for (const addr of toAddresses) {
                  if (!addr) continue;
                  const mailbox = db.prepare("SELECT address FROM mailboxes WHERE address = ?").get(addr);
                  if (mailbox) {
                    db.prepare(`
                      INSERT OR IGNORE INTO emails (mailbox_address, message_id, subject, from_address, body_text, body_html, received_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?)
                    `).run(
                      addr,
                      parsed.messageId ?? `msg-${Date.now()}`,
                      parsed.subject ?? "(no subject)",
                      typeof parsed.from === "object" && parsed.from ? parsed.from.text : "",
                      parsed.text ?? "",
                      parsed.html || null,
                      (/* @__PURE__ */ new Date()).toISOString()
                    );
                  }
                }
                callback();
              } catch (err) {
                callback(err);
              }
            }).catch((err) => callback(err));
          });
        }
      });
      this.smtpServer.listen(this.port, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
  async stop() {
    return new Promise((resolve) => {
      if (this.smtpServer) {
        this.smtpServer.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
  async sendEmail(opts) {
    const transporter = nodemailer.createTransport({
      host: "127.0.0.1",
      port: this.port,
      secure: false,
      tls: { rejectUnauthorized: false }
    });
    const info = await transporter.sendMail({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      text: opts.body,
      html: opts.html
    });
    return { messageId: info.messageId };
  }
};

// src/capabilities/email/api-transport.ts
var PostmarkTransport = class {
  name = "postmark";
  constructor() {
    if (!process.env.POSTMARK_SERVER_TOKEN) {
      throw new Error("POSTMARK_SERVER_TOKEN env var not set");
    }
  }
  async sendEmail(opts) {
    const { ServerClient } = await import("postmark");
    const client = new ServerClient(process.env.POSTMARK_SERVER_TOKEN);
    const result = await client.sendEmail({
      From: opts.from,
      To: Array.isArray(opts.to) ? opts.to.join(",") : opts.to,
      Subject: opts.subject,
      TextBody: opts.body,
      HtmlBody: opts.html
    });
    return { messageId: result.MessageID };
  }
};
var ResendTransport = class {
  name = "resend";
  constructor() {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY env var not set");
    }
  }
  async sendEmail(opts) {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: opts.from,
      to: Array.isArray(opts.to) ? opts.to : [opts.to],
      subject: opts.subject,
      text: opts.body,
      html: opts.html
    });
    return { messageId: result.data?.id ?? "unknown" };
  }
};

// src/capabilities/email/index.ts
var _localTransport = null;
async function startLocalTransportIfConfigured() {
  const cfg = readConfig();
  if (cfg.capabilities.email?.transport === "local") {
    const port = cfg.capabilities.email.localPort ?? 2525;
    _localTransport = new LocalTransport(port);
    await _localTransport.start();
    console.log(`Local SMTP server listening on port ${port}`);
  }
}
function getTransport() {
  const cfg = readConfig();
  const transport = cfg.capabilities.email?.transport;
  if (!transport) {
    throw new SecretsError('Email capability not configured. Run "hands-and-feet init" first.');
  }
  switch (transport) {
    case "local":
      if (!_localTransport) {
        const port = cfg.capabilities.email?.localPort ?? 2525;
        _localTransport = new LocalTransport(port);
      }
      return _localTransport;
    case "postmark":
      return new PostmarkTransport();
    case "resend":
      return new ResendTransport();
    default:
      throw new SecretsError(`Unknown email transport: ${transport}`);
  }
}
var EMAIL_TOOLS = {
  create_mailbox: { name: "create_mailbox", minTrustLevel: 2 },
  send_email: { name: "send_email", minTrustLevel: 2 },
  read_inbox: { name: "read_inbox", minTrustLevel: 2 },
  wait_for_email: { name: "wait_for_email", minTrustLevel: 2 },
  delete_mailbox: { name: "delete_mailbox", minTrustLevel: 3 }
};
async function createMailbox(params, claims) {
  enforceTrust(claims, EMAIL_TOOLS.create_mailbox);
  const db = openDb();
  db.prepare("INSERT OR IGNORE INTO mailboxes (address, created_at) VALUES (?, ?)").run(params.address, (/* @__PURE__ */ new Date()).toISOString());
  return { address: params.address };
}
async function sendEmail(params, claims) {
  enforceTrust(claims, EMAIL_TOOLS.send_email);
  const transport = getTransport();
  return transport.sendEmail(params);
}
async function readInbox(params, claims) {
  enforceTrust(claims, EMAIL_TOOLS.read_inbox);
  const db = openDb();
  const limit = params.limit ?? 20;
  const messages = db.prepare(
    "SELECT * FROM emails WHERE mailbox_address = ? ORDER BY received_at DESC LIMIT ?"
  ).all(params.address, limit);
  return { messages };
}
async function waitForEmail(params, claims) {
  enforceTrust(claims, EMAIL_TOOLS.wait_for_email);
  const db = openDb();
  const deadline = Date.now() + params.timeout_ms;
  const filter = params.filter ?? {};
  while (Date.now() < deadline) {
    const rows = db.prepare(
      "SELECT * FROM emails WHERE mailbox_address = ? ORDER BY received_at DESC LIMIT 50"
    ).all(params.address);
    for (const row of rows) {
      const matchSubject = !filter.subject_contains || row.subject.toLowerCase().includes(filter.subject_contains.toLowerCase());
      const matchFrom = !filter.from_contains || row.from_address.toLowerCase().includes(filter.from_contains.toLowerCase());
      const matchBody = !filter.body_contains || row.body_text.toLowerCase().includes(filter.body_contains.toLowerCase());
      if (matchSubject && matchFrom && matchBody) {
        return { message: row };
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`wait_for_email timed out after ${params.timeout_ms}ms`);
}
async function deleteMailbox(params, claims) {
  enforceTrust(claims, EMAIL_TOOLS.delete_mailbox);
  const db = openDb();
  db.prepare("DELETE FROM mailboxes WHERE address = ?").run(params.address);
  return { deleted: true };
}

// src/capabilities/tunnel/index.ts
import { spawn } from "child_process";
import { randomUUID as randomUUID2 } from "crypto";
var CREATE_TUNNEL_TOOL = { name: "create_tunnel", minTrustLevel: 3 };
var GET_TUNNEL_URL_TOOL = { name: "get_tunnel_url", minTrustLevel: 2 };
var CLOSE_TUNNEL_TOOL = { name: "close_tunnel", minTrustLevel: 3 };
var TUNNEL_TOOLS = {
  create_tunnel: CREATE_TUNNEL_TOOL,
  get_tunnel_url: GET_TUNNEL_URL_TOOL,
  close_tunnel: CLOSE_TUNNEL_TOOL
};
var activeTunnels = /* @__PURE__ */ new Map();
async function cloudflaredCreate(port, label) {
  return new Promise((resolve, reject) => {
    const proc = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        proc.kill();
        reject(new Error("cloudflared: timed out waiting for tunnel URL (30s)"));
      }
    }, 3e4);
    const onData = (chunk) => {
      const text = chunk.toString();
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({ url: match[0], tunnelId: `cf-${label}-${randomUUID2().slice(0, 8)}`, process: proc });
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(err);
      }
    });
    proc.on("exit", (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(new Error(`cloudflared exited with code ${code} before providing URL`));
      }
    });
  });
}
async function ngrokCreate(port, label) {
  const ngrok = await import("@ngrok/ngrok");
  const listener = await ngrok.forward({ addr: port });
  const url = listener.url();
  if (!url) throw new Error("ngrok: no URL returned from forward()");
  return {
    url,
    tunnelId: `ng-${label}-${randomUUID2().slice(0, 8)}`,
    session: listener
  };
}
async function createTunnel(params, claims) {
  enforceTrust(claims, CREATE_TUNNEL_TOOL);
  const label = params.label ?? `tunnel-${randomUUID2().slice(0, 8)}`;
  const provider = params.provider ?? "cloudflared";
  const db = openDb();
  const existing = db.prepare("SELECT * FROM tunnels WHERE label = ? AND closed_at IS NULL").get(label);
  if (existing) {
    return { label, url: existing.url, tunnelId: existing.tunnel_id, provider: existing.provider };
  }
  let entry;
  if (provider === "cloudflared") {
    const result = await cloudflaredCreate(params.port, label);
    entry = {
      label,
      tunnelId: result.tunnelId,
      provider,
      url: result.url,
      port: params.port,
      process: result.process
    };
  } else {
    const result = await ngrokCreate(params.port, label);
    entry = {
      label,
      tunnelId: result.tunnelId,
      provider,
      url: result.url,
      port: params.port,
      session: result.session
    };
  }
  activeTunnels.set(label, entry);
  db.prepare(`
    INSERT OR REPLACE INTO tunnels (label, tunnel_id, provider, url, port, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(label, entry.tunnelId, provider, entry.url, params.port, (/* @__PURE__ */ new Date()).toISOString());
  return { label, url: entry.url, tunnelId: entry.tunnelId, provider };
}
async function getTunnelUrl(params, claims) {
  enforceTrust(claims, GET_TUNNEL_URL_TOOL);
  const db = openDb();
  const row = db.prepare("SELECT url FROM tunnels WHERE label = ? AND closed_at IS NULL").get(params.label);
  return { label: params.label, url: row?.url ?? null };
}
async function closeTunnel(params, claims) {
  enforceTrust(claims, CLOSE_TUNNEL_TOOL);
  const entry = activeTunnels.get(params.label);
  if (entry) {
    if (entry.process) {
      entry.process.kill();
    }
    if (entry.session && typeof entry.session.close === "function") {
      await entry.session.close();
    }
    activeTunnels.delete(params.label);
  }
  const db = openDb();
  db.prepare("UPDATE tunnels SET closed_at = ? WHERE label = ? AND closed_at IS NULL").run((/* @__PURE__ */ new Date()).toISOString(), params.label);
  return { label: params.label, closed: true };
}

// src/capabilities/webhook/index.ts
import { randomUUID as randomUUID3 } from "crypto";
var CREATE_WEBHOOK_TOOL = { name: "create_webhook", minTrustLevel: 3 };
var GET_WEBHOOK_URL_TOOL = { name: "get_webhook_url", minTrustLevel: 2 };
var READ_WEBHOOK_EVENTS_TOOL = { name: "read_webhook_events", minTrustLevel: 2 };
var WAIT_FOR_WEBHOOK_TOOL = { name: "wait_for_webhook", minTrustLevel: 2 };
var DELETE_WEBHOOK_TOOL = { name: "delete_webhook", minTrustLevel: 3 };
var WEBHOOK_TOOLS = {
  create_webhook: CREATE_WEBHOOK_TOOL,
  get_webhook_url: GET_WEBHOOK_URL_TOOL,
  read_webhook_events: READ_WEBHOOK_EVENTS_TOOL,
  wait_for_webhook: WAIT_FOR_WEBHOOK_TOOL,
  delete_webhook: DELETE_WEBHOOK_TOOL
};
var purgeJobHandle = null;
function purgeOldEvents() {
  const db = openDb();
  const webhooks = db.prepare("SELECT label, retention_days FROM webhooks").all();
  for (const wh of webhooks) {
    const cutoff = new Date(Date.now() - wh.retention_days * 24 * 60 * 60 * 1e3).toISOString();
    db.prepare("DELETE FROM webhook_events WHERE webhook_label = ? AND received_at < ?").run(
      wh.label,
      cutoff
    );
  }
}
function startPurgeJob() {
  if (purgeJobHandle) return;
  purgeJobHandle = setInterval(() => {
    try {
      purgeOldEvents();
    } catch (err) {
      console.error("webhook purge error:", err instanceof Error ? err.message : String(err));
    }
  }, 60 * 60 * 1e3);
  if (typeof purgeJobHandle === "object" && purgeJobHandle !== null && "unref" in purgeJobHandle) {
    purgeJobHandle.unref();
  }
}
async function webhookReceiver(req, res) {
  const { label, token } = req.params;
  const db = openDb();
  const wh = db.prepare("SELECT * FROM webhooks WHERE label = ?").get(label);
  if (!wh || wh.secret_token !== token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const bodyStr = JSON.stringify(req.body);
  if (Buffer.byteLength(bodyStr, "utf8") > wh.max_payload_bytes) {
    res.status(413).json({ error: "payload_too_large" });
    return;
  }
  const headersStr = JSON.stringify(req.headers);
  db.prepare(
    "INSERT INTO webhook_events (webhook_label, headers, body, received_at) VALUES (?, ?, ?, ?)"
  ).run(label, headersStr, bodyStr, (/* @__PURE__ */ new Date()).toISOString());
  res.status(200).json({ ok: true });
}
async function createWebhook(params, claims) {
  enforceTrust(claims, CREATE_WEBHOOK_TOOL);
  const secretToken = randomUUID3();
  const path = `/webhooks/${params.label}/${secretToken}`;
  const maxPayloadBytes = params.max_payload_bytes ?? 1048576;
  const retentionDays = params.retention_days ?? 30;
  const db = openDb();
  db.prepare(`
    INSERT INTO webhooks (label, path, secret_token, max_payload_bytes, retention_days, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(params.label, path, secretToken, maxPayloadBytes, retentionDays, (/* @__PURE__ */ new Date()).toISOString());
  return { label: params.label, path, secret_token: secretToken };
}
async function getWebhookUrl(params, claims) {
  enforceTrust(claims, GET_WEBHOOK_URL_TOOL);
  const db = openDb();
  const wh = db.prepare("SELECT path FROM webhooks WHERE label = ?").get(params.label);
  if (!wh) {
    return { label: params.label, url: null, local_path: null };
  }
  const tunnel = db.prepare("SELECT url FROM tunnels WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1").get();
  const url = tunnel ? `${tunnel.url}${wh.path}` : null;
  return { label: params.label, url, local_path: wh.path };
}
async function readWebhookEvents(params, claims) {
  enforceTrust(claims, READ_WEBHOOK_EVENTS_TOOL);
  const db = openDb();
  const limit = params.limit ?? 50;
  let rows;
  if (params.since) {
    rows = db.prepare(
      "SELECT * FROM webhook_events WHERE webhook_label = ? AND received_at > ? ORDER BY received_at ASC LIMIT ?"
    ).all(params.label, params.since, limit);
  } else {
    rows = db.prepare(
      "SELECT * FROM webhook_events WHERE webhook_label = ? ORDER BY received_at ASC LIMIT ?"
    ).all(params.label, limit);
  }
  const events = rows.map((row) => ({
    id: row.id,
    headers: JSON.parse(row.headers),
    body: JSON.parse(row.body),
    received_at: row.received_at
  }));
  return { events, count: events.length };
}
async function waitForWebhook(params, claims) {
  enforceTrust(claims, WAIT_FOR_WEBHOOK_TOOL);
  const timeoutMs = params.timeout_ms ?? 3e4;
  const deadline = Date.now() + timeoutMs;
  const db = openDb();
  const since = (/* @__PURE__ */ new Date()).toISOString();
  while (Date.now() < deadline) {
    const rows = db.prepare(
      "SELECT * FROM webhook_events WHERE webhook_label = ? AND received_at >= ? ORDER BY received_at ASC LIMIT 50"
    ).all(params.label, since);
    for (const row of rows) {
      let bodyObj;
      try {
        bodyObj = JSON.parse(row.body);
      } catch {
        bodyObj = row.body;
      }
      if (params.filter?.body_contains) {
        if (!row.body.includes(params.filter.body_contains)) continue;
      }
      return {
        event: {
          id: row.id,
          headers: JSON.parse(row.headers),
          body: bodyObj,
          received_at: row.received_at
        },
        timed_out: false
      };
    }
    await new Promise((r) => setTimeout(r, 1e3));
  }
  return { event: null, timed_out: true };
}
async function deleteWebhook(params, claims) {
  enforceTrust(claims, DELETE_WEBHOOK_TOOL);
  const db = openDb();
  const result = db.prepare("DELETE FROM webhooks WHERE label = ?").run(params.label);
  return { label: params.label, deleted: result.changes > 0 };
}

// src/capabilities/tasks/index.ts
import * as cron from "node-cron";
import { randomUUID as randomUUID4 } from "crypto";

// src/capabilities/tasks/revocation.ts
function narrowerCaps(stored, current) {
  if (!stored && !current) return void 0;
  if (!stored) return current;
  if (!current) return stored;
  return {
    maxPerCallUsdc: stored.maxPerCallUsdc !== void 0 && current.maxPerCallUsdc !== void 0 ? Math.min(stored.maxPerCallUsdc, current.maxPerCallUsdc) : stored.maxPerCallUsdc ?? current.maxPerCallUsdc,
    dailyCapUsdc: stored.dailyCapUsdc !== void 0 && current.dailyCapUsdc !== void 0 ? Math.min(stored.dailyCapUsdc, current.dailyCapUsdc) : stored.dailyCapUsdc ?? current.dailyCapUsdc
  };
}
async function validateTaskPassport(passportId, storedVersion, storedSnapshot, registryUrl) {
  let response;
  try {
    response = await fetch(`${registryUrl}/api/v1/passports/${passportId}`);
  } catch (err) {
    return {
      decision: "deny",
      reason: "registry_unreachable",
      effectiveSnapshot: storedSnapshot
    };
  }
  if (!response.ok) {
    return {
      decision: "deny",
      reason: `registry_error:${response.status}`,
      effectiveSnapshot: storedSnapshot
    };
  }
  let passport;
  try {
    passport = await response.json();
  } catch {
    return {
      decision: "deny",
      reason: "registry_invalid_response",
      effectiveSnapshot: storedSnapshot
    };
  }
  if (passport.status === "revoked" || passport.status === "disputed") {
    return {
      decision: "deny",
      reason: `passport_${passport.status}`,
      effectiveSnapshot: storedSnapshot
    };
  }
  if (passport.version !== storedVersion) {
    const currentSnapshot = {
      tool: storedSnapshot.tool,
      spendCaps: passport.spendCaps
    };
    const effectiveCaps = narrowerCaps(storedSnapshot.spendCaps, currentSnapshot.spendCaps);
    const effectiveSnapshot = {
      tool: storedSnapshot.tool,
      spendCaps: effectiveCaps
    };
    return { decision: "allow", reason: "version_mismatch_narrower_wins", effectiveSnapshot };
  }
  return { decision: "allow", effectiveSnapshot: storedSnapshot };
}

// src/capabilities/tasks/index.ts
var CREATE_TASK_TOOL = { name: "create_task", minTrustLevel: 3 };
var LIST_TASKS_TOOL = { name: "list_tasks", minTrustLevel: 2 };
var DELETE_TASK_TOOL = { name: "delete_task", minTrustLevel: 3 };
var PAUSE_TASK_TOOL = { name: "pause_task", minTrustLevel: 3 };
var TASK_TOOLS = {
  create_task: CREATE_TASK_TOOL,
  list_tasks: LIST_TASKS_TOOL,
  delete_task: DELETE_TASK_TOOL,
  pause_task: PAUSE_TASK_TOOL
};
var activeJobs = /* @__PURE__ */ new Map();
async function fireTask(label) {
  const db = openDb();
  const row = db.prepare("SELECT * FROM scheduled_tasks WHERE label = ? AND status = ?").get(label, "active");
  if (!row) return;
  let config;
  try {
    config = readConfig();
  } catch {
    config = {};
  }
  const registryUrl = config.registryUrl ?? "http://localhost:8000";
  const storedSnapshot = JSON.parse(row.permission_snapshot);
  const validation = await validateTaskPassport(
    row.passport_id,
    row.passport_version,
    storedSnapshot,
    registryUrl
  );
  if (validation.decision === "deny") {
    db.prepare(
      "UPDATE scheduled_tasks SET last_fired_at = ?, last_fire_status = ? WHERE label = ?"
    ).run((/* @__PURE__ */ new Date()).toISOString(), `skipped_${validation.reason ?? "revoked"}`, label);
    console.warn(`[tasks] skipping task '${label}': ${validation.reason}`);
    return;
  }
  db.prepare(
    "UPDATE scheduled_tasks SET last_fired_at = ?, last_fire_status = ? WHERE label = ?"
  ).run((/* @__PURE__ */ new Date()).toISOString(), "success", label);
}
function loadActiveTasks() {
  const db = openDb();
  const rows = db.prepare("SELECT * FROM scheduled_tasks WHERE status = 'active'").all();
  for (const row of rows) {
    if (!cron.validate(row.cron_expression)) {
      console.warn(`[tasks] invalid cron expression for task '${row.label}': ${row.cron_expression}`);
      continue;
    }
    const job = cron.schedule(row.cron_expression, () => {
      fireTask(row.label).catch((err) => {
        console.error(
          `[tasks] error firing task '${row.label}':`,
          err instanceof Error ? err.message : String(err)
        );
      });
    });
    activeJobs.set(row.label, job);
  }
}
async function createTask(params, claims) {
  enforceTrust(claims, CREATE_TASK_TOOL);
  if (!cron.validate(params.cron_expression)) {
    throw new Error(`Invalid cron expression: ${params.cron_expression}`);
  }
  const label = params.label ?? `task-${randomUUID4().slice(0, 8)}`;
  const db = openDb();
  db.prepare(`
    INSERT INTO scheduled_tasks
      (label, cron_expression, tool_name, tool_args, passport_id, passport_version,
       permission_snapshot, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(
    label,
    params.cron_expression,
    params.tool_name,
    JSON.stringify(params.tool_args ?? {}),
    params.passport_id,
    params.passport_version,
    JSON.stringify(params.permission_snapshot),
    (/* @__PURE__ */ new Date()).toISOString()
  );
  const job = cron.schedule(params.cron_expression, () => {
    fireTask(label).catch((err) => {
      console.error(
        `[tasks] error firing task '${label}':`,
        err instanceof Error ? err.message : String(err)
      );
    });
  });
  activeJobs.set(label, job);
  return { label, cron_expression: params.cron_expression, status: "active" };
}
async function listTasks(_params, claims) {
  enforceTrust(claims, LIST_TASKS_TOOL);
  const db = openDb();
  const rows = db.prepare("SELECT * FROM scheduled_tasks WHERE status != 'deleted' ORDER BY created_at ASC").all();
  return {
    tasks: rows.map(({ id: _id, ...rest }) => rest)
  };
}
async function deleteTask(params, claims) {
  enforceTrust(claims, DELETE_TASK_TOOL);
  const job = activeJobs.get(params.label);
  if (job) {
    job.stop();
    activeJobs.delete(params.label);
  }
  const db = openDb();
  const result = db.prepare("UPDATE scheduled_tasks SET status = 'deleted' WHERE label = ?").run(params.label);
  return { label: params.label, deleted: result.changes > 0 };
}
async function pauseTask(params, claims) {
  enforceTrust(claims, PAUSE_TASK_TOOL);
  const job = activeJobs.get(params.label);
  if (job) {
    job.stop();
  }
  const db = openDb();
  const result = db.prepare("UPDATE scheduled_tasks SET status = 'paused' WHERE label = ? AND status = 'active'").run(params.label);
  return { label: params.label, paused: result.changes > 0 };
}

// src/capabilities/docker/index.ts
import Docker from "dockerode";
var RUN_CONTAINER_TOOL = { name: "run_container", minTrustLevel: 4 };
var STOP_CONTAINER_TOOL = { name: "stop_container", minTrustLevel: 4 };
var REMOVE_CONTAINER_TOOL = { name: "remove_container", minTrustLevel: 4 };
var LIST_CONTAINERS_TOOL = { name: "list_containers", minTrustLevel: 2 };
var CONTAINER_LOGS_TOOL = { name: "container_logs", minTrustLevel: 2 };
var EXEC_IN_CONTAINER_TOOL = { name: "exec_in_container", minTrustLevel: 4 };
var DOCKER_TOOLS = {
  run_container: RUN_CONTAINER_TOOL,
  stop_container: STOP_CONTAINER_TOOL,
  remove_container: REMOVE_CONTAINER_TOOL,
  list_containers: LIST_CONTAINERS_TOOL,
  container_logs: CONTAINER_LOGS_TOOL,
  exec_in_container: EXEC_IN_CONTAINER_TOOL
};
function getDocker() {
  return new Docker();
}
async function runContainer(params, claims) {
  enforceTrust(claims, RUN_CONTAINER_TOOL);
  const docker = getDocker();
  const exposedPorts = {};
  const portBindings = {};
  if (params.ports) {
    for (const [containerPort, hostPort] of Object.entries(params.ports)) {
      const key = containerPort.includes("/") ? containerPort : `${containerPort}/tcp`;
      exposedPorts[key] = {};
      portBindings[key] = [{ HostPort: hostPort }];
    }
  }
  const container = await docker.createContainer({
    Image: params.image,
    name: params.name,
    Env: params.env,
    ExposedPorts: exposedPorts,
    HostConfig: {
      PortBindings: portBindings
    }
  });
  await container.start();
  const info = await container.inspect();
  return {
    id: container.id,
    name: info.Name.replace(/^\//, ""),
    image: params.image,
    status: info.State.Status
  };
}
async function stopContainer(params, claims) {
  enforceTrust(claims, STOP_CONTAINER_TOOL);
  const docker = getDocker();
  const container = docker.getContainer(params.id);
  await container.stop();
  return { id: params.id, stopped: true };
}
async function removeContainer(params, claims) {
  enforceTrust(claims, REMOVE_CONTAINER_TOOL);
  const docker = getDocker();
  const container = docker.getContainer(params.id);
  await container.remove({ force: params.force ?? false });
  return { id: params.id, removed: true };
}
async function listContainers(params, claims) {
  enforceTrust(claims, LIST_CONTAINERS_TOOL);
  const docker = getDocker();
  const containers = await docker.listContainers({ all: params.all ?? false });
  return { containers };
}
async function containerLogs(params, claims) {
  enforceTrust(claims, CONTAINER_LOGS_TOOL);
  const docker = getDocker();
  const container = docker.getContainer(params.id);
  const logsBuffer = await container.logs({
    stdout: true,
    stderr: true,
    tail: params.tail ?? 100
  });
  const logs = typeof logsBuffer === "string" ? logsBuffer : logsBuffer.toString("utf8");
  return { id: params.id, logs };
}
async function execInContainer(params, claims) {
  enforceTrust(claims, EXEC_IN_CONTAINER_TOOL);
  const docker = getDocker();
  const container = docker.getContainer(params.id);
  const exec = await container.exec({
    Cmd: params.command,
    AttachStdout: true,
    AttachStderr: true
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  const output = await new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
  const inspectResult = await exec.inspect();
  const exitCode = inspectResult.ExitCode ?? -1;
  return { id: params.id, output, exit_code: exitCode };
}

// src/capabilities/phone-jmp/index.ts
var PROVISION_JMP_TOOL = { name: "provision_phone_number_jmp", minTrustLevel: 3 };
var SEND_SMS_JMP_TOOL = { name: "send_sms_jmp", minTrustLevel: 3 };
var READ_SMS_JMP_TOOL = { name: "read_sms_jmp", minTrustLevel: 2 };
var RELEASE_JMP_TOOL = { name: "release_phone_number_jmp", minTrustLevel: 3 };
var PHONE_JMP_TOOLS = {
  provision_phone_number_jmp: PROVISION_JMP_TOOL,
  send_sms_jmp: SEND_SMS_JMP_TOOL,
  read_sms_jmp: READ_SMS_JMP_TOOL,
  release_phone_number_jmp: RELEASE_JMP_TOOL
};
var inboundMessages = /* @__PURE__ */ new Map();
var xmppConn = null;
function getXmppCredentials() {
  const jid = process.env["XMPP_JID"];
  const password = process.env["XMPP_PASSWORD"];
  if (!jid || !password) {
    throw new SecretsError(
      'XMPP_JID and XMPP_PASSWORD environment variables are required for JMP phone. Run "hands-and-feet init" and configure JMP.'
    );
  }
  return { jid, password };
}
async function getXmppClient() {
  if (xmppConn) return xmppConn;
  const { jid, password } = getXmppCredentials();
  const { client: xmppClient, xml } = await import("@xmpp/client");
  const xmpp = xmppClient({
    service: "xmpp://xmpp.jmp.chat",
    domain: "jmp.chat",
    resource: "hands-and-feet",
    username: jid.split("@")[0],
    password
  });
  xmpp.on("stanza", (stanza) => {
    const s = stanza;
    if (!s.is("message")) return;
    const from = s.attrs.from ?? "";
    if (!from.includes("jmp.chat")) return;
    const body = s.getChildText("body");
    if (!body) return;
    const bareFrom = from.split("/")[0];
    const msgs = inboundMessages.get(bareFrom) ?? [];
    msgs.push({ from: bareFrom, body, received_at: (/* @__PURE__ */ new Date()).toISOString() });
    inboundMessages.set(bareFrom, msgs);
  });
  await xmpp.start();
  xmppConn = xmpp;
  xmppConn["_xml"] = xml;
  return xmpp;
}
async function provisionPhoneNumberJmp(params, claims) {
  enforceTrust(claims, PROVISION_JMP_TOOL);
  const xmpp = await getXmppClient();
  const { xml } = await import("@xmpp/client");
  const areaCode = params.area_code ?? "555";
  const gateway = `+1${areaCode}0000000@inum.net`;
  await xmpp.send(
    xml("message", { to: gateway, type: "chat" }, xml("body", {}, `PROVISION ${areaCode}`))
  );
  return {
    message: `Provisioning request sent to JMP gateway for area code ${areaCode}. Check read_sms_jmp for confirmation.`,
    gateway
  };
}
async function sendSmsJmp(params, claims) {
  enforceTrust(claims, SEND_SMS_JMP_TOOL);
  const xmpp = await getXmppClient();
  const { xml } = await import("@xmpp/client");
  const to = params.to.includes("@") ? params.to : `${params.to}@jmp.chat`;
  await xmpp.send(
    xml("message", { to, type: "chat" }, xml("body", {}, params.message))
  );
  return { sent: true, to };
}
async function readSmsJmp(params, claims) {
  enforceTrust(claims, READ_SMS_JMP_TOOL);
  await getXmppClient();
  const limit = params.limit ?? 20;
  let messages;
  if (params.number) {
    const bareNumber = params.number.includes("@") ? params.number.split("/")[0] : `${params.number}@jmp.chat`;
    messages = (inboundMessages.get(bareNumber) ?? []).slice(-limit);
  } else {
    const all = [];
    for (const msgs of inboundMessages.values()) {
      all.push(...msgs);
    }
    messages = all.sort((a, b) => a.received_at.localeCompare(b.received_at)).slice(-limit);
  }
  return { messages, count: messages.length };
}
async function releasePhoneNumberJmp(params, claims) {
  enforceTrust(claims, RELEASE_JMP_TOOL);
  const xmpp = await getXmppClient();
  const { xml } = await import("@xmpp/client");
  const gateway = `${params.number}@inum.net`;
  await xmpp.send(
    xml("message", { to: gateway, type: "chat" }, xml("body", {}, `RELEASE ${params.number}`))
  );
  const bareNumber = params.number.includes("@") ? params.number.split("/")[0] : `${params.number}@jmp.chat`;
  inboundMessages.delete(bareNumber);
  return { released: true, number: params.number };
}
async function startXmppIfConfigured() {
  if (!process.env["XMPP_JID"] || !process.env["XMPP_PASSWORD"]) return;
  try {
    await getXmppClient();
  } catch (err) {
    console.error("JMP XMPP connection failed:", err instanceof Error ? err.message : String(err));
  }
}

// src/capabilities/github/index.ts
import { Octokit } from "@octokit/rest";
var CREATE_REPO_TOOL = { name: "create_repo", minTrustLevel: 3 };
var CREATE_FILE_TOOL = { name: "create_file", minTrustLevel: 3 };
var CREATE_PULL_REQUEST_TOOL = { name: "create_pull_request", minTrustLevel: 3 };
var LIST_REPOS_TOOL = { name: "list_repos", minTrustLevel: 2 };
var GITHUB_TOOLS = {
  create_repo: CREATE_REPO_TOOL,
  create_file: CREATE_FILE_TOOL,
  create_pull_request: CREATE_PULL_REQUEST_TOOL,
  list_repos: LIST_REPOS_TOOL
};
function getOctokit() {
  const token = process.env["GITHUB_TOKEN"];
  if (!token) {
    throw new SecretsError("GITHUB_TOKEN env var not set. Run: hands-and-feet init");
  }
  return new Octokit({ auth: token });
}
function getDefaultOwner() {
  try {
    const cfg = readConfig();
    return cfg.capabilities.github?.defaultOwner;
  } catch {
    return void 0;
  }
}
async function createRepo(params, claims) {
  enforceTrust(claims, CREATE_REPO_TOOL);
  const octokit = getOctokit();
  const { data } = await octokit.rest.repos.createForAuthenticatedUser({
    name: params.name,
    private: params.private ?? false,
    description: params.description
  });
  return {
    id: data.id,
    name: data.name,
    full_name: data.full_name,
    url: data.html_url,
    private: data.private
  };
}
async function createFile(params, claims) {
  enforceTrust(claims, CREATE_FILE_TOOL);
  const octokit = getOctokit();
  const owner = params.owner ?? getDefaultOwner();
  if (!owner) {
    throw new Error("owner is required \u2014 set via params or configure capabilities.github.defaultOwner");
  }
  const { data } = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo: params.repo,
    path: params.path,
    message: params.message,
    content: Buffer.from(params.content).toString("base64"),
    branch: params.branch
  });
  return {
    sha: data.content?.sha ?? "",
    url: data.content?.html_url ?? ""
  };
}
async function createPullRequest(params, claims) {
  enforceTrust(claims, CREATE_PULL_REQUEST_TOOL);
  const octokit = getOctokit();
  const owner = params.owner ?? getDefaultOwner();
  if (!owner) {
    throw new Error("owner is required \u2014 set via params or configure capabilities.github.defaultOwner");
  }
  const { data } = await octokit.rest.pulls.create({
    owner,
    repo: params.repo,
    title: params.title,
    body: params.body,
    head: params.head,
    base: params.base
  });
  return {
    number: data.number,
    url: data.html_url,
    state: data.state
  };
}
async function listRepos(params, claims) {
  enforceTrust(claims, LIST_REPOS_TOOL);
  const octokit = getOctokit();
  const { data } = await octokit.rest.repos.listForAuthenticatedUser({
    type: params.type ?? "all",
    per_page: params.per_page ?? 30
  });
  return {
    repos: data.map((r) => ({
      id: r.id,
      name: r.name,
      full_name: r.full_name,
      private: r.private,
      url: r.html_url
    }))
  };
}

// src/capabilities/ipfs/index.ts
import { create as ipfsCreate } from "kubo-rpc-client";
var PUBLISH_CONTENT_TOOL = { name: "publish_content", minTrustLevel: 3 };
var GET_IPFS_CONTENT_TOOL = { name: "get_ipfs_content", minTrustLevel: 2 };
var PIN_CONTENT_TOOL = { name: "pin_content", minTrustLevel: 3 };
var IPFS_TOOLS = {
  publish_content: PUBLISH_CONTENT_TOOL,
  get_ipfs_content: GET_IPFS_CONTENT_TOOL,
  pin_content: PIN_CONTENT_TOOL
};
var Web3StorageFallback = class {
  token;
  baseUrl = "https://api.web3.storage";
  constructor() {
    const token = process.env["WEB3_STORAGE_TOKEN"];
    if (!token) {
      throw new SecretsError(
        "WEB3_STORAGE_TOKEN env var not set. Required when IPFS_API_URL is unavailable."
      );
    }
    this.token = token;
  }
  async add(content) {
    const response = await fetch(`${this.baseUrl}/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/octet-stream"
      },
      body: Buffer.from(content)
    });
    if (!response.ok) {
      throw new Error(`web3.storage upload failed: ${response.status} ${response.statusText}`);
    }
    const json = await response.json();
    return { cid: json.cid };
  }
  async cat(cid) {
    const response = await fetch(`https://${cid}.ipfs.dweb.link/`);
    if (!response.ok) {
      throw new Error(`web3.storage fetch failed: ${response.status} ${response.statusText}`);
    }
    return response.text();
  }
  async pin(_cid) {
  }
};
function getIpfsClient() {
  const apiUrl = process.env["IPFS_API_URL"] ?? "http://localhost:5001";
  if (apiUrl === "web3storage") {
    throw new Error("Use Web3StorageFallback directly for web3storage");
  }
  return ipfsCreate({ url: apiUrl });
}
async function publishContent(params, claims) {
  enforceTrust(claims, PUBLISH_CONTENT_TOOL);
  const apiUrl = process.env["IPFS_API_URL"] ?? "http://localhost:5001";
  if (apiUrl === "web3storage") {
    const fallback = new Web3StorageFallback();
    const result2 = await fallback.add(Buffer.from(params.content));
    return { cid: result2.cid };
  }
  const client = getIpfsClient();
  const result = await client.add(Buffer.from(params.content));
  return { cid: result.cid.toString() };
}
async function getIpfsContent(params, claims) {
  enforceTrust(claims, GET_IPFS_CONTENT_TOOL);
  const apiUrl = process.env["IPFS_API_URL"] ?? "http://localhost:5001";
  if (apiUrl === "web3storage") {
    const fallback = new Web3StorageFallback();
    const content2 = await fallback.cat(params.cid);
    return { content: content2, cid: params.cid };
  }
  const client = getIpfsClient();
  const chunks = [];
  for await (const chunk of client.cat(params.cid)) {
    chunks.push(chunk);
  }
  const content = Buffer.concat(chunks).toString("utf8");
  return { content, cid: params.cid };
}
async function pinContent(params, claims) {
  enforceTrust(claims, PIN_CONTENT_TOOL);
  const apiUrl = process.env["IPFS_API_URL"] ?? "http://localhost:5001";
  if (apiUrl === "web3storage") {
    const fallback = new Web3StorageFallback();
    await fallback.pin(params.cid);
    return { cid: params.cid, pinned: true };
  }
  const client = getIpfsClient();
  await client.pin.add(params.cid);
  return { cid: params.cid, pinned: true };
}

// src/capabilities/rss/index.ts
import RSS from "rss";
var CREATE_FEED_TOOL = { name: "create_feed", minTrustLevel: 3 };
var ADD_FEED_ITEM_TOOL = { name: "add_feed_item", minTrustLevel: 3 };
var SERVE_FEED_TOOL = { name: "serve_feed", minTrustLevel: 3 };
var RSS_TOOLS = {
  create_feed: CREATE_FEED_TOOL,
  add_feed_item: ADD_FEED_ITEM_TOOL,
  serve_feed: SERVE_FEED_TOOL
};
function registerRssRoutes(app) {
  app.get("/feeds/:label", (req, res) => {
    const db = openDb();
    const feed = db.prepare("SELECT * FROM rss_feeds WHERE label = ?").get(req.params["label"]);
    if (!feed) {
      res.status(404).send("Feed not found");
      return;
    }
    const items = db.prepare("SELECT * FROM rss_items WHERE feed_label = ? ORDER BY date DESC").all(req.params["label"]);
    const rssFeed = new RSS({
      title: feed.title,
      description: feed.description,
      feed_url: req.url,
      site_url: feed.link
    });
    for (const item of items) {
      rssFeed.item({
        title: item.title,
        description: item.description,
        url: item.url ?? feed.link,
        guid: item.guid ?? String(item.id),
        date: item.date
      });
    }
    res.set("Content-Type", "application/rss+xml");
    res.send(rssFeed.xml({ indent: true }));
  });
}
async function createFeed(params, claims) {
  enforceTrust(claims, CREATE_FEED_TOOL);
  const db = openDb();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  db.prepare(`
    INSERT INTO rss_feeds (label, title, description, link, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(params.label, params.title, params.description, params.link, now);
  return {
    label: params.label,
    feedUrl: `/feeds/${params.label}`
  };
}
async function addFeedItem(params, claims) {
  enforceTrust(claims, ADD_FEED_ITEM_TOOL);
  const db = openDb();
  const feed = db.prepare("SELECT label FROM rss_feeds WHERE label = ?").get(params.feed_label);
  if (!feed) {
    throw new Error(`Feed '${params.feed_label}' not found. Create it with create_feed first.`);
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  db.prepare(`
    INSERT INTO rss_items (feed_label, title, description, url, guid, date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    params.feed_label,
    params.title,
    params.description,
    params.url ?? null,
    params.guid ?? null,
    now
  );
  return {
    feed_label: params.feed_label,
    title: params.title,
    date: now
  };
}
async function serveFeed(params, claims) {
  enforceTrust(claims, SERVE_FEED_TOOL);
  const db = openDb();
  const feed = db.prepare("SELECT label FROM rss_feeds WHERE label = ?").get(params.label);
  if (!feed) {
    throw new Error(`Feed '${params.label}' not found.`);
  }
  const feedPath = `/feeds/${params.label}`;
  const tunnel = db.prepare(`SELECT url FROM tunnels WHERE closed_at IS NULL ORDER BY created_at DESC LIMIT 1`).get();
  if (tunnel?.url) {
    return {
      label: params.label,
      feedUrl: feedPath,
      publicUrl: `${tunnel.url}${feedPath}`
    };
  }
  return {
    label: params.label,
    feedUrl: feedPath
  };
}

// src/capabilities/mail/index.ts
var LIST_MAIL_TOOL = { name: "list_mail", minTrustLevel: 2 };
var FORWARD_MAIL_TOOL = { name: "forward_mail", minTrustLevel: 3 };
var SHRED_MAIL_TOOL = { name: "shred_mail", minTrustLevel: 3 };
var SCAN_MAIL_TOOL = { name: "scan_mail", minTrustLevel: 3 };
var MAIL_TOOLS = {
  list_mail: LIST_MAIL_TOOL,
  forward_mail: FORWARD_MAIL_TOOL,
  shred_mail: SHRED_MAIL_TOOL,
  scan_mail: SCAN_MAIL_TOOL
};
var POSTSCAN_BASE = "https://api.postscanmail.com/2.0";
var EARTH_CLASS_BASE = "https://api.earthclassmail.com/v1";
function getMailCredentials() {
  const apiKey = process.env["POSTSCAN_API_KEY"];
  const accountId = process.env["POSTSCAN_ACCOUNT_ID"];
  if (apiKey && accountId) {
    return { apiKey, accountId, provider: "postscan" };
  }
  const ecApiKey = process.env["EARTH_CLASS_MAIL_API_KEY"];
  const ecAccountId = process.env["EARTH_CLASS_MAIL_ACCOUNT_ID"] ?? "default";
  if (ecApiKey) {
    return { apiKey: ecApiKey, accountId: ecAccountId, provider: "earthclass" };
  }
  throw new SecretsError(
    "POSTSCAN_API_KEY and POSTSCAN_ACCOUNT_ID env vars required. Run: hands-and-feet init --i-understand-form-1583\nAlternatively set EARTH_CLASS_MAIL_API_KEY for Earth Class Mail."
  );
}
var EarthClassMailClient = class {
  apiKey;
  accountId;
  constructor(apiKey, accountId) {
    this.apiKey = apiKey;
    this.accountId = accountId;
  }
  get authHeader() {
    return "Basic " + Buffer.from(`${this.apiKey}:${this.accountId}`).toString("base64");
  }
  async listMail(limit = 20, status) {
    const url = new URL(`${EARTH_CLASS_BASE}/mailboxes/${this.accountId}/mail`);
    url.searchParams.set("limit", String(limit));
    if (status) url.searchParams.set("status", status);
    const res = await fetch(url.toString(), {
      headers: { Authorization: this.authHeader }
    });
    if (!res.ok) throw new Error(`Earth Class Mail API error: ${res.status} ${res.statusText}`);
    return res.json();
  }
  async forwardMail(mailId, address) {
    const res = await fetch(`${EARTH_CLASS_BASE}/mail/${mailId}/forward`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ to_address: address })
    });
    if (!res.ok) throw new Error(`Earth Class Mail API error: ${res.status} ${res.statusText}`);
    return res.json();
  }
  async shredMail(mailId) {
    const res = await fetch(`${EARTH_CLASS_BASE}/mail/${mailId}/shred`, {
      method: "POST",
      headers: { Authorization: this.authHeader }
    });
    if (!res.ok) throw new Error(`Earth Class Mail API error: ${res.status} ${res.statusText}`);
    return res.json();
  }
  async scanMail(mailId) {
    const res = await fetch(`${EARTH_CLASS_BASE}/mail/${mailId}/scan`, {
      method: "POST",
      headers: { Authorization: this.authHeader }
    });
    if (!res.ok) throw new Error(`Earth Class Mail API error: ${res.status} ${res.statusText}`);
    return res.json();
  }
};
function makeAuthHeader(apiKey, accountId) {
  return "Basic " + Buffer.from(`${apiKey}:${accountId}`).toString("base64");
}
async function listMail(params, claims) {
  enforceTrust(claims, LIST_MAIL_TOOL);
  const creds = getMailCredentials();
  if (creds.provider === "earthclass") {
    const client = new EarthClassMailClient(creds.apiKey, creds.accountId);
    const mail2 = await client.listMail(params.limit ?? 20, params.status);
    return { mail: mail2 };
  }
  const url = new URL(`${POSTSCAN_BASE}/accounts/${creds.accountId}/mail`);
  if (params.limit) url.searchParams.set("limit", String(params.limit));
  if (params.status) url.searchParams.set("status", params.status);
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: makeAuthHeader(creds.apiKey, creds.accountId)
    }
  });
  if (!res.ok) {
    throw new Error(`PostScan Mail API error: ${res.status} ${res.statusText}`);
  }
  const mail = await res.json();
  return { mail };
}
async function forwardMail(params, claims) {
  enforceTrust(claims, FORWARD_MAIL_TOOL);
  const creds = getMailCredentials();
  if (creds.provider === "earthclass") {
    const client = new EarthClassMailClient(creds.apiKey, creds.accountId);
    await client.forwardMail(params.mail_id, params.address);
    return { mail_id: params.mail_id, forwarded: true, address: params.address };
  }
  const res = await fetch(`${POSTSCAN_BASE}/mail/${params.mail_id}/forward`, {
    method: "POST",
    headers: {
      Authorization: makeAuthHeader(creds.apiKey, creds.accountId),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ to_address: params.address })
  });
  if (!res.ok) {
    throw new Error(`PostScan Mail API error: ${res.status} ${res.statusText}`);
  }
  return { mail_id: params.mail_id, forwarded: true, address: params.address };
}
async function shredMail(params, claims) {
  enforceTrust(claims, SHRED_MAIL_TOOL);
  const creds = getMailCredentials();
  if (creds.provider === "earthclass") {
    const client = new EarthClassMailClient(creds.apiKey, creds.accountId);
    await client.shredMail(params.mail_id);
    return { mail_id: params.mail_id, shredded: true };
  }
  const res = await fetch(`${POSTSCAN_BASE}/mail/${params.mail_id}/shred`, {
    method: "POST",
    headers: {
      Authorization: makeAuthHeader(creds.apiKey, creds.accountId)
    }
  });
  if (!res.ok) {
    throw new Error(`PostScan Mail API error: ${res.status} ${res.statusText}`);
  }
  return { mail_id: params.mail_id, shredded: true };
}
async function scanMail(params, claims) {
  enforceTrust(claims, SCAN_MAIL_TOOL);
  const creds = getMailCredentials();
  if (creds.provider === "earthclass") {
    const client = new EarthClassMailClient(creds.apiKey, creds.accountId);
    await client.scanMail(params.mail_id);
    return { mail_id: params.mail_id, scan_requested: true };
  }
  const res = await fetch(`${POSTSCAN_BASE}/mail/${params.mail_id}/scan`, {
    method: "POST",
    headers: {
      Authorization: makeAuthHeader(creds.apiKey, creds.accountId)
    }
  });
  if (!res.ok) {
    throw new Error(`PostScan Mail API error: ${res.status} ${res.statusText}`);
  }
  return { mail_id: params.mail_id, scan_requested: true };
}

// src/server.ts
function createMcpServer(claims) {
  const server = new Server(
    { name: "hands-and-feet", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      // Notify
      {
        name: NOTIFY_TOOL.name,
        description: NOTIFY_TOOL.description,
        inputSchema: NOTIFY_TOOL.inputSchema
      },
      // Wallet tools
      {
        name: WALLET_TOOLS.create_wallet.name,
        description: "Generates a new EVM wallet (Base default, or Polygon) and stores it in the encrypted keystore.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string", description: "Human-readable wallet label (auto-generated if omitted)" },
            chain: { type: "string", enum: ["base", "polygon"], description: "Chain to use (default: base)" }
          }
        }
      },
      {
        name: WALLET_TOOLS.get_address.name,
        description: "Returns the public address for a stored wallet.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string", description: "Wallet label" }
          },
          required: ["label"]
        }
      },
      {
        name: WALLET_TOOLS.get_balance.name,
        description: "Returns native token (ETH/MATIC) and USDC balance for a wallet.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string", description: "Wallet label" },
            token: { type: "string", enum: ["ETH", "MATIC", "USDC"], description: "Token to query" },
            chain: { type: "string", enum: ["base", "polygon"], description: "Chain to query" }
          },
          required: ["label"]
        }
      },
      {
        name: WALLET_TOOLS.send_usdc.name,
        description: "Transfers USDC on Base or Polygon. Subject to per-call and daily spend caps.",
        inputSchema: {
          type: "object",
          properties: {
            from_label: { type: "string", description: "Source wallet label" },
            to_address: { type: "string", description: "Destination address (0x-prefixed)" },
            amount: { type: "number", description: "Amount in USDC (e.g. 10.5 = $10.50)" },
            chain: { type: "string", enum: ["base", "polygon"], description: "Chain to use (default: base)" }
          },
          required: ["from_label", "to_address", "amount"]
        }
      },
      {
        name: WALLET_TOOLS.sign_message.name,
        description: "Signs a plain text message with the wallet private key.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string", description: "Wallet label" },
            text: { type: "string", description: "Plain UTF-8 text to sign" }
          },
          required: ["label", "text"]
        }
      },
      {
        name: WALLET_TOOLS.sign_typed_data.name,
        description: "Signs EIP-712 typed data. First-use of any new domain/primaryType pair is always rejected.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string", description: "Wallet label" },
            domain: { type: "object", description: "EIP-712 domain object" },
            types: { type: "object", description: "EIP-712 types object" },
            value: { type: "object", description: "EIP-712 value object" }
          },
          required: ["label", "domain", "types", "value"]
        }
      },
      // Bridge tools
      {
        name: BRIDGE_TOOLS.bridge_to_polygon.name,
        description: "Initiates a USDC bridge from Base to Polygon (Across Protocol \u2014 integration pending). Returns bridge_id for polling.",
        inputSchema: {
          type: "object",
          properties: {
            from_label: { type: "string", description: "Source wallet label (Base)" },
            amount: { type: "number", description: "Amount in USDC to bridge" }
          },
          required: ["from_label", "amount"]
        }
      },
      {
        name: BRIDGE_TOOLS.bridge_to_base.name,
        description: "Initiates a USDC bridge from Polygon to Base (Across Protocol \u2014 integration pending). Returns bridge_id for polling.",
        inputSchema: {
          type: "object",
          properties: {
            from_label: { type: "string", description: "Source wallet label (Polygon)" },
            amount: { type: "number", description: "Amount in USDC to bridge" }
          },
          required: ["from_label", "amount"]
        }
      },
      {
        name: BRIDGE_TOOLS.get_bridge_status.name,
        description: "Returns status of a bridge operation: pending | locked | in-flight | minted | stuck | failed.",
        inputSchema: {
          type: "object",
          properties: {
            bridge_id: { type: "string", description: "Bridge ID returned by bridge_to_polygon or bridge_to_base" }
          },
          required: ["bridge_id"]
        }
      },
      // Payment tools
      {
        name: PAYMENT_TOOLS.pay_with_usdc.name,
        description: "Executes a USDC payment on Base (OpenTrust payments are always on Base).",
        inputSchema: {
          type: "object",
          properties: {
            from_label: { type: "string", description: "Source wallet label" },
            to_address: { type: "string", description: "Destination address (0x-prefixed)" },
            amount: { type: "number", description: "Amount in USDC" },
            memo: { type: "string", description: "Optional payment memo" }
          },
          required: ["from_label", "to_address", "amount"]
        }
      },
      {
        name: PAYMENT_TOOLS.get_payment_status.name,
        description: "Returns confirmation status of a Base transaction by hash.",
        inputSchema: {
          type: "object",
          properties: {
            tx_hash: { type: "string", description: "Transaction hash (0x-prefixed)" }
          },
          required: ["tx_hash"]
        }
      },
      {
        name: PAYMENT_TOOLS.prepare_payment.name,
        description: "Checks Base balance, bridges from Polygon if needed, then executes a USDC payment on Base in one step.",
        inputSchema: {
          type: "object",
          required: ["from_label", "to_address", "amount_usdc"],
          properties: {
            from_label: { type: "string", description: "Wallet label to send from" },
            to_address: { type: "string", description: "Recipient wallet address (0x...)" },
            amount_usdc: { type: "number", description: "Amount of USDC to send" },
            memo: { type: "string", description: "Optional payment memo" },
            bridge_if_needed: { type: "boolean", description: "Bridge from Polygon if balance insufficient (default true)" },
            bridge_timeout_ms: { type: "number", description: "Bridge polling timeout in milliseconds (default 120000)" },
            bridge_poll_interval_ms: { type: "number", description: "Bridge polling interval in milliseconds (default 5000)" }
          }
        }
      },
      // Card tools
      {
        name: CARD_TOOLS.create_virtual_card.name,
        description: "Issues a Moon X (reloadable) or Moon 1X (single-fund) virtual Visa card. Requires L4 trust.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string", description: "Human-readable label for the card (defaults to card ID)" },
            product: { type: "string", enum: ["moon_x", "moon_1x"], description: "Card product: moon_x (reloadable) or moon_1x (single-fund)" },
            amount: { type: "number", description: "Initial funding amount in USD (optional)" }
          }
        }
      },
      {
        name: CARD_TOOLS.get_card_details.name,
        description: "Returns card number, CVV, and expiry for a Moon virtual card.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string", description: "Card label or card ID" }
          },
          required: ["label"]
        }
      },
      {
        name: CARD_TOOLS.add_funds_to_card.name,
        description: "Loads funds from Moon Credit balance onto a Moon X reloadable card. Requires L4 trust.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string", description: "Card label or card ID" },
            amount: { type: "number", description: "Amount in USD to add" }
          },
          required: ["label", "amount"]
        }
      },
      {
        name: CARD_TOOLS.top_up_moon_credit.name,
        description: `Returns Moon's USDC-Polygon deposit address so you can send USDC to top up Moon Credit. Use send_usdc with chain:"polygon" to the returned address. Requires L4 trust.`,
        inputSchema: {
          type: "object",
          properties: {
            amount: { type: "number", description: "Amount in USDC to top up" }
          },
          required: ["amount"]
        }
      },
      {
        name: CARD_TOOLS.freeze_card.name,
        description: "Freezes a Moon virtual card, blocking new transactions.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string", description: "Card label or card ID" }
          },
          required: ["label"]
        }
      },
      {
        name: CARD_TOOLS.delete_card.name,
        description: "Permanently deletes a Moon virtual card.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string", description: "Card label or card ID" }
          },
          required: ["label"]
        }
      },
      {
        name: CARD_TOOLS.get_card_transactions.name,
        description: "Returns transaction history for a Moon virtual card.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string", description: "Card label or card ID" },
            limit: { type: "number", description: "Maximum number of transactions to return (default: 10)" }
          },
          required: ["label"]
        }
      },
      // Phone tools
      {
        name: PHONE_TOOLS.provision_phone_number.name,
        description: "Provisions a phone number via the configured provider (Twilio or SignalWire). Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            area_code: { type: "string", description: "US area code to request (optional)" }
          }
        }
      },
      {
        name: PHONE_TOOLS.send_sms.name,
        description: "Sends an SMS from a provisioned number. Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            from_number: { type: "string", description: "Provisioned phone number to send from" },
            to: { type: "string", description: "Destination phone number (E.164 format, e.g. +12025551234)" },
            message: { type: "string", description: "SMS message body" }
          },
          required: ["from_number", "to", "message"]
        }
      },
      {
        name: PHONE_TOOLS.read_sms.name,
        description: "Fetches inbound SMS messages for a provisioned number and upserts them to local DB. Requires L2 trust.",
        inputSchema: {
          type: "object",
          properties: {
            number: { type: "string", description: "Provisioned phone number to read messages for" },
            limit: { type: "number", description: "Maximum number of messages to return (default: 20)" }
          },
          required: ["number"]
        }
      },
      {
        name: PHONE_TOOLS.release_phone_number.name,
        description: "Releases a provisioned phone number back to the provider. Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            number: { type: "string", description: "Phone number to release" }
          },
          required: ["number"]
        }
      },
      // Email tools
      {
        name: EMAIL_TOOLS.create_mailbox.name,
        description: "Creates a new mailbox for receiving email. Requires L2 trust.",
        inputSchema: {
          type: "object",
          properties: {
            address: { type: "string", description: "Email address for the mailbox" }
          },
          required: ["address"]
        }
      },
      {
        name: EMAIL_TOOLS.send_email.name,
        description: "Sends an email via the configured transport (local, Postmark, or Resend). Requires L2 trust.",
        inputSchema: {
          type: "object",
          properties: {
            from: { type: "string", description: "Sender email address" },
            to: { type: "string", description: "Recipient email address" },
            subject: { type: "string", description: "Email subject" },
            body: { type: "string", description: "Plain-text body" },
            html: { type: "string", description: "Optional HTML body" }
          },
          required: ["from", "to", "subject", "body"]
        }
      },
      {
        name: EMAIL_TOOLS.read_inbox.name,
        description: "Returns messages in a mailbox. Requires L2 trust.",
        inputSchema: {
          type: "object",
          properties: {
            address: { type: "string", description: "Mailbox address" },
            limit: { type: "number", description: "Maximum number of messages to return (default: 20)" }
          },
          required: ["address"]
        }
      },
      {
        name: EMAIL_TOOLS.wait_for_email.name,
        description: "Polls until a matching email arrives or timeout_ms elapses. Requires L2 trust.",
        inputSchema: {
          type: "object",
          properties: {
            address: { type: "string", description: "Mailbox address to watch" },
            filter: {
              type: "object",
              description: "Optional filter: subject_contains, from_contains, body_contains",
              properties: {
                subject_contains: { type: "string" },
                from_contains: { type: "string" },
                body_contains: { type: "string" }
              }
            },
            timeout_ms: { type: "number", description: "Maximum wait time in milliseconds" }
          },
          required: ["address", "timeout_ms"]
        }
      },
      {
        name: EMAIL_TOOLS.delete_mailbox.name,
        description: "Deletes a mailbox and all its messages (CASCADE). Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            address: { type: "string", description: "Mailbox address to delete" }
          },
          required: ["address"]
        }
      },
      // Tunnel tools
      {
        name: TUNNEL_TOOLS.create_tunnel.name,
        description: "Creates a public tunnel (cloudflared or ngrok) for a local port. Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            port: { type: "number", description: "Local port to tunnel" },
            label: { type: "string", description: "Human-readable label (auto-generated if omitted)" },
            provider: { type: "string", enum: ["cloudflared", "ngrok"], description: "Tunnel provider (default: cloudflared)" }
          },
          required: ["port"]
        }
      },
      {
        name: TUNNEL_TOOLS.get_tunnel_url.name,
        description: "Returns the public URL for an active tunnel. Requires L2 trust.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string", description: "Tunnel label" }
          },
          required: ["label"]
        }
      },
      {
        name: TUNNEL_TOOLS.close_tunnel.name,
        description: "Closes an active tunnel. Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string", description: "Tunnel label to close" }
          },
          required: ["label"]
        }
      },
      // Webhook tools
      {
        name: WEBHOOK_TOOLS.create_webhook.name,
        description: "Creates a webhook endpoint for receiving POST callbacks. Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string", description: "Webhook label" },
            max_payload_bytes: { type: "number", description: "Max payload size in bytes (default: 1MB)" },
            retention_days: { type: "number", description: "Event retention in days (default: 30)" }
          },
          required: ["label"]
        }
      },
      {
        name: WEBHOOK_TOOLS.get_webhook_url.name,
        description: "Returns the public URL for a webhook (requires active tunnel). Requires L2 trust.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string", description: "Webhook label" }
          },
          required: ["label"]
        }
      },
      {
        name: WEBHOOK_TOOLS.read_webhook_events.name,
        description: "Returns received webhook events. Requires L2 trust.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string", description: "Webhook label" },
            since: { type: "string", description: "ISO timestamp to filter events after" },
            limit: { type: "number", description: "Max events to return (default: 50)" }
          },
          required: ["label"]
        }
      },
      {
        name: WEBHOOK_TOOLS.wait_for_webhook.name,
        description: "Polls until a webhook event matching the filter arrives. Requires L2 trust.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string", description: "Webhook label" },
            filter: {
              type: "object",
              properties: {
                body_contains: { type: "string" }
              }
            },
            timeout_ms: { type: "number", description: "Max wait time in milliseconds" }
          },
          required: ["label"]
        }
      },
      {
        name: WEBHOOK_TOOLS.delete_webhook.name,
        description: "Deletes a webhook and all its events. Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string", description: "Webhook label to delete" }
          },
          required: ["label"]
        }
      },
      // Task tools
      {
        name: TASK_TOOLS.create_task.name,
        description: "Creates a scheduled task using a cron expression. Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string" },
            cron_expression: { type: "string", description: 'Cron expression (e.g. "0 * * * *")' },
            tool_name: { type: "string" },
            tool_args: { type: "object" },
            passport_id: { type: "string" },
            passport_version: { type: "string" },
            permission_snapshot: { type: "object" }
          },
          required: ["cron_expression", "tool_name", "passport_id", "passport_version", "permission_snapshot"]
        }
      },
      {
        name: TASK_TOOLS.list_tasks.name,
        description: "Lists all scheduled tasks. Requires L2 trust.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: TASK_TOOLS.delete_task.name,
        description: "Deletes a scheduled task. Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string" }
          },
          required: ["label"]
        }
      },
      {
        name: TASK_TOOLS.pause_task.name,
        description: "Pauses a scheduled task without deleting it. Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string" }
          },
          required: ["label"]
        }
      },
      // Docker tools
      {
        name: DOCKER_TOOLS.run_container.name,
        description: "Runs a Docker container. Requires L4 trust.",
        inputSchema: {
          type: "object",
          properties: {
            image: { type: "string" },
            name: { type: "string" },
            env: { type: "array", items: { type: "string" } },
            ports: { type: "object" }
          },
          required: ["image"]
        }
      },
      {
        name: DOCKER_TOOLS.stop_container.name,
        description: "Stops a running container. Requires L4 trust.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" }
          },
          required: ["id"]
        }
      },
      {
        name: DOCKER_TOOLS.remove_container.name,
        description: "Removes a container. Requires L4 trust.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
            force: { type: "boolean" }
          },
          required: ["id"]
        }
      },
      {
        name: DOCKER_TOOLS.list_containers.name,
        description: "Lists Docker containers. Requires L2 trust.",
        inputSchema: {
          type: "object",
          properties: {
            all: { type: "boolean", description: "Include stopped containers" }
          }
        }
      },
      {
        name: DOCKER_TOOLS.container_logs.name,
        description: "Returns container stdout/stderr logs. Requires L2 trust.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
            tail: { type: "number" }
          },
          required: ["id"]
        }
      },
      {
        name: DOCKER_TOOLS.exec_in_container.name,
        description: "Executes a command inside a running container. Requires L4 trust.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
            command: { type: "array", items: { type: "string" } }
          },
          required: ["id", "command"]
        }
      },
      // JMP phone tools
      {
        name: PHONE_JMP_TOOLS.provision_phone_number_jmp.name,
        description: "Provisions a phone number via JMP XMPP (no KYC). Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            area_code: { type: "string", description: "US area code to request" }
          }
        }
      },
      {
        name: PHONE_JMP_TOOLS.send_sms_jmp.name,
        description: "Sends an SMS via JMP XMPP. Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            to: { type: "string", description: "Destination phone number (E.164)" },
            message: { type: "string" },
            from_number: { type: "string", description: "Source JMP number (optional)" }
          },
          required: ["to", "message"]
        }
      },
      {
        name: PHONE_JMP_TOOLS.read_sms_jmp.name,
        description: "Returns inbound SMS messages buffered from JMP XMPP. Requires L2 trust.",
        inputSchema: {
          type: "object",
          properties: {
            number: { type: "string", description: "Filter by source number" },
            limit: { type: "number" }
          }
        }
      },
      {
        name: PHONE_JMP_TOOLS.release_phone_number_jmp.name,
        description: "Releases a JMP phone number. Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            number: { type: "string", description: "Phone number to release" }
          },
          required: ["number"]
        }
      },
      // GitHub tools
      {
        name: GITHUB_TOOLS.create_repo.name,
        description: "Creates a new GitHub repository for the authenticated user. Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Repository name" },
            private: { type: "boolean", description: "Make repository private (default: false)" },
            description: { type: "string", description: "Repository description" }
          },
          required: ["name"]
        }
      },
      {
        name: GITHUB_TOOLS.create_file.name,
        description: "Creates or updates a file in a GitHub repository. Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Repository owner (defaults to configured defaultOwner)" },
            repo: { type: "string", description: "Repository name" },
            path: { type: "string", description: "File path in the repository" },
            content: { type: "string", description: "File content (UTF-8 text)" },
            message: { type: "string", description: "Commit message" },
            branch: { type: "string", description: "Branch name (defaults to default branch)" }
          },
          required: ["repo", "path", "content", "message"]
        }
      },
      {
        name: GITHUB_TOOLS.create_pull_request.name,
        description: "Creates a pull request in a GitHub repository. Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Repository owner (defaults to configured defaultOwner)" },
            repo: { type: "string", description: "Repository name" },
            title: { type: "string", description: "Pull request title" },
            body: { type: "string", description: "Pull request body" },
            head: { type: "string", description: "Head branch name" },
            base: { type: "string", description: "Base branch name" }
          },
          required: ["repo", "title", "head", "base"]
        }
      },
      {
        name: GITHUB_TOOLS.list_repos.name,
        description: "Lists repositories for the authenticated GitHub user. Requires L2 trust.",
        inputSchema: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["all", "owner", "public", "private"], description: "Filter type (default: all)" },
            per_page: { type: "number", description: "Results per page (default: 30)" }
          }
        }
      },
      // IPFS tools
      {
        name: IPFS_TOOLS.publish_content.name,
        description: "Publishes content to IPFS via Kubo daemon (or web3.storage fallback). Returns CID. Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            content: { type: "string", description: "Content to publish (UTF-8 text)" },
            filename: { type: "string", description: "Optional filename hint" }
          },
          required: ["content"]
        }
      },
      {
        name: IPFS_TOOLS.get_ipfs_content.name,
        description: "Retrieves content from IPFS by CID. Requires L2 trust.",
        inputSchema: {
          type: "object",
          properties: {
            cid: { type: "string", description: "IPFS CID to fetch" }
          },
          required: ["cid"]
        }
      },
      {
        name: IPFS_TOOLS.pin_content.name,
        description: "Pins content on the local IPFS node to prevent garbage collection. Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            cid: { type: "string", description: "IPFS CID to pin" }
          },
          required: ["cid"]
        }
      },
      // RSS tools
      {
        name: RSS_TOOLS.create_feed.name,
        description: "Creates an RSS feed served at /feeds/{label}. Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string", description: 'URL-safe feed label (e.g. "my-feed")' },
            title: { type: "string", description: "Feed title" },
            description: { type: "string", description: "Feed description" },
            link: { type: "string", description: "Feed website link" }
          },
          required: ["label", "title", "description", "link"]
        }
      },
      {
        name: RSS_TOOLS.add_feed_item.name,
        description: "Adds an item to an RSS feed. Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            feed_label: { type: "string", description: "Feed label" },
            title: { type: "string", description: "Item title" },
            description: { type: "string", description: "Item description/content" },
            url: { type: "string", description: "Item URL (optional)" },
            guid: { type: "string", description: "Item GUID (optional, auto-generated)" }
          },
          required: ["feed_label", "title", "description"]
        }
      },
      {
        name: RSS_TOOLS.serve_feed.name,
        description: "Returns the public URL for an RSS feed (uses active tunnel if available). Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string", description: "Feed label" }
          },
          required: ["label"]
        }
      },
      // PostScan Mail tools
      {
        name: MAIL_TOOLS.list_mail.name,
        description: "Lists physical mail items from PostScan Mail (or Earth Class Mail). Requires L2 trust.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Maximum number of items to return (default: 20)" },
            status: { type: "string", description: 'Filter by status (e.g. "new", "scanned")' }
          }
        }
      },
      {
        name: MAIL_TOOLS.forward_mail.name,
        description: "Forwards a physical mail item to a shipping address. Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            mail_id: { type: "string", description: "Mail item ID" },
            address: { type: "string", description: "Forwarding address" }
          },
          required: ["mail_id", "address"]
        }
      },
      {
        name: MAIL_TOOLS.shred_mail.name,
        description: "Shreds (destroys) a physical mail item. Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            mail_id: { type: "string", description: "Mail item ID to shred" }
          },
          required: ["mail_id"]
        }
      },
      {
        name: MAIL_TOOLS.scan_mail.name,
        description: "Requests a high-resolution scan of a physical mail item. Requires L3 trust.",
        inputSchema: {
          type: "object",
          properties: {
            mail_id: { type: "string", description: "Mail item ID to scan" }
          },
          required: ["mail_id"]
        }
      }
    ]
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      if (name === "notify_human") {
        const result = await notifyHuman(
          args,
          claims
        );
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "create_wallet") {
        const result = await createWallet(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "get_address") {
        const result = await getAddress(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "get_balance") {
        const result = await getBalance(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "send_usdc") {
        const result = await sendUsdc(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "sign_message") {
        const result = await signMessage(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "sign_typed_data") {
        const result = await signTypedData(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "bridge_to_polygon") {
        const result = await bridgeToPolygon(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "bridge_to_base") {
        const result = await bridgeToBase(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "get_bridge_status") {
        const result = await getBridgeStatus(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "pay_with_usdc") {
        const result = await payWithUsdc(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "get_payment_status") {
        const result = await getPaymentStatus(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "prepare_payment") {
        const params = args;
        const receipt = await preparePayment(params, claims);
        return { content: [{ type: "text", text: JSON.stringify(receipt) }] };
      }
      if (name === "create_virtual_card") {
        const result = await createVirtualCard(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "get_card_details") {
        const result = await getCardDetails(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "add_funds_to_card") {
        const result = await addFundsToCard(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "top_up_moon_credit") {
        const result = await topUpMoonCredit(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "freeze_card") {
        const result = await freezeCard(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "delete_card") {
        const result = await deleteCard(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "get_card_transactions") {
        const result = await getCardTransactions(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "provision_phone_number") {
        const result = await provisionPhoneNumber(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "send_sms") {
        const result = await sendSms(
          args,
          claims
        );
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "read_sms") {
        const result = await readSms(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "release_phone_number") {
        const result = await releasePhoneNumber(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "create_mailbox") {
        const result = await createMailbox(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "send_email") {
        const result = await sendEmail(
          args,
          claims
        );
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "read_inbox") {
        const result = await readInbox(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "wait_for_email") {
        const result = await waitForEmail(
          args,
          claims
        );
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "delete_mailbox") {
        const result = await deleteMailbox(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "create_tunnel") {
        const result = await createTunnel(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "get_tunnel_url") {
        const result = await getTunnelUrl(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "close_tunnel") {
        const result = await closeTunnel(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "create_webhook") {
        const result = await createWebhook(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "get_webhook_url") {
        const result = await getWebhookUrl(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "read_webhook_events") {
        const result = await readWebhookEvents(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "wait_for_webhook") {
        const result = await waitForWebhook(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "delete_webhook") {
        const result = await deleteWebhook(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "create_task") {
        const result = await createTask(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "list_tasks") {
        const result = await listTasks({}, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "delete_task") {
        const result = await deleteTask(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "pause_task") {
        const result = await pauseTask(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "run_container") {
        const result = await runContainer(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "stop_container") {
        const result = await stopContainer(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "remove_container") {
        const result = await removeContainer(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "list_containers") {
        const result = await listContainers(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "container_logs") {
        const result = await containerLogs(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "exec_in_container") {
        const result = await execInContainer(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "provision_phone_number_jmp") {
        const result = await provisionPhoneNumberJmp(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "send_sms_jmp") {
        const result = await sendSmsJmp(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "read_sms_jmp") {
        const result = await readSmsJmp(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "release_phone_number_jmp") {
        const result = await releasePhoneNumberJmp(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "create_repo") {
        const result = await createRepo(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "create_file") {
        const result = await createFile(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "create_pull_request") {
        const result = await createPullRequest(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "list_repos") {
        const result = await listRepos(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "publish_content") {
        const result = await publishContent(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "get_ipfs_content") {
        const result = await getIpfsContent(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "pin_content") {
        const result = await pinContent(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "create_feed") {
        const result = await createFeed(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "add_feed_item") {
        const result = await addFeedItem(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "serve_feed") {
        const result = await serveFeed(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "list_mail") {
        const result = await listMail(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "forward_mail") {
        const result = await forwardMail(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "shred_mail") {
        const result = await shredMail(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      if (name === "scan_mail") {
        const result = await scanMail(args, claims);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: message }],
        isError: true
      };
    }
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true
    };
  });
  return server;
}
function createApp(options) {
  const app = express();
  app.use(express.json());
  app.post(
    "/webhooks/:label/:token",
    express.json({ limit: "1mb" }),
    (req, res) => {
      webhookReceiver(req, res).catch((err) => {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      });
    }
  );
  registerRssRoutes(app);
  app.use(async (req, res, next) => {
    if (req.path === "/health") {
      next();
      return;
    }
    try {
      const token = extractBearerToken(req.headers.authorization);
      const claims = await validatePassport(token, options.registryUrl);
      req.passport = claims;
      next();
    } catch (e) {
      if (e instanceof AuthError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      next(e);
    }
  });
  app.use("/mcp", (_req, res, next) => {
    if (isPaused()) {
      res.status(503).json({
        error: "PAUSED",
        message: 'Hands and Feet is paused. Run "hands-and-feet resume" to re-enable.'
      });
      return;
    }
    next();
  });
  app.post("/mcp", async (req, res) => {
    const claims = req.passport;
    const mcpServer = createMcpServer(claims);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: void 0,
      // stateless mode
      enableJsonResponse: true
      // return JSON instead of SSE for simple req/res
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("finish", () => mcpServer.close().catch(() => void 0));
  });
  app.get("/health", (_req, res) => {
    res.json({ ok: true, paused: isPaused() });
  });
  return app;
}
function startServer(options) {
  const app = createApp(options);
  const port = options.port ?? 3847;
  return new Promise((resolve) => {
    const httpServer = app.listen(port, () => {
      console.log(`Hands and Feet MCP server listening on http://localhost:${port}/mcp`);
      startLocalTransportIfConfigured().catch((err) => {
        console.error("Failed to start local SMTP transport:", err);
      });
      try {
        loadActiveTasks();
      } catch (err) {
        console.error("Failed to load active tasks:", err instanceof Error ? err.message : String(err));
      }
      startPurgeJob();
      startXmppIfConfigured().catch((err) => {
        console.error("Failed to start XMPP client:", err instanceof Error ? err.message : String(err));
      });
      resolve(httpServer);
    });
  });
}

// src/cli/serve.ts
var serve = {
  command: "serve",
  describe: "Start the Hands and Feet MCP server on port 3847",
  builder: (y) => y.option("port", {
    type: "number",
    default: 3847,
    describe: "HTTP port to listen on"
  }).option("allow-local-fallback", {
    type: "boolean",
    default: false,
    describe: "Allow starting even if registry is unreachable"
  }),
  handler: async (argv) => {
    const cfg = readConfig();
    if (argv["allow-local-fallback"]) {
      console.warn(
        "\n\u26A0\uFE0F  WARNING: --allow-local-fallback enabled. Secrets will be used from local files if registry is unreachable.\n"
      );
    }
    const httpServer = await startServer({
      registryUrl: cfg.registryUrl,
      port: argv["port"]
    });
    const shutdown = () => {
      console.log("\nShutting down...");
      httpServer.close(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }
};
var serve_default = serve;
export {
  serve_default as default
};
