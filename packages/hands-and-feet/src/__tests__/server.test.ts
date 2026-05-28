import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server.js';

// Mock auth
vi.mock('../auth.js', () => ({
  extractBearerToken: vi.fn(),
  validatePassport: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(msg: string, code = 401) {
      super(msg);
      this.statusCode = code;
      this.name = 'AuthError';
    }
  },
}));

// Mock state
vi.mock('../state.js', () => ({
  isPaused: vi.fn(() => false),
}));

// Mock notify
vi.mock('../capabilities/notify/index.js', () => ({
  notifyHuman: vi.fn(),
  NOTIFY_TOOL: {
    name: 'notify_human',
    description: 'Sends push notification',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
  },
}));

import { extractBearerToken, validatePassport, AuthError } from '../auth.js';
import { isPaused } from '../state.js';
import { notifyHuman } from '../capabilities/notify/index.js';

const sampleClaims = {
  passportId: 'passport-abc123',
  agentId: 'agent-xyz',
  trustLevel: 3 as const,
  trustStatus: 'seller_confirmed' as const,
  flags: [] as string[],
  isDisputed: false,
  version: '1',
};

const APP_OPTIONS = { registryUrl: 'https://registry.example.com' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isPaused).mockReturnValue(false);
  vi.mocked(extractBearerToken).mockReturnValue('valid-token');
  vi.mocked(validatePassport).mockResolvedValue(sampleClaims);
  vi.mocked(notifyHuman).mockResolvedValue({ sent: true, topic: 'test-topic' });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  it('returns { ok: true, paused: false } with no auth required', async () => {
    const app = createApp(APP_OPTIONS);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, paused: false });
  });

  it('returns { ok: true, paused: true } when system is paused', async () => {
    vi.mocked(isPaused).mockReturnValue(true);
    const app = createApp(APP_OPTIONS);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, paused: true });
  });
});

// ---------------------------------------------------------------------------
// Auth enforcement
// ---------------------------------------------------------------------------

describe('POST /mcp — auth', () => {
  it('returns 401 when no Authorization header is provided', async () => {
    vi.mocked(extractBearerToken).mockImplementation(() => {
      const err = new AuthError('Missing or malformed Authorization header', 401);
      throw err;
    });
    const app = createApp(APP_OPTIONS);
    const res = await request(app).post('/mcp').send({});
    expect(res.status).toBe(401);
  });

  it('returns 401 when validatePassport throws AuthError 401', async () => {
    vi.mocked(validatePassport).mockRejectedValue(
      new AuthError('Invalid passport token', 401),
    );
    const app = createApp(APP_OPTIONS);
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer bad-token')
      .send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 when validatePassport throws AuthError 403 (revoked)', async () => {
    vi.mocked(validatePassport).mockRejectedValue(
      new AuthError('Passport revoked', 403),
    );
    const app = createApp(APP_OPTIONS);
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer revoked-token')
      .send({});
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------------------

describe('POST /mcp — kill switch', () => {
  it('returns 503 with error PAUSED when system is paused', async () => {
    vi.mocked(isPaused).mockReturnValue(true);
    const app = createApp(APP_OPTIONS);
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer valid-token')
      .send({});
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'PAUSED' });
  });
});

// ---------------------------------------------------------------------------
// MCP tool dispatch
// ---------------------------------------------------------------------------

describe('POST /mcp — MCP protocol', () => {
  it('responds to tools/list with notify_human and all Plan B tools in tools list', async () => {
    const app = createApp(APP_OPTIONS);
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer valid-token')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      });
    expect(res.status).toBe(200);
    const body = res.body as { result?: { tools?: Array<{ name: string }> } };
    expect(body.result?.tools).toBeDefined();
    const toolNames = body.result!.tools!.map((t) => t.name);

    // Assert notify_human is present
    expect(toolNames).toContain('notify_human');

    // Assert all 11 Plan B tools are present
    expect(toolNames).toContain('create_wallet');
    expect(toolNames).toContain('get_address');
    expect(toolNames).toContain('get_balance');
    expect(toolNames).toContain('send_usdc');
    expect(toolNames).toContain('sign_message');
    expect(toolNames).toContain('sign_typed_data');
    expect(toolNames).toContain('bridge_to_polygon');
    expect(toolNames).toContain('bridge_to_base');
    expect(toolNames).toContain('get_bridge_status');
    expect(toolNames).toContain('pay_with_usdc');
    expect(toolNames).toContain('get_payment_status');
  });

  it('calls notifyHuman and returns result on tools/call', async () => {
    const app = createApp(APP_OPTIONS);
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer valid-token')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'notify_human',
          arguments: { message: 'hello' },
        },
      });
    expect(res.status).toBe(200);
    expect(vi.mocked(notifyHuman)).toHaveBeenCalledWith(
      { message: 'hello' },
      sampleClaims,
    );
    const body = res.body as { result?: { content?: Array<{ type: string; text: string }> } };
    expect(body.result?.content).toBeDefined();
    const text = body.result!.content![0]!.text;
    expect(JSON.parse(text)).toEqual({ sent: true, topic: 'test-topic' });
  });
});
