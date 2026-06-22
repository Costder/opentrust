# OpenTrust — Discovery & Marketing Feature Plan

**Handoff document for the implementing agent.** This file is the single source of truth for all discovery and marketing scaffold work. The agent picking this up should assume zero prior context and follow these instructions top to bottom.

---

## 0. Project orientation

OpenTrust is a **trust registry + marketplace for AI agent tools** built on:
- **Frontend:** Next.js 14 App Router, TypeScript, Tailwind CSS
- **Backend:** Python FastAPI (`api/`)
- **Payments:** USDC on Base L2 via Coinbase Commerce
- **Database:** PostgreSQL (migrations live in `api/migrations/`)

### Design system tokens (Tailwind `tailwind.config.js`)
| Token | Hex | Usage |
|-------|-----|-------|
| `ink` | `#18201b` | Body text, dark backgrounds |
| `moss` | `#3f6b4f` | Primary actions, trust badges |
| `signal` | `#c95635` | Alerts, CTAs, featured accents |
| `paper` | `#f7f5ee` | Page backgrounds, card surfaces |

All colors are exposed as Tailwind classes: `bg-ink`, `text-moss`, `bg-signal`, `text-paper`, etc.

### Existing component patterns (study before adding new ones)
- Components live in `web/src/components/`
- Pages live in `web/src/app/<route>/page.tsx`
- Layout wraps every page: `Navigation` + `<main className="mx-auto max-w-6xl px-4 py-8">` + `Footer`
- Use `'use client'` directive only when a component needs state/interactivity
- No external UI libraries — pure Tailwind with the above tokens

---

## 1. Feature inventory

Six features are scaffolded. Each section gives: what it does, which files to touch, and the exact schema/API signatures the backend must expose.

---

### 1.1 Semantic search + tag filter

**Goal:** Replace the current dumb text search with a tag-based filter bar and fuzzy semantic results so buyers can find tools by capability, not just name.

**Files to implement:**

#### Database migration
`api/migrations/004_add_discovery_tables.sql` — create these tables:

```sql
-- Searchable embedding vector per listing
CREATE TABLE tool_embeddings (
  listing_id UUID PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  embedding   vector(1536),         -- OpenAI text-embedding-3-small
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Flat tag vocabulary
CREATE TABLE tags (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,        -- kebab-case, e.g. "file-system"
  name TEXT NOT NULL                -- Display name, e.g. "File System"
);

-- Many-to-many listing ↔ tag
CREATE TABLE listing_tags (
  listing_id UUID REFERENCES listings(id) ON DELETE CASCADE,
  tag_id     UUID REFERENCES tags(id)     ON DELETE CASCADE,
  PRIMARY KEY (listing_id, tag_id)
);

-- Seed common tags
INSERT INTO tags (slug, name) VALUES
  ('file-system',   'File System'),
  ('web-browser',   'Web Browser'),
  ('email',         'Email'),
  ('payments',      'Payments'),
  ('calendar',      'Calendar'),
  ('database',      'Database'),
  ('code-exec',     'Code Execution'),
  ('image-gen',     'Image Generation'),
  ('communication', 'Communication'),
  ('data-extract',  'Data Extraction');
```

#### Backend route
`api/src/routes/search.py` — scaffold file already created (see scaffold section below). Expose:

```
GET  /api/search?q=<text>&tags=<slug,slug>&page=1&limit=20
     → { results: [ListingSearchResult], total: int, page: int }

GET  /api/tags
     → Tag[]
```

`ListingSearchResult` shape:
```python
{
  "id":          str,
  "name":        str,
  "description": str,
  "trust_tier":  int,       # 1–4
  "tags":        list[str], # slugs
  "is_featured": bool,
  "used_by_count": int,
  "avg_rating":  float | None,
  "seller":      {"id": str, "name": str}
}
```

