import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TrustError } from '../trust.js';
import type { PassportClaims } from '../types.js';

// ────────────────────────────────────────────────────────────
// Module mocks
// ────────────────────────────────────────────────────────────
vi.mock('../capabilities/triggers/index.js', () => ({
  matchAndFire: vi.fn().mockResolvedValue(undefined),
  loadActiveTriggers: vi.fn(),
}));

vi.mock('../config.js', () => ({
  readConfig: vi.fn(),
  CONFIG_DIR: '/tmp/test-haf-rss',
  ensureConfigDir: vi.fn(),
}));

vi.mock('better-sqlite3', () => {
  let db: import('better-sqlite3').Database | null = null;
  const Ctor = vi.fn(function (_path: string) {
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
import { createFeed, addFeedItem, serveFeed, registerRssRoutes } from '../capabilities/rss/index.js';
import { matchAndFire } from '../capabilities/triggers/index.js';
import { _resetDb } from '../spend-tracker.js';

const MockDatabase = Database as unknown as { resetDb: () => void };

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
function makeL3Claims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return {
    passportId: 'p1',
    agentId: 'a1',
    trustLevel: 3,
    trustStatus: 'seller_confirmed',
    flags: [],
    isDisputed: false,
    version: '1',
    ...overrides,
  };
}

function makeL2Claims(): PassportClaims {
  return { ...makeL3Claims(), trustLevel: 2, trustStatus: 'creator_claimed' };
}

beforeEach(() => {
  MockDatabase.resetDb();
  _resetDb();
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────
// create_feed
// ────────────────────────────────────────────────────────────
describe('create_feed', () => {
  it('throws TrustError for L2 caller (needs L3)', async () => {
    await expect(
      createFeed({ label: 'my-feed', title: 'My Feed', description: 'Test', link: 'https://example.com' }, makeL2Claims()),
    ).rejects.toThrow(TrustError);
  });

  it('creates feed and returns label + feedUrl for L3 caller', async () => {
    const result = await createFeed(
      { label: 'test-feed', title: 'Test Feed', description: 'A test feed', link: 'https://example.com' },
      makeL3Claims(),
    );
    expect(result.label).toBe('test-feed');
    expect(result.feedUrl).toBe('/feeds/test-feed');
  });

  it('throws on duplicate label', async () => {
    await createFeed(
      { label: 'dup-feed', title: 'Dup', description: 'desc', link: 'https://x.com' },
      makeL3Claims(),
    );
    await expect(
      createFeed({ label: 'dup-feed', title: 'Dup2', description: 'desc2', link: 'https://y.com' }, makeL3Claims()),
    ).rejects.toThrow();
  });
});

// ────────────────────────────────────────────────────────────
// add_feed_item
// ────────────────────────────────────────────────────────────
describe('add_feed_item', () => {
  it('throws TrustError for L2 caller (needs L3)', async () => {
    await expect(
      addFeedItem({ feed_label: 'any', title: 'Item', description: 'desc' }, makeL2Claims()),
    ).rejects.toThrow(TrustError);
  });

  it('throws error when feed does not exist', async () => {
    await expect(
      addFeedItem({ feed_label: 'nonexistent', title: 'Item', description: 'desc' }, makeL3Claims()),
    ).rejects.toThrow(/not found/);
  });

  it('adds item to feed for L3 caller', async () => {
    await createFeed(
      { label: 'items-feed', title: 'Feed', description: 'desc', link: 'https://example.com' },
      makeL3Claims(),
    );
    const result = await addFeedItem(
      { feed_label: 'items-feed', title: 'New Item', description: 'Item description', url: 'https://example.com/1' },
      makeL3Claims(),
    );
    expect(result.feed_label).toBe('items-feed');
    expect(result.title).toBe('New Item');
    expect(result.date).toBeTruthy();

    // Verify matchAndFire was called with correct source and payload
    expect(matchAndFire).toHaveBeenCalledWith('rss', expect.objectContaining({
      feed_label: 'items-feed',
      title: 'New Item',
      description: 'Item description',
      url: 'https://example.com/1',
    }));
  });
});

// ────────────────────────────────────────────────────────────
// serve_feed
// ────────────────────────────────────────────────────────────
describe('serve_feed', () => {
  it('throws TrustError for L2 caller (needs L3)', async () => {
    // Need to create the feed first so it doesn't fail on "not found"
    await createFeed(
      { label: 'srv-feed', title: 'Feed', description: 'desc', link: 'https://example.com' },
      makeL3Claims(),
    );
    await expect(serveFeed({ label: 'srv-feed' }, makeL2Claims())).rejects.toThrow(TrustError);
  });

  it('returns local feedUrl when no tunnel exists', async () => {
    await createFeed(
      { label: 'local-feed', title: 'Feed', description: 'desc', link: 'https://example.com' },
      makeL3Claims(),
    );
    const result = await serveFeed({ label: 'local-feed' }, makeL3Claims());
    expect(result.feedUrl).toBe('/feeds/local-feed');
    expect(result.publicUrl).toBeUndefined();
  });

  it('throws when feed does not exist', async () => {
    await expect(serveFeed({ label: 'ghost' }, makeL3Claims())).rejects.toThrow(/not found/);
  });
});

// ────────────────────────────────────────────────────────────
// registerRssRoutes / feed XML
// ────────────────────────────────────────────────────────────
describe('registerRssRoutes', () => {
  it('exports a function', () => {
    expect(typeof registerRssRoutes).toBe('function');
  });

  it('serves 404 for unknown feed label', async () => {
    // Import supertest dynamically to avoid hoisting issues
    const supertest = await import('supertest');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    registerRssRoutes(app);

    const res = await supertest.default(app).get('/feeds/nonexistent');
    expect(res.status).toBe(404);
  });

  it('serves RSS XML for existing feed', async () => {
    // Create a feed + item first
    await createFeed(
      { label: 'xml-feed', title: 'XML Feed', description: 'Test XML', link: 'https://example.com' },
      makeL3Claims(),
    );
    await addFeedItem(
      { feed_label: 'xml-feed', title: 'Test Item', description: 'Item desc', url: 'https://example.com/item1' },
      makeL3Claims(),
    );

    const supertest = await import('supertest');
    const express = await import('express');
    const app = express.default();
    registerRssRoutes(app);

    const res = await supertest.default(app).get('/feeds/xml-feed');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/rss\+xml/);
    expect(res.text).toContain('XML Feed');
    expect(res.text).toContain('Test Item');
  });
});
