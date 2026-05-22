import { NextRequest } from "next/server";

const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;
  const path = params.path.join("/");
  const url = new URL(request.url);
  const response = await fetch(`${apiUrl}/.well-known/${path}${url.search}`, {
    method: request.method,
    headers: request.headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.text(),
    cache: "no-store",
  });
  return new Response(response.body, { status: response.status, headers: response.headers });
}

export const GET = proxy;
