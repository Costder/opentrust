import { vi, describe, it, expect, beforeEach } from 'vitest';
import { notifyHuman } from '../capabilities/notify/index.js';
import { TrustError, DisputedError } from '../trust.js';
import type { PassportClaims } from '../types.js';

// Module-level mock — hoisted to the top; individual tests override via mockReturnValue
vi.mock('../secrets.js', () => ({
  getNotifyTopic: vi.fn(() => ({ topic: 'test-topic', serverUrl: 'https://ntfy.sh' })),
}));

// Import after mock so we can spy on it
import { getNotifyTopic } from '../secrets.js';

function makeL2Claims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return {
    passportId: 'test-passport',
    agentId: 'test-agent',
    trustLevel: 2,
    trustStatus: 'creator_claimed',
    flags: [],
    isDisputed: false,
    version: '1',
    ...overrides,
  };
}

function makeMockFetch(status = 200, body = 'ok') {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  });
}

describe('notifyHuman', () => {
  beforeEach(() => {
    // Reset getNotifyTopic back to the default for each test
    vi.mocked(getNotifyTopic).mockReturnValue({
      topic: 'test-topic',
      serverUrl: 'https://ntfy.sh',
    });
    vi.restoreAllMocks();
  });

  it('calls fetch with correct URL for a valid L2 passport', async () => {
    vi.mocked(getNotifyTopic).mockReturnValue({ topic: 'test-topic', serverUrl: 'https://ntfy.sh' });
    const mockFetch = makeMockFetch();
    vi.stubGlobal('fetch', mockFetch);

    await notifyHuman({ message: 'hello' }, makeL2Claims());

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ntfy.sh/test-topic');
  });

  it('uses POST method', async () => {
    vi.mocked(getNotifyTopic).mockReturnValue({ topic: 'test-topic', serverUrl: 'https://ntfy.sh' });
    const mockFetch = makeMockFetch();
    vi.stubGlobal('fetch', mockFetch);

    await notifyHuman({ message: 'hello' }, makeL2Claims());

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(options.method).toBe('POST');
  });

  it('uses default Title header when no title is provided', async () => {
    vi.mocked(getNotifyTopic).mockReturnValue({ topic: 'test-topic', serverUrl: 'https://ntfy.sh' });
    const mockFetch = makeMockFetch();
    vi.stubGlobal('fetch', mockFetch);

    await notifyHuman({ message: 'hello' }, makeL2Claims());

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['Title']).toBe('Hands and Feet');
  });

  it('uses default Priority header when no priority is provided', async () => {
    vi.mocked(getNotifyTopic).mockReturnValue({ topic: 'test-topic', serverUrl: 'https://ntfy.sh' });
    const mockFetch = makeMockFetch();
    vi.stubGlobal('fetch', mockFetch);

    await notifyHuman({ message: 'hello' }, makeL2Claims());

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['Priority']).toBe('default');
  });

  it('sends the message as the request body', async () => {
    vi.mocked(getNotifyTopic).mockReturnValue({ topic: 'test-topic', serverUrl: 'https://ntfy.sh' });
    const mockFetch = makeMockFetch();
    vi.stubGlobal('fetch', mockFetch);

    await notifyHuman({ message: 'test message body' }, makeL2Claims());

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(options.body).toBe('test message body');
  });

  it('uses custom title when provided', async () => {
    vi.mocked(getNotifyTopic).mockReturnValue({ topic: 'test-topic', serverUrl: 'https://ntfy.sh' });
    const mockFetch = makeMockFetch();
    vi.stubGlobal('fetch', mockFetch);

    await notifyHuman({ message: 'hello', title: 'My Custom Title' }, makeL2Claims());

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['Title']).toBe('My Custom Title');
  });

  it('uses custom priority when provided', async () => {
    vi.mocked(getNotifyTopic).mockReturnValue({ topic: 'test-topic', serverUrl: 'https://ntfy.sh' });
    const mockFetch = makeMockFetch();
    vi.stubGlobal('fetch', mockFetch);

    await notifyHuman({ message: 'hello', priority: 'urgent' }, makeL2Claims());

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['Priority']).toBe('urgent');
  });

  it('throws TrustError for L1 passport (trust level 1)', async () => {
    vi.mocked(getNotifyTopic).mockReturnValue({ topic: 'test-topic', serverUrl: 'https://ntfy.sh' });
    const mockFetch = makeMockFetch();
    vi.stubGlobal('fetch', mockFetch);

    const l1Claims = makeL2Claims({ trustLevel: 1, trustStatus: 'auto_generated_draft' });
    await expect(notifyHuman({ message: 'hello' }, l1Claims)).rejects.toThrow(TrustError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws DisputedError for disputed passport', async () => {
    vi.mocked(getNotifyTopic).mockReturnValue({ topic: 'test-topic', serverUrl: 'https://ntfy.sh' });
    const mockFetch = makeMockFetch();
    vi.stubGlobal('fetch', mockFetch);

    const disputedClaims = makeL2Claims({ isDisputed: true });
    await expect(notifyHuman({ message: 'hello' }, disputedClaims)).rejects.toThrow(DisputedError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws Error containing status code when ntfy.sh returns 500', async () => {
    vi.mocked(getNotifyTopic).mockReturnValue({ topic: 'test-topic', serverUrl: 'https://ntfy.sh' });
    const mockFetch = makeMockFetch(500, 'Internal Server Error');
    vi.stubGlobal('fetch', mockFetch);

    await expect(notifyHuman({ message: 'hello' }, makeL2Claims())).rejects.toThrow('500');
  });

  it('returns { sent: true, topic } on success', async () => {
    vi.mocked(getNotifyTopic).mockReturnValue({ topic: 'test-topic', serverUrl: 'https://ntfy.sh' });
    const mockFetch = makeMockFetch();
    vi.stubGlobal('fetch', mockFetch);

    const result = await notifyHuman({ message: 'hello' }, makeL2Claims());
    expect(result).toEqual({ sent: true, topic: 'test-topic' });
  });

  it('URL-encodes topics with special characters', async () => {
    vi.mocked(getNotifyTopic).mockReturnValue({
      topic: 'my topic/with spaces&chars',
      serverUrl: 'https://ntfy.sh',
    });
    const mockFetch = makeMockFetch();
    vi.stubGlobal('fetch', mockFetch);

    await notifyHuman({ message: 'hello' }, makeL2Claims());

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(' ');
    expect(url).toContain(encodeURIComponent('my topic/with spaces&chars'));
  });
});
