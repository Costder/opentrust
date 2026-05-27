import { SecretsError } from '../../secrets.js';
import { enforceTrust } from '../../trust.js';
import type { PassportClaims, ToolDefinition } from '../../types.js';

// ────────────────────────────────────────────────────────────
// Tool definitions
// ────────────────────────────────────────────────────────────
const LIST_MAIL_TOOL: ToolDefinition = { name: 'list_mail', minTrustLevel: 2 };
const FORWARD_MAIL_TOOL: ToolDefinition = { name: 'forward_mail', minTrustLevel: 3 };
const SHRED_MAIL_TOOL: ToolDefinition = { name: 'shred_mail', minTrustLevel: 3 };
const SCAN_MAIL_TOOL: ToolDefinition = { name: 'scan_mail', minTrustLevel: 3 };

export const MAIL_TOOLS = {
  list_mail: LIST_MAIL_TOOL,
  forward_mail: FORWARD_MAIL_TOOL,
  shred_mail: SHRED_MAIL_TOOL,
  scan_mail: SCAN_MAIL_TOOL,
};

// ────────────────────────────────────────────────────────────
// API base URLs
// ────────────────────────────────────────────────────────────
const POSTSCAN_BASE = 'https://api.postscanmail.com/2.0';
const EARTH_CLASS_BASE = 'https://api.earthclassmail.com/v1';

// ────────────────────────────────────────────────────────────
// Credential loading
// ────────────────────────────────────────────────────────────
interface MailCredentials {
  apiKey: string;
  accountId: string;
  provider: 'postscan' | 'earthclass';
}

export function getMailCredentials(): MailCredentials {
  const apiKey = process.env['POSTSCAN_API_KEY'];
  const accountId = process.env['POSTSCAN_ACCOUNT_ID'];

  if (apiKey && accountId) {
    return { apiKey, accountId, provider: 'postscan' };
  }

  // Fallback: Earth Class Mail
  const ecApiKey = process.env['EARTH_CLASS_MAIL_API_KEY'];
  const ecAccountId = process.env['EARTH_CLASS_MAIL_ACCOUNT_ID'] ?? 'default';
  if (ecApiKey) {
    return { apiKey: ecApiKey, accountId: ecAccountId, provider: 'earthclass' };
  }

  throw new SecretsError(
    'POSTSCAN_API_KEY and POSTSCAN_ACCOUNT_ID env vars required. ' +
    'Run: hands-and-feet init --i-understand-form-1583\n' +
    'Alternatively set EARTH_CLASS_MAIL_API_KEY for Earth Class Mail.',
  );
}

// ────────────────────────────────────────────────────────────
// EarthClassMailClient — same interface as PostScan
// ────────────────────────────────────────────────────────────
export class EarthClassMailClient {
  private apiKey: string;
  private accountId: string;

  constructor(apiKey: string, accountId: string) {
    this.apiKey = apiKey;
    this.accountId = accountId;
  }

  private get authHeader(): string {
    return 'Basic ' + Buffer.from(`${this.apiKey}:${this.accountId}`).toString('base64');
  }

  async listMail(limit = 20, status?: string): Promise<unknown> {
    const url = new URL(`${EARTH_CLASS_BASE}/mailboxes/${this.accountId}/mail`);
    url.searchParams.set('limit', String(limit));
    if (status) url.searchParams.set('status', status);
    const res = await fetch(url.toString(), {
      headers: { Authorization: this.authHeader },
    });
    if (!res.ok) throw new Error(`Earth Class Mail API error: ${res.status} ${res.statusText}`);
    return res.json();
  }

  async forwardMail(mailId: string, address: string): Promise<unknown> {
    const res = await fetch(`${EARTH_CLASS_BASE}/mail/${mailId}/forward`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to_address: address }),
    });
    if (!res.ok) throw new Error(`Earth Class Mail API error: ${res.status} ${res.statusText}`);
    return res.json();
  }

  async shredMail(mailId: string): Promise<unknown> {
    const res = await fetch(`${EARTH_CLASS_BASE}/mail/${mailId}/shred`, {
      method: 'POST',
      headers: { Authorization: this.authHeader },
    });
    if (!res.ok) throw new Error(`Earth Class Mail API error: ${res.status} ${res.statusText}`);
    return res.json();
  }

  async scanMail(mailId: string): Promise<unknown> {
    const res = await fetch(`${EARTH_CLASS_BASE}/mail/${mailId}/scan`, {
      method: 'POST',
      headers: { Authorization: this.authHeader },
    });
    if (!res.ok) throw new Error(`Earth Class Mail API error: ${res.status} ${res.statusText}`);
    return res.json();
  }
}

