import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { MoonClient } from '../capabilities/cards/moon-client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

function makeErrorResponse(status: number, text: string): Response {
  return {
    ok: false,
    status,
    json: vi.fn(),
    text: vi.fn().mockResolvedValue(text),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MoonClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // URL selection
  // -------------------------------------------------------------------------

  describe('base URL selection', () => {
    it('uses production URL when sandbox: false', async () => {
      mockFetch.mockResolvedValue(makeOkResponse({ id: 'card-1', product: 'moon_x' }));
      const client = new MoonClient({ consumerKey: 'key', consumerSecret: 'secret', sandbox: false });
      await client.get('/cards');
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toBe('https://api.paywithmoon.com/v1/cards');
    });

    it('uses sandbox URL when sandbox: true', async () => {
      mockFetch.mockResolvedValue(makeOkResponse({ id: 'card-1', product: 'moon_x' }));
      const client = new MoonClient({ consumerKey: 'key', consumerSecret: 'secret', sandbox: true });
      await client.get('/cards');
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toBe('https://sandbox.api.paywithmoon.com/v1/cards');
    });
  });

  // -------------------------------------------------------------------------
  // OAuth header presence
  // -------------------------------------------------------------------------

  describe('OAuth Authorization header', () => {
    it('includes Authorization header in every request', async () => {
      mockFetch.mockResolvedValue(makeOkResponse({ id: 'card-1', product: 'moon_x' }));
      const client = new MoonClient({ consumerKey: 'mykey', consumerSecret: 'mysecret', sandbox: true });
      await client.get('/cards');
      const calledOptions = mockFetch.mock.calls[0][1] as RequestInit;
      const headers = calledOptions.headers as Record<string, string>;
      expect(headers['Authorization']).toBeDefined();
      expect(headers['Authorization']).toMatch(/^OAuth /);
    });

    it('Authorization header contains oauth_consumer_key', async () => {
      mockFetch.mockResolvedValue(makeOkResponse({}));
      const client = new MoonClient({ consumerKey: 'myConsumerKey', consumerSecret: 'secret', sandbox: true });
      await client.post('/cards', { product: 'moon_x' });
      const calledOptions = mockFetch.mock.calls[0][1] as RequestInit;
      const headers = calledOptions.headers as Record<string, string>;
      expect(headers['Authorization']).toContain('oauth_consumer_key');
    });

    it('sets Content-Type and Accept headers', async () => {
      mockFetch.mockResolvedValue(makeOkResponse({}));
      const client = new MoonClient({ consumerKey: 'k', consumerSecret: 's', sandbox: false });
      await client.get('/test');
      const calledOptions = mockFetch.mock.calls[0][1] as RequestInit;
      const headers = calledOptions.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Accept']).toBe('application/json');
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('throws with status code on non-2xx response', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(401, 'Unauthorized'));
      const client = new MoonClient({ consumerKey: 'k', consumerSecret: 's', sandbox: true });
      await expect(client.get('/cards')).rejects.toThrow('Moon API 401: Unauthorized');
    });

    it('throws with 404 status on not-found', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(404, 'Card not found'));
      const client = new MoonClient({ consumerKey: 'k', consumerSecret: 's', sandbox: true });
      await expect(client.get('/cards/missing')).rejects.toThrow('Moon API 404: Card not found');
    });

    it('throws with 500 on server error', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(500, 'Internal Server Error'));
      const client = new MoonClient({ consumerKey: 'k', consumerSecret: 's', sandbox: false });
      await expect(client.post('/cards', {})).rejects.toThrow('Moon API 500');
    });
  });

  // -------------------------------------------------------------------------
  // HTTP method delegation
  // -------------------------------------------------------------------------

  describe('HTTP method helpers', () => {
    it('get() calls request with GET method', async () => {
      mockFetch.mockResolvedValue(makeOkResponse({ data: 'ok' }));
      const client = new MoonClient({ consumerKey: 'k', consumerSecret: 's', sandbox: true });
      await client.get('/some-path');
      const calledOptions = mockFetch.mock.calls[0][1] as RequestInit;
      expect(calledOptions.method).toBe('GET');
      expect(calledOptions.body).toBeUndefined();
    });

    it('post() calls request with POST method and body', async () => {
      mockFetch.mockResolvedValue(makeOkResponse({ id: 'new' }));
      const client = new MoonClient({ consumerKey: 'k', consumerSecret: 's', sandbox: true });
      await client.post('/cards', { product: 'moon_x' });
      const calledOptions = mockFetch.mock.calls[0][1] as RequestInit;
      expect(calledOptions.method).toBe('POST');
      expect(calledOptions.body).toBe(JSON.stringify({ product: 'moon_x' }));
    });

    it('patch() calls request with PATCH method and body', async () => {
      mockFetch.mockResolvedValue(makeOkResponse({}));
      const client = new MoonClient({ consumerKey: 'k', consumerSecret: 's', sandbox: true });
      await client.patch('/cards/abc', { status: 'frozen' });
      const calledOptions = mockFetch.mock.calls[0][1] as RequestInit;
      expect(calledOptions.method).toBe('PATCH');
      expect(calledOptions.body).toBe(JSON.stringify({ status: 'frozen' }));
    });

    it('delete() calls request with DELETE method and no body', async () => {
      mockFetch.mockResolvedValue(makeOkResponse({}));
      const client = new MoonClient({ consumerKey: 'k', consumerSecret: 's', sandbox: true });
      await client.delete('/cards/abc');
      const calledOptions = mockFetch.mock.calls[0][1] as RequestInit;
      expect(calledOptions.method).toBe('DELETE');
      expect(calledOptions.body).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Request body handling
  // -------------------------------------------------------------------------

  describe('body handling', () => {
    it('does not send body when body is undefined', async () => {
      mockFetch.mockResolvedValue(makeOkResponse({}));
      const client = new MoonClient({ consumerKey: 'k', consumerSecret: 's', sandbox: true });
      await client.get('/cards');
      const calledOptions = mockFetch.mock.calls[0][1] as RequestInit;
      expect(calledOptions.body).toBeUndefined();
    });

    it('serializes body as JSON string', async () => {
      mockFetch.mockResolvedValue(makeOkResponse({ id: '1' }));
      const client = new MoonClient({ consumerKey: 'k', consumerSecret: 's', sandbox: false });
      const payload = { product: 'moon_1x', amount: 100 };
      await client.post('/cards', payload);
      const calledOptions = mockFetch.mock.calls[0][1] as RequestInit;
      expect(calledOptions.body).toBe(JSON.stringify(payload));
    });
  });
});
