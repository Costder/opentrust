import { describe, it, expect, vi, beforeEach, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { PassportClaims } from '../types.js';

const { mockReadConfig, mockWriteFile, mockMkdir } = vi.hoisted(() => ({
  mockReadConfig: vi.fn(),
  mockWriteFile: vi.fn(),
  mockMkdir: vi.fn(),
}));

vi.mock('../config.js', () => ({
  readConfig: mockReadConfig,
  CONFIG_DIR: '/tmp/test-haf-image',
  ensureConfigDir: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

vi.mock('better-sqlite3', () => {
  let db: import('better-sqlite3').Database | null = null;
  const Ctor = vi.fn((_path: string) => {
    if (!db) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
      const RealDB = (require('better-sqlite3') as any) as new (path: string) => import('better-sqlite3').Database;
      db = new RealDB(':memory:');
    }
    return db;
  });
  (Ctor as unknown as { resetDb: () => void }).resetDb = () => { db = null; };
  return { default: Ctor };
});

import Database from 'better-sqlite3';
import { _resetDb, openDb } from '../spend-tracker.js';
import { generateImage } from '../capabilities/image/index.js';

const MockDatabase = Database as unknown as { resetDb: () => void };

const server = setupServer();

function makeL2Claims(): PassportClaims {
  return {
    passportId: 'p',
    agentId: 'a',
    trustLevel: 2,
    trustStatus: 'creator_claimed',
    flags: [],
    isDisputed: false,
    version: '1',
  };
}

function setImageConfig() {
  mockReadConfig.mockReturnValue({
    version: 1,
    instanceId: 'test',
    registryUrl: 'http://localhost:8000',
    passphraseHash: 'hash',
    capabilities: {},
    modalImageEndpoint: 'https://modal.example.test/generate',
  });
}

function seedModalCredentials() {
  openDb().prepare('INSERT INTO memory (key, value_json, updated_at) VALUES (?, ?, ?)')
    .run(
      'secret:modal_credentials',
      JSON.stringify({ token_id: 'ak-test', token_secret: 'sk-test' }),
      new Date().toISOString(),
    );
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetDb();
  MockDatabase.resetDb();
  setImageConfig();
  seedModalCredentials();
  mockWriteFile.mockResolvedValue(undefined);
  mockMkdir.mockResolvedValue(undefined);
  server.resetHandlers();
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
  _resetDb();
  MockDatabase.resetDb();
});

server.listen({ onUnhandledRequest: 'error' });

describe('generate_image', () => {
  it('posts to Modal with credentials and saves image byte responses', async () => {
    const imageBytes = new Uint8Array([137, 80, 78, 71]);
    server.use(
      http.post('https://modal.example.test/generate', async ({ request }) => {
        expect(request.headers.get('Modal-Key')).toBe('ak-test');
        expect(request.headers.get('Modal-Secret')).toBe('sk-test');
        expect(await request.json()).toEqual({ prompt: 'draw a cube', width: 640, height: 512 });
        return new HttpResponse(imageBytes, { headers: { 'content-type': 'image/png' } });
      }),
    );

    const result = await generateImage(
      { prompt: 'draw a cube', width: 640, height: 512, output_path: '/tmp/out.png' },
      makeL2Claims(),
    );

    expect(result.path).toBe('/tmp/out.png');
    expect(result.bytes).toBe(4);
    expect(result.ms).toBeGreaterThanOrEqual(0);
    expect(mockWriteFile).toHaveBeenCalledWith('/tmp/out.png', Buffer.from(imageBytes));
  });

  it('decodes JSON image_base64 responses and writes the default output path', async () => {
    server.use(
      http.post('https://modal.example.test/generate', () =>
        HttpResponse.json({ image_base64: Buffer.from('png-data').toString('base64') }),
      ),
    );

    const result = await generateImage({ prompt: 'draw a tree' }, makeL2Claims());

    const normalizedPath = result.path.replace(/\\/g, '/');
    expect(normalizedPath).toMatch(/\/tmp\/test-haf-image\/images\/.+\.png$/);
    expect(result.bytes).toBe(8);
    expect(mockMkdir.mock.calls[0][0].replace(/\\/g, '/')).toBe('/tmp/test-haf-image/images');
    expect(mockMkdir.mock.calls[0][1]).toEqual({ recursive: true });
  });

  it('throws a clear error when modalImageEndpoint is missing', async () => {
    mockReadConfig.mockReturnValue({
      version: 1,
      instanceId: 'test',
      registryUrl: 'http://localhost:8000',
      passphraseHash: 'hash',
      capabilities: {},
    });

    await expect(generateImage({ prompt: 'x' }, makeL2Claims())).rejects.toThrow(
      /Set modalImageEndpoint in ~\/.hands-and-feet\/config\.json - find it with: modal app list/,
    );
  });

  it('throws a clear error when Modal credentials are missing from memory', async () => {
    openDb().prepare('DELETE FROM memory WHERE key = ?').run('secret:modal_credentials');

    await expect(generateImage({ prompt: 'x' }, makeL2Claims())).rejects.toThrow(
      /secret:modal_credentials/,
    );
  });
});
