import RSS from 'rss';
import type { Application, Request, Response } from 'express';
import { openDb } from '../../spend-tracker.js';
import { enforceTrust } from '../../trust.js';
import type { PassportClaims, ToolDefinition } from '../../types.js';

// ────────────────────────────────────────────────────────────
// Tool definitions
// ────────────────────────────────────────────────────────────
const CREATE_FEED_TOOL: ToolDefinition = { name: 'create_feed', minTrustLevel: 3 };
const ADD_FEED_ITEM_TOOL: ToolDefinition = { name: 'add_feed_item', minTrustLevel: 3 };
const SERVE_FEED_TOOL: ToolDefinition = { name: 'serve_feed', minTrustLevel: 3 };

export const RSS_TOOLS = {
  create_feed: CREATE_FEED_TOOL,
  add_feed_item: ADD_FEED_ITEM_TOOL,
  serve_feed: SERVE_FEED_TOOL,
};

// ────────────────────────────────────────────────────────────
// RSS route registration
// ────────────────────────────────────────────────────────────
export function registerRssRoutes(app: Application): void {
  app.get('/feeds/:label', (req: Request, res: Response) => {
    const db = openDb();
    const feed = db
      .prepare('SELECT * FROM rss_feeds WHERE label = ?')
      .get(req.params['label']) as
      | { label: string; title: string; description: string; link: string }
      | undefined;

    if (!feed) {
      res.status(404).send('Feed not found');
      return;
    }

    const items = db
      .prepare('SELECT * FROM rss_items WHERE feed_label = ? ORDER BY date DESC')
      .all(req.params['label']) as Array<{
        id: number;
        title: string;
        description: string;
        url: string | null;
        guid: string | null;
        date: string;
      }>;

    const rssFeed = new RSS({
      title: feed.title,
      description: feed.description,
      feed_url: req.url,
      site_url: feed.link,
    });

    for (const item of items) {
      rssFeed.item({
        title: item.title,
        description: item.description,
        url: item.url ?? feed.link,
        guid: item.guid ?? String(item.id),
        date: item.date,
      });
    }

    res.set('Content-Type', 'application/rss+xml');
    res.send(rssFeed.xml({ indent: true }));
  });
}

// ────────────────────────────────────────────────────────────
// create_feed
// ────────────────────────────────────────────────────────────
export async function createFeed(
  params: { label: string; title: string; description: string; link: string },
  claims: PassportClaims,
): Promise<{ label: string; feedUrl: string }> {
  enforceTrust(claims, CREATE_FEED_TOOL);

  const db = openDb();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO rss_feeds (label, title, description, link, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(params.label, params.title, params.description, params.link, now);

  return {
    label: params.label,
    feedUrl: `/feeds/${params.label}`,
  };
}

// ────────────────────────────────────────────────────────────
// add_feed_item
// ────────────────────────────────────────────────────────────
export async function addFeedItem(
  params: {
    feed_label: string;
    title: string;
    description: string;
    url?: string;
    guid?: string;
  },
  claims: PassportClaims,
): Promise<{ feed_label: string; title: string; date: string }> {
  enforceTrust(claims, ADD_FEED_ITEM_TOOL);

  const db = openDb();
  // Verify the feed exists
  const feed = db
    .prepare('SELECT label FROM rss_feeds WHERE label = ?')
    .get(params.feed_label);
  if (!feed) {
    throw new Error(`Feed '${params.feed_label}' not found. Create it with create_feed first.`);
  }

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO rss_items (feed_label, title, description, url, guid, date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    params.feed_label,
    params.title,
    params.description,
    params.url ?? null,
    params.guid ?? null,
    now,
  );

  return {
    feed_label: params.feed_label,
    title: params.title,
    date: now,
  };
}

// ────────────────────────────────────────────────────────────
// serve_feed
// ────────────────────────────────────────────────────────────
export async function serveFeed(
  params: { label: string },
  claims: PassportClaims,
): Promise<{ label: string; feedUrl: string; publicUrl?: string }> {
  enforceTrust(claims, SERVE_FEED_TOOL);

  const db = openDb();

  // Check feed exists
  const feed = db
    .prepare('SELECT label FROM rss_feeds WHERE label = ?')
    .get(params.label);
  if (!feed) {
    throw new Error(`Feed '${params.label}' not found.`);
  }

  const feedPath = `/feeds/${params.label}`;

  // Try to get an active tunnel URL
  const tunnel = db
    .prepare(`SELECT url FROM tunnels WHERE closed_at IS NULL ORDER BY created_at DESC LIMIT 1`)
    .get() as { url: string } | undefined;

  if (tunnel?.url) {
    return {
      label: params.label,
      feedUrl: feedPath,
      publicUrl: `${tunnel.url}${feedPath}`,
    };
  }

  return {
    label: params.label,
    feedUrl: feedPath,
  };
}
