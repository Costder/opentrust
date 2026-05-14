import type { Passport } from "@/types/passport";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function getTools(): Promise<Passport[]> {
  const response = await fetch(`${apiUrl}/api/v1/tools`, { cache: "no-store" });
  if (!response.ok) return [];
  return response.json();
}

export async function getTool(slug: string): Promise<Passport | null> {
  const response = await fetch(`${apiUrl}/api/v1/tools/${slug}`, { cache: "no-store" });
  if (!response.ok) return null;
  return response.json();
}
