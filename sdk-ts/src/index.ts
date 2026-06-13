import type {
  Passport,
  VerifyResult,
  ToolsPage,
  ListOptions,
  SearchOptions,
} from "./types.js";
import { buildVerifyResult, TRUST_LEVELS } from "./recommend.js";

export type {
  Passport,
  VerifyResult,
  ToolsPage,
  TrustStatus,
  ListOptions,
  SearchOptions,
} from "./types.js";
export { TRUST_LEVELS, buildRecommendation, buildRisk } from "./recommend.js";

const DEFAULT_API_URL = "https://api.opentrust.infiniterealms.io";

export class OpenTrust {
  private readonly apiUrl: string;

  constructor(options?: { apiUrl?: string }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const envUrl = typeof (globalThis as any)["process"] !== "undefined"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? ((globalThis as any)["process"] as { env: Record<string, string | undefined> }).env["OPENTRUST_API_URL"]
      : undefined;
    this.apiUrl = (options?.apiUrl ?? envUrl ?? DEFAULT_API_URL).replace(/\/$/, "");
  }

  private async _fetch<T>(path: string): Promise<T> {
    const res = await fetch(`${this.apiUrl}/api/v1${path}`);
    if (!res.ok) {
      throw new Error(`OpenTrust API error: ${res.status} ${path}`);
    }
    // Read as text first so a non-JSON response (HTML error page, proxy error,
    // truncated body) fails with diagnostic context instead of an opaque reject.
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(
        `OpenTrust API returned a non-JSON response for ${path}: ${text.slice(0, 200)}`
      );
    }
  }

  /**
   * Structurally validate a passport before any trust decision is made on it.
   * The SDK must never let an unverified/unexpected payload masquerade as a
   * passport with an arbitrary trust_status — callers act on these values.
   */
  private static _validatePassport(data: unknown): Passport {
    const obj = data as Record<string, unknown> | null;
    if (
      !obj ||
      typeof obj !== "object" ||
      typeof obj["slug"] !== "string" ||
      typeof obj["trust_status"] !== "string" ||
      !(obj["trust_status"] in TRUST_LEVELS)
    ) {
      throw new Error(
        "OpenTrust: API returned an invalid or unexpected passport structure"
      );
    }
    return obj as unknown as Passport;
  }

  async get(slug: string): Promise<Passport> {
    return OpenTrust._validatePassport(
      await this._fetch<unknown>(`/tools/${encodeURIComponent(slug)}`)
    );
  }

  async verify(slug: string): Promise<VerifyResult> {
    const passport = await this.get(slug);
    return buildVerifyResult(passport);
  }

  async search(query: string, opts?: SearchOptions): Promise<Passport[]> {
    const qs = new URLSearchParams({ q: query });
    if (opts?.trustStatus) qs.set("trust_status", opts.trustStatus);
    const page = await this._fetch<ToolsPage>(`/tools?${qs.toString()}`);
    return (page.items ?? []).map((p) => OpenTrust._validatePassport(p));
  }

  async list(opts?: ListOptions): Promise<ToolsPage> {
    const qs = new URLSearchParams();
    if (opts?.page !== undefined) qs.set("page", String(opts.page));
    if (opts?.limit !== undefined) qs.set("limit", String(opts.limit));
    if (opts?.trustStatus) qs.set("trust_status", opts.trustStatus);
    const page = await this._fetch<ToolsPage>(`/tools?${qs.toString()}`);
    page.items = (page.items ?? []).map((p) => OpenTrust._validatePassport(p));
    return page;
  }
}
