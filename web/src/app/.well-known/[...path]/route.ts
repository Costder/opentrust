import { NextRequest } from "next/server";

const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;

  // Reject path-traversal segments (literal or percent-encoded) so the upstream
  // path can never escape /.well-known/ to reach other internal routes.
  const isTraversal = (seg: string) => {
    let decoded = seg;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      return true; // malformed encoding — refuse it
    }
    return seg === "." || seg === ".." || decoded === "." || decoded === ".." || decoded.includes("/");
  };
  if (params.path.some(isTraversal)) {
    return new Response("Not Found", { status: 404 });
  }

  const path = params.path.join("/");
  const url = new URL(request.url);

  // Only forward a minimal, safe request header set. The browser's Host,
  // X-Forwarded-*, Cookie, Authorization, etc. must not be relayed upstream.
  const forwardHeaders: Record<string, string> = {
    Accept: request.headers.get("Accept") ?? "application/json",
  };

  const response = await fetch(`${apiUrl}/.well-known/${path}${url.search}`, {
    method: request.method,
    headers: forwardHeaders,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.text(),
    cache: "no-store",
  });

  // Reflect only safe response headers; never relay upstream Set-Cookie,
  // Server, internal, or hop-by-hop headers to the public client.
  const responseHeaders = new Headers();
  const contentType = response.headers.get("Content-Type");
  if (contentType) responseHeaders.set("Content-Type", contentType);
  const cacheControl = response.headers.get("Cache-Control");
  if (cacheControl) responseHeaders.set("Cache-Control", cacheControl);

  return new Response(response.body, { status: response.status, headers: responseHeaders });
}

export const GET = proxy;
