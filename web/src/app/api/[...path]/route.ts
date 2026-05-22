import { NextRequest } from "next/server";

const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;
  const path = params.path.join("/");
  const upstreamPath = path.startsWith("v1/") ? `/api/${path}` : `/api/v1/${path}`;
  const url = new URL(request.url);
  const response = await fetch(`${apiUrl}${upstreamPath}${url.search}`, {
    method: request.method,
    headers: request.headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.text()
  });
  return new Response(response.body, { status: response.status, headers: response.headers });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
