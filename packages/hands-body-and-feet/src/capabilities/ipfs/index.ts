import { create as ipfsCreate } from 'kubo-rpc-client';
import { SecretsError } from '../../secrets.js';
import { enforceTrust } from '../../trust.js';
import type { PassportClaims, ToolDefinition } from '../../types.js';

// ────────────────────────────────────────────────────────────
// Tool definitions
// ────────────────────────────────────────────────────────────
const PUBLISH_CONTENT_TOOL: ToolDefinition = { name: 'publish_content', minTrustLevel: 3 };
const GET_IPFS_CONTENT_TOOL: ToolDefinition = { name: 'get_ipfs_content', minTrustLevel: 2 };
const PIN_CONTENT_TOOL: ToolDefinition = { name: 'pin_content', minTrustLevel: 3 };

export const IPFS_TOOLS = {
  publish_content: PUBLISH_CONTENT_TOOL,
  get_ipfs_content: GET_IPFS_CONTENT_TOOL,
  pin_content: PIN_CONTENT_TOOL,
};

// ────────────────────────────────────────────────────────────
// Web3.storage fallback client
// ────────────────────────────────────────────────────────────
export class Web3StorageFallback {
  private token: string;
  private baseUrl = 'https://api.web3.storage';

  constructor() {
    const token = process.env['WEB3_STORAGE_TOKEN'];
    if (!token) {
      throw new SecretsError(
        'WEB3_STORAGE_TOKEN env var not set. Required when IPFS_API_URL is unavailable.',
      );
    }
    this.token = token;
  }

  async add(content: Uint8Array): Promise<{ cid: string }> {
    const response = await fetch(`${this.baseUrl}/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: Buffer.from(content),
    });
    if (!response.ok) {
      throw new Error(`web3.storage upload failed: ${response.status} ${response.statusText}`);
    }
    const json = (await response.json()) as { cid: string };
    return { cid: json.cid };
  }

  async cat(cid: string): Promise<string> {
    const response = await fetch(`https://${cid}.ipfs.dweb.link/`);
    if (!response.ok) {
      throw new Error(`web3.storage fetch failed: ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  async pin(_cid: string): Promise<void> {
    // web3.storage pins automatically on upload; no separate pin call needed
  }
}

// ────────────────────────────────────────────────────────────
// Client factory
// ────────────────────────────────────────────────────────────
export type IpfsClientType = ReturnType<typeof ipfsCreate>;

export function getIpfsClient(): IpfsClientType {
  const apiUrl = process.env['IPFS_API_URL'] ?? 'http://localhost:5001';
  if (apiUrl === 'web3storage') {
    throw new Error('Use Web3StorageFallback directly for web3storage');
  }
  return ipfsCreate({ url: apiUrl });
}

// ────────────────────────────────────────────────────────────
// publish_content
// ────────────────────────────────────────────────────────────
export async function publishContent(
  params: { content: string; filename?: string },
  claims: PassportClaims,
): Promise<{ cid: string }> {
  enforceTrust(claims, PUBLISH_CONTENT_TOOL);

  const apiUrl = process.env['IPFS_API_URL'] ?? 'http://localhost:5001';

  if (apiUrl === 'web3storage') {
    const fallback = new Web3StorageFallback();
    const result = await fallback.add(Buffer.from(params.content));
    return { cid: result.cid };
  }

  const client = getIpfsClient();
  const result = await client.add(Buffer.from(params.content));
  return { cid: result.cid.toString() };
}

// ────────────────────────────────────────────────────────────
// get_ipfs_content
// ────────────────────────────────────────────────────────────
export async function getIpfsContent(
  params: { cid: string },
  claims: PassportClaims,
): Promise<{ content: string; cid: string }> {
  enforceTrust(claims, GET_IPFS_CONTENT_TOOL);

  const apiUrl = process.env['IPFS_API_URL'] ?? 'http://localhost:5001';

  if (apiUrl === 'web3storage') {
    const fallback = new Web3StorageFallback();
    const content = await fallback.cat(params.cid);
    return { content, cid: params.cid };
  }

  const client = getIpfsClient();
  const chunks: Uint8Array[] = [];
  for await (const chunk of client.cat(params.cid)) {
    chunks.push(chunk);
  }
  const content = Buffer.concat(chunks).toString('utf8');
  return { content, cid: params.cid };
}

// ────────────────────────────────────────────────────────────
// pin_content
// ────────────────────────────────────────────────────────────
export async function pinContent(
  params: { cid: string },
  claims: PassportClaims,
): Promise<{ cid: string; pinned: boolean }> {
  enforceTrust(claims, PIN_CONTENT_TOOL);

  const apiUrl = process.env['IPFS_API_URL'] ?? 'http://localhost:5001';

  if (apiUrl === 'web3storage') {
    const fallback = new Web3StorageFallback();
    await fallback.pin(params.cid);
    return { cid: params.cid, pinned: true };
  }

  const client = getIpfsClient();
  await client.pin.add(params.cid);
  return { cid: params.cid, pinned: true };
}
