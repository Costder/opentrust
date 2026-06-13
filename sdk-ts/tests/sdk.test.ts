import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenTrust } from "../src/index.js";
import type { Passport } from "../src/types.js";

const FAKE_PASSPORT: Passport = {
  id: "abc123",
  slug: "github-file-search",
  name: "GitHub File Search",
  description: "Search repos",
  trust_status: "community_reviewed",
  tool_identity: { slug: "github-file-search", name: "GitHub File Search" },
  capabilities: ["search"],
  permission_manifest: { network: true, file: false, terminal: false, wallet: false },
  commercial_status: { status: "free" },
  agent_access: { allowed: true },
};

const FAKE_PAGE = { items: [FAKE_PASSPORT], total: 1, page: 1, limit: 20 };

function mockFetch(data: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status < 400,
      status,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    })
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("OpenTrust.get", () => {
  it("fetches and returns the raw passport", async () => {
    mockFetch(FAKE_PASSPORT);
    const client = new OpenTrust({ apiUrl: "http://test" });
    const result = await client.get("github-file-search");
    expect(result.slug).toBe("github-file-search");
  });

  it("encodes the slug in the URL", async () => {
    mockFetch(FAKE_PASSPORT);
    const client = new OpenTrust({ apiUrl: "http://test" });
    await client.get("my tool");
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    expect(String(fetchCall?.[0])).toContain("my%20tool");
  });

  it("throws on non-ok response", async () => {
    mockFetch({ detail: "not found" }, 404);
    const client = new OpenTrust({ apiUrl: "http://test" });
    await expect(client.get("missing")).rejects.toThrow("404");
  });
});

describe("OpenTrust.verify", () => {
  it("returns VerifyResult with correct trust level", async () => {
    mockFetch(FAKE_PASSPORT);
    const client = new OpenTrust({ apiUrl: "http://test" });
    const result = await client.verify("github-file-search");
    expect(result.trustStatus).toBe("community_reviewed");
    expect(result.trustLevel).toBe(4);
    expect(result.isDisputed).toBe(false);
    expect(result.risk).toBe("medium");
    expect(result.recommendation).toContain("Community reviewed");
  });

  it("marks disputed passports correctly", async () => {
    mockFetch({ ...FAKE_PASSPORT, trust_status: "disputed" });
    const client = new OpenTrust({ apiUrl: "http://test" });
    const result = await client.verify("github-file-search");
    expect(result.isDisputed).toBe(true);
    expect(result.trustLevel).toBe(0);
    expect(result.risk).toBe("high");
  });
});

describe("OpenTrust.search", () => {
  it("returns list of passports", async () => {
    mockFetch(FAKE_PAGE);
    const client = new OpenTrust({ apiUrl: "http://test" });
    const results = await client.search("github");
    expect(Array.isArray(results)).toBe(true);
    expect(results[0]?.slug).toBe("github-file-search");
  });

  it("includes trust_status param when given", async () => {
    mockFetch(FAKE_PAGE);
    const client = new OpenTrust({ apiUrl: "http://test" });
    await client.search("github", { trustStatus: "security_checked" });
    const url = String(vi.mocked(fetch).mock.calls[0]?.[0]);
    expect(url).toContain("trust_status=security_checked");
  });
});

describe("OpenTrust.list", () => {
  it("returns a ToolsPage", async () => {
    mockFetch(FAKE_PAGE);
    const client = new OpenTrust({ apiUrl: "http://test" });
    const page = await client.list({ trustStatus: "community_reviewed" });
    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
  });

  it("includes page and limit params", async () => {
    mockFetch(FAKE_PAGE);
    const client = new OpenTrust({ apiUrl: "http://test" });
    await client.list({ page: 2, limit: 5 });
    const url = String(vi.mocked(fetch).mock.calls[0]?.[0]);
    expect(url).toContain("page=2");
    expect(url).toContain("limit=5");
  });
});
