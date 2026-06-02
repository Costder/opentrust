import type {
  Passport,
  VerifyResult,
  ToolsPage,
  ListOptions,
  SearchOptions,
} from "./types.js";
import { buildVerifyResult } from "./recommend.js";

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
    return res.json() as Promise<T>;
  }

  async get(slug: string): Promise<Passport> {
    return this._fetch<Passport>(`/tools/${encodeURIComponent(slug)}`);
  }

  async verify(slug: string): Promise<VerifyResult> {
    const passport = await this.get(slug);
    return buildVerifyResult(passport);
  }

  async search(query: string, opts?: SearchOptions): Promise<Passport[]> {
    const qs = new URLSearchParams({ q: query });
    if (opts?.trustStatus) qs.set("trust_status", opts.trustStatus);
    const page = await this._fetch<ToolsPage>(`/tools?${qs.toString()}`);
    return page.items;
  }

  async list(opts?: ListOptions): Promise<ToolsPage> {
    const qs = new URLSearchParams();
    if (opts?.page !== undefined) qs.set("page", String(opts.page));
    if (opts?.limit !== undefined) qs.set("limit", String(opts.limit));
    if (opts?.trustStatus) qs.set("trust_status", opts.trustStatus);
    return this._fetch<ToolsPage>(`/tools?${qs.toString()}`);
  }
}