#### Frontend page
`web/src/app/search/page.tsx` — scaffold already created. Renders:
1. `<TagFilter>` component (multi-select tag pills)
2. Search input (wired to `?q=` query param)
3. Results grid using `<ToolCard>` (existing component)
4. Pagination (simple prev/next)

#### Frontend component
`web/src/components/TagFilter.tsx` — scaffold created. Props:
```typescript
interface TagFilterProps {
  tags: { slug: string; name: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
}
```
Renders as a horizontal scrollable row of pill buttons. Selected pills use `bg-moss text-paper`. Unselected use `border border-ink/20 text-ink`.

---

### 1.2 Seller analytics dashboard

**Goal:** Give sellers a self-serve dashboard showing listing views, installs, and revenue so they have a reason to improve their listings.

**Files to implement:**

#### Database migration
In `api/migrations/004_add_discovery_tables.sql` (same file, append):

```sql
CREATE TABLE listing_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,  -- 'view' | 'install' | 'badge_click' | 'embed_click'
  actor_id   UUID,           -- nullable; agent or user who triggered event
  metadata   JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX listing_events_listing_id_idx ON listing_events(listing_id, created_at DESC);
```

#### Backend route
`api/src/routes/analytics.py` — scaffold created. Exposes:

```
GET /api/analytics/listings/{listing_id}
    Query params: ?from=ISO8601&to=ISO8601&granularity=day|week|month
    Returns: {
      listing_id: str,
      period: {from: str, to: str},
      totals: { views: int, installs: int, revenue_usdc: float, badge_clicks: int },
      timeseries: [{ date: str, views: int, installs: int, revenue_usdc: float }]
    }
```

Auth: the requesting user must own the listing (check `listings.seller_id`).

