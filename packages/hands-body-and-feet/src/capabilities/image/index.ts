import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { CONFIG_DIR, readConfig } from '../../config.js';
import { enforceTrust } from '../../trust.js';
import { readMemoryValue } from '../body/index.js';
import type { PassportClaims } from '../../types.js';

export const IMAGE_TOOLS = {
  generate_image: { name: 'generate_image', minTrustLevel: 2 as const },
} as const;

interface ModalCredentials {
  token_id: string;
  token_secret: string;
}

function requireModalCredentials(): ModalCredentials {
  const value = readMemoryValue('secret:modal_credentials');
  if (!value || typeof value !== 'object') {
    throw new Error('Missing Modal credentials in memory key secret:modal_credentials');
  }
  const creds = value as Partial<ModalCredentials>;
  if (!creds.token_id || !creds.token_secret) {
    throw new Error('Memory key secret:modal_credentials must contain JSON with token_id and token_secret');
  }
  return { token_id: creds.token_id, token_secret: creds.token_secret };
}

function defaultOutputPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = randomBytes(4).toString('hex');
  return join(CONFIG_DIR, 'images', `${stamp}-${suffix}.png`);
}

export async function generateImage(
  params: { prompt: string; width?: number; height?: number; output_path?: string },
  claims: PassportClaims,
): Promise<{ path: string; bytes: number; ms: number }> {
  enforceTrust(claims, IMAGE_TOOLS.generate_image);
  const cfg = readConfig();
  if (!cfg.modalImageEndpoint) {
    throw new Error(
      'Set modalImageEndpoint in ~/.hands-and-feet/config.json - find it with: modal app list',
    );
  }
  const creds = requireModalCredentials();
  const width = params.width ?? 1024;
  const height = params.height ?? 1024;
  const started = Date.now();
  const response = await fetch(cfg.modalImageEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Modal-Key': creds.token_id,
      'Modal-Secret': creds.token_secret,
    },
    body: JSON.stringify({ prompt: params.prompt, width, height }),
  });
  if (!response.ok) {
    throw new Error(`Modal image endpoint failed: HTTP ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  let bytes: Buffer;
  if (contentType.includes('application/json')) {
    const json = await response.json() as { image_base64?: string };
    if (!json.image_base64) {
      throw new Error('Modal image endpoint JSON response missing image_base64');
    }
    bytes = Buffer.from(json.image_base64, 'base64');
  } else {
    bytes = Buffer.from(await response.arrayBuffer());
  }

  const outputPath = params.output_path ?? defaultOutputPath();
  const outputDir = outputPath.slice(0, Math.max(outputPath.lastIndexOf('/'), outputPath.lastIndexOf('\\')));
  if (outputDir) {
    await mkdir(outputDir, { recursive: true });
  }
  await writeFile(outputPath, bytes);
  return { path: outputPath, bytes: bytes.length, ms: Date.now() - started };
}
