import type { Passport } from "@/types/passport";

const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type ToolsPage = {
  items: Passport[];
  total: number;
  page: number;
  limit: number;
};

export type ToolsParams = {
  q?: string;
  trust_status?: string;
  page?: number;
  limit?: number;
};

export async function getTools(params: ToolsParams = {}): Promise<ToolsPage> {
  try {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.trust_status) qs.set("trust_status", params.trust_status);
    if (params.page) qs.set("page", String(params.page));
    if (params.limit) qs.set("limit", String(params.limit));
    const url = `${apiUrl}/api/v1/tools${qs.toString() ? `?${qs}` : ""}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return { items: [], total: 0, page: 1, limit: 20 };
    return response.json();
  } catch {
    return { items: [], total: 0, page: 1, limit: 20 };
  }
}

export async function getTool(slug: string): Promise<Passport | null> {
  try {
    const response = await fetch(`${apiUrl}/api/v1/tools/${slug}`, { cache: "no-store" });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}
