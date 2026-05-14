"use client";

import { useState } from "react";

type Result = {
  trust_status: string;
  tool_identity?: { name?: string };
  permission_manifest?: Record<string, unknown>;
  commercial_status?: { status?: string };
};

const TRUST_COLOR: Record<string, string> = {
  continuously_monitored: "text-green-700",
  security_checked: "text-green-600",
  reviewer_signed: "text-blue-600",
  community_reviewed: "text-blue-500",
  owner_confirmed: "text-yellow-600",
  creator_claimed: "text-yellow-500",
  auto_generated_draft: "text-stone-500",
  disputed: "text-red-600",
};

export function DemoCheck() {
  const [slug, setSlug] = useState("github-file-search");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function check() {
    if (!slug.trim()) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch(`/api/tools/${encodeURIComponent(slug.trim())}`);
      if (!res.ok) {
        setError(res.status === 404 ? "Tool not found in registry." : `Error ${res.status}`);
      } else {
        setResult(await res.json());
      }
    } catch {
      setError("Could not reach the registry API. Is it running?");
    } finally {
      setLoading(false);
    }
  }

  const permissions = result?.permission_manifest
    ? Object.entries(result.permission_manifest)
        .filter(([k, v]) => k !== "notes" && v === true)
        .map(([k]) => k)
    : [];

  return (
    <div className="panel p-5 space-y-4">
      <p className="text-sm font-semibold uppercase text-signal">Try it — check any tool</p>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          value={slug}
          onChange={e => setSlug(e.target.value)}
          onKeyDown={e => e.key === "Enter" && check()}
          placeholder="tool-slug"
          aria-label="Tool slug"
        />
        <button
          onClick={check}
          disabled={loading}
          className="rounded bg-ink px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {loading ? "Checking…" : "Check trust"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{result.tool_identity?.name ?? slug}</span>
            <span className={`font-mono font-semibold ${TRUST_COLOR[result.trust_status] ?? ""}`}>
              {result.trust_status}
            </span>
          </div>
          {permissions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {permissions.map(p => (
                <span key={p} className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                  {p}
                </span>
              ))}
            </div>
          )}
          <p className="text-stone-500">
            Cost:{" "}
            <span className="font-medium text-stone-700">
              {result.commercial_status?.status ?? "unknown"}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