#### Frontend page
`web/src/app/dashboard/analytics/page.tsx` — scaffold created. Shows:
1. Listing selector dropdown (seller's own listings)
2. Date range picker (last 7d / 30d / 90d)
3. Four `<AnalyticsCard>` stat boxes: Views, Installs, Revenue, Badge Clicks
4. Sparkline chart (use plain SVG — no chart library dependency)

#### Frontend component
`web/src/components/AnalyticsCard.tsx` — scaffold created. Props:
```typescript
interface AnalyticsCardProps {
  label: string;
  value: string | number;
  delta?: number;    // % change vs prior period, positive = good
  icon?: React.ReactNode;
}
```
Delta shown as green `▲ +X%` or red `▼ -X%` using Tailwind color classes only.

---

### 1.3 Featured listings

**Goal:** Paid or curated promoted listings that appear at the top of search/marketplace with a visual accent.

**Files to implement:**

#### Database migration
In `api/migrations/004_add_discovery_tables.sql` (append):

```sql
CREATE TABLE featured_listings (
  listing_id  UUID PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  starts_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at     TIMESTAMPTZ,           -- NULL = permanent (admin-curated)
  placement   TEXT NOT NULL DEFAULT 'marketplace_top', -- 'marketplace_top' | 'search_top' | 'homepage'
  created_by  UUID                   -- admin user id
);
```

#### Backend route
`api/src/routes/featured.py` — scaffold created.

```
GET  /api/featured?placement=marketplace_top
     → FeaturedListing[]

POST /api/admin/featured        (admin only)
     Body: { listing_id, placement, starts_at, ends_at }
     → FeaturedListing

DELETE /api/admin/featured/{listing_id}  (admin only)
```

#### Frontend component
`web/src/components/FeaturedBadge.tsx` — scaffold created.

```typescript
// Simple accent badge shown on featured ToolCards
interface FeaturedBadgeProps {
  compact?: boolean; // true = just a colored dot, false = full "Featured" pill
}
```

Style: `bg-signal text-paper` pill, rounded-full, small text. Add a subtle `ring-1 ring-signal/40` to the parent card container when featured.

---

### 1.4 Embeddable trust badge + install button

**Goal:** Sellers embed a live SVG badge on their own docs/README. Clicking it deep-links back to OpenTrust. This drives referral traffic and signals trust to potential buyers.

**Files to implement:**

#### Backend routes
`api/src/routes/embed.py` — scaffold created (see below). Exposes:

```
GET /badge/{listing_id}.svg
    → SVG image with trust tier, tool name, and moss/signal accent
    Headers: Content-Type: image/svg+xml, Cache-Control: public max-age=3600

GET /embed/{listing_id}
    → JSON: { name, trust_tier, install_url, badge_svg_url, last_verified_at }
```

#### Frontend page (embed preview)
`web/src/app/tools/[id]/embed/page.tsx` — scaffold created. Shows:
1. Live badge preview
2. Copy-paste HTML snippet: `<a href="..."><img src="https://opentrust.sh/badge/{id}.svg"></a>`
3. NPM/MCP config install snippet (reuse existing `<CopyButton>` component)

---

### 1.5 Verified reviews + "used by X agents" counter

**Goal:** Social proof. Agents that have installed/used a tool can leave a 1–5 star review. A public counter shows adoption signal to new buyers.

**Files to implement:**

#### Database migration
In `api/migrations/004_add_discovery_tables.sql` (append):

```sql
CREATE TABLE listing_reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL,          -- agent or user who used the tool
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        TEXT,                   -- optional text up to 1000 chars
  verified    BOOLEAN DEFAULT false,  -- true if reviewer actually installed
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (listing_id, reviewer_id)    -- one review per reviewer per listing
);

-- Materialized counter (updated by trigger or background job)
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS used_by_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_rating    NUMERIC(3,2);
```

#### Backend routes
`api/src/routes/reviews.py` — scaffold created.

```
GET    /api/listings/{id}/reviews?page=1&limit=10
       → { reviews: Review[], total: int, avg_rating: float, used_by_count: int }

POST   /api/listings/{id}/reviews
       Body: { rating: int, body?: str }
       Auth: must be signed-in agent with verified install
       → Review

DELETE /api/listings/{id}/reviews/{review_id}
       Auth: reviewer or admin only
```

#### Frontend component
`web/src/components/ReviewsSection.tsx` — scaffold created.

```typescript
interface ReviewsSectionProps {
  listingId: string;
  initialReviews?: Review[];
  usedByCount: number;
  avgRating: number | null;
}
```

Renders: star rating summary bar, "Used by N agents" counter, scrollable list of `<ReviewCard>` sub-components. Star color = `text-signal`. Verified badge = small `moss` checkmark.

#### Frontend component
`web/src/components/UsedByCounter.tsx` — scaffold created.

```typescript
interface UsedByCounterProps {
  count: number;
  compact?: boolean;
}
// compact = just "47 agents" inline text
// full = card with icon + label
```

---

### 1.6 Curated collections

**Goal:** Editorial/algorithmic groupings like "Top payment tools", "Free & open source", "L4 verified only" that create browse-worthy destinations and help with SEO/landing pages.

**Files to implement:**

#### Database migration
In `api/migrations/004_add_discovery_tables.sql` (append):

```sql
CREATE TABLE collections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT UNIQUE NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  cover_emoji TEXT DEFAULT '📦',
  is_public   BOOLEAN DEFAULT true,
  created_by  UUID,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE collection_items (
  collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
  listing_id    UUID REFERENCES listings(id)    ON DELETE CASCADE,
  rank          INT DEFAULT 0,
  PRIMARY KEY (collection_id, listing_id)
);

-- Seed starter collections
INSERT INTO collections (slug, title, description, cover_emoji) VALUES
  ('top-payment-tools',  'Top Payment Tools',      'USDC, Stripe, and crypto payment MCPs', '💳'),
  ('free-open-source',   'Free & Open Source',     'Community-built tools at no cost',       '🆓'),
  ('l4-verified',        'L4 Verified Only',        'The highest trust tier on OpenTrust',   '✅'),
  ('getting-started',    'Getting Started Pack',    'Best tools for new agent builders',     '🚀');
```

#### Backend routes
`api/src/routes/collections.py` — scaffold created.

```
GET  /api/collections
     → Collection[]

GET  /api/collections/{slug}
     → { collection: Collection, listings: ListingSearchResult[] }

POST /api/admin/collections        (admin only)
POST /api/admin/collections/{id}/items  (admin only)
```

#### Frontend page
`web/src/app/collections/[slug]/page.tsx` — scaffold created. Renders:
1. Collection header: emoji, title, description
2. Grid of `<ToolCard>` components
3. Breadcrumb back to `/collections`

`web/src/app/collections/page.tsx` — collections index. Grid of `<CollectionCard>`.

#### Frontend component
`web/src/components/CollectionCard.tsx` — scaffold created.

```typescript
interface CollectionCardProps {
  slug: string;
  title: string;
  description: string;
  coverEmoji: string;
  listingCount: number;
}
```

Style: `bg-paper border border-ink/10 rounded-xl p-6`, emoji large (text-4xl), hover state `hover:border-moss/40 hover:shadow-sm`.

---

## 2. Navigation updates

Add these links to `web/src/components/Navigation.tsx`:
- `/search` — "Explore" (replaces or supplements existing search)
- `/collections` — "Collections"
- `/dashboard/analytics` — "Dashboard" (show only when user is a seller — gate with auth check)

---

## 3. Implementation order (for the agent)

Execute in this order to minimize blocked work:

1. **Migration** — create `api/migrations/004_add_discovery_tables.sql` (all tables in one file)
2. **Backend routes** — create stubs in `api/src/routes/`: `search.py`, `analytics.py`, `featured.py`, `embed.py`, `reviews.py`, `collections.py`
3. **Register routes** — add them to `api/src/main.py` with `app.include_router(...)`
4. **Frontend components** — create in `web/src/components/`: `TagFilter.tsx`, `FeaturedBadge.tsx`, `ReviewsSection.tsx`, `UsedByCounter.tsx`, `AnalyticsCard.tsx`, `CollectionCard.tsx`
5. **Frontend pages** — create: `web/src/app/search/page.tsx`, `web/src/app/dashboard/analytics/page.tsx`, `web/src/app/collections/page.tsx`, `web/src/app/collections/[slug]/page.tsx`, `web/src/app/tools/[id]/embed/page.tsx`
6. **Navigation** — update `web/src/components/Navigation.tsx` to add new links
7. **Verify** — run `cd web && npm run build` to confirm no TypeScript errors

---

## 4. Scaffold files

The following files already exist in the repo as starting points. **Do not overwrite them — flesh them out:**

- `api/src/routes/search.py`
- `api/src/routes/analytics.py`
- `api/src/routes/featured.py`
- `api/src/routes/embed.py`
- `api/src/routes/reviews.py`
- `api/src/routes/collections.py`
- `api/migrations/004_add_discovery_tables.sql`
- `web/src/components/TagFilter.tsx`
- `web/src/components/FeaturedBadge.tsx`
- `web/src/components/ReviewsSection.tsx`
- `web/src/components/UsedByCounter.tsx`
- `web/src/components/AnalyticsCard.tsx`
- `web/src/components/CollectionCard.tsx`
- `web/src/app/search/page.tsx`
- `web/src/app/dashboard/analytics/page.tsx`
- `web/src/app/collections/page.tsx`
- `web/src/app/collections/[slug]/page.tsx`
- `web/src/app/tools/[id]/embed/page.tsx`

---

## 5. Non-goals (do not implement yet)

- Real vector search (use PostgreSQL ILIKE for v1 search — add pgvector later)
- Embedding generation pipeline
- Payment flow for featured listings (admin-curated only for now)
- Email notifications for new reviews
- A/B testing or analytics dashboards beyond the seller self-serve view