// ────────────────────────────────────────────────────────────
// PostScan helpers
// ────────────────────────────────────────────────────────────
function makeAuthHeader(apiKey: string, accountId: string): string {
  return 'Basic ' + Buffer.from(`${apiKey}:${accountId}`).toString('base64');
}

// ────────────────────────────────────────────────────────────
// list_mail
// ────────────────────────────────────────────────────────────
export async function listMail(
  params: { limit?: number; status?: string },
  claims: PassportClaims,
): Promise<{ mail: unknown }> {
  enforceTrust(claims, LIST_MAIL_TOOL);

  const creds = getMailCredentials();

  if (creds.provider === 'earthclass') {
    const client = new EarthClassMailClient(creds.apiKey, creds.accountId);
    const mail = await client.listMail(params.limit ?? 20, params.status);
    return { mail };
  }

  const url = new URL(`${POSTSCAN_BASE}/accounts/${creds.accountId}/mail`);
  if (params.limit) url.searchParams.set('limit', String(params.limit));
  if (params.status) url.searchParams.set('status', params.status);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: makeAuthHeader(creds.apiKey, creds.accountId),
    },
  });
  if (!res.ok) {
    throw new Error(`PostScan Mail API error: ${res.status} ${res.statusText}`);
  }
  const mail = await res.json();
  return { mail };
}

// ────────────────────────────────────────────────────────────
// forward_mail
// ────────────────────────────────────────────────────────────
export async function forwardMail(
  params: { mail_id: string; address: string },
  claims: PassportClaims,
): Promise<{ mail_id: string; forwarded: boolean; address: string }> {
  enforceTrust(claims, FORWARD_MAIL_TOOL);

  const creds = getMailCredentials();

  if (creds.provider === 'earthclass') {
    const client = new EarthClassMailClient(creds.apiKey, creds.accountId);
    await client.forwardMail(params.mail_id, params.address);
    return { mail_id: params.mail_id, forwarded: true, address: params.address };
  }

  const res = await fetch(`${POSTSCAN_BASE}/mail/${params.mail_id}/forward`, {
    method: 'POST',
    headers: {
      Authorization: makeAuthHeader(creds.apiKey, creds.accountId),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to_address: params.address }),
  });
  if (!res.ok) {
    throw new Error(`PostScan Mail API error: ${res.status} ${res.statusText}`);
  }
  return { mail_id: params.mail_id, forwarded: true, address: params.address };
}

// ────────────────────────────────────────────────────────────
// shred_mail
// ────────────────────────────────────────────────────────────
export async function shredMail(
  params: { mail_id: string },
  claims: PassportClaims,
): Promise<{ mail_id: string; shredded: boolean }> {
  enforceTrust(claims, SHRED_MAIL_TOOL);

  const creds = getMailCredentials();

  if (creds.provider === 'earthclass') {
    const client = new EarthClassMailClient(creds.apiKey, creds.accountId);
    await client.shredMail(params.mail_id);
    return { mail_id: params.mail_id, shredded: true };
  }

  const res = await fetch(`${POSTSCAN_BASE}/mail/${params.mail_id}/shred`, {
    method: 'POST',
    headers: {
      Authorization: makeAuthHeader(creds.apiKey, creds.accountId),
    },
  });
  if (!res.ok) {
    throw new Error(`PostScan Mail API error: ${res.status} ${res.statusText}`);
  }
  return { mail_id: params.mail_id, shredded: true };
}

// ────────────────────────────────────────────────────────────
// scan_mail
// ────────────────────────────────────────────────────────────
export async function scanMail(
  params: { mail_id: string },
  claims: PassportClaims,
): Promise<{ mail_id: string; scan_requested: boolean }> {
  enforceTrust(claims, SCAN_MAIL_TOOL);

  const creds = getMailCredentials();

  if (creds.provider === 'earthclass') {
    const client = new EarthClassMailClient(creds.apiKey, creds.accountId);
    await client.scanMail(params.mail_id);
    return { mail_id: params.mail_id, scan_requested: true };
  }

  const res = await fetch(`${POSTSCAN_BASE}/mail/${params.mail_id}/scan`, {
    method: 'POST',
    headers: {
      Authorization: makeAuthHeader(creds.apiKey, creds.accountId),
    },
  });
  if (!res.ok) {
    throw new Error(`PostScan Mail API error: ${res.status} ${res.statusText}`);
  }
  return { mail_id: params.mail_id, scan_requested: true };
}
