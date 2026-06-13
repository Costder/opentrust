import { NextRequest, NextResponse } from "next/server";

const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// The browser calls this proxy same-origin, so we scope CORS to our own
// configured origin instead of "*" (which would let any site read responses to
// token-authenticated API calls, including the admin endpoints).
const allowedOrigin = process.env.CORS_ORIGINS?.split(",")[0]?.trim() || "http://localhost:3000";

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;
  const path = params.path.join("/");
  const upstreamPath = path.startsWith("v1/") ? `/api/${path}` : `/api/v1/${path}`;
  const url = new URL(request.url);

  // Build safe forward headers — strip hop-by-hop headers that break streaming
  const forwardHeaders: Record<string, string> = {
    "Content-Type": request.headers.get("Content-Type") ?? "application/json",
    "Accept": request.headers.get("Accept") ?? "application/json",
  };
  const authHeader = request.headers.get("Authorization");
  if (authHeader) forwardHeaders["Authorization"] = authHeader;

  const upstream = await fetch(`${apiUrl}${upstreamPath}${url.search}`, {
    method: request.method,
    headers: forwardHeaders,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.text(),
  });

  // Explicitly buffer the body to avoid stream forwarding issues on Vercel edge
  const body = await upstream.text();
  const contentType = upstream.headers.get("content-type") ?? "application/json";

  return new NextResponse(body, {
    status: upstream.status,
    headers: {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": allowedOrigin,
      "Vary": "Origin",
    },
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Vary": "Origin",
    },
  });
}
