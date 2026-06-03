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

const GITHUB_RE = /github\.com\/[^/\s]+\/[^/\s]+|^[^/\s]+\/[^/\s]+$/;

export function DemoCheck() {
  const [slug, setSlug] = useState("github-mcp-server");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [canSubmit, setCanSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

  async function check() {
    const q = slug.trim();
    if (!q) return;
    setLoading(true);
    setResult(null);
    setError(null);
    setCanSubmit(false);
    setAdded(null);
    try {
      // A GitHub URL / ow+repo is a submission, not a slug lookup.
      const looksLikeGithub = GITHUB_RE.test(q) && !/^[a-z0-9-]+$/.test(q);
      if (looksLikeGithub) {
        await submitRepo(q);
        return;
      }
      const res = await fetch(`/api/tools/${encodeURIComponent(q)}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError("Not in the registry yet.");
          setCanSubmit(true); // offer to add it
        } else {
          setError(`Error ${res.status}`);
        }
      } else {
        setResult(await res.json());
      }
    } catch {
      setError("Could not reach the registry API. Is it running?");
    } finally {
      setLoading(false);
    }
  }

  async function submitRepo(input: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/tools/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ github_url: input }),
      });
      if (res.status === 422) {
        setError("That doesn't look like a GitHub repo. Try a slug or github.com/owner/repo.");
        return;
      }
      if (res.status === 404) {
        setError("That GitHub repo wasn't found.");
        return;
      }
      if (!res.ok) {
        setError(`Couldn't add it (error ${res.status}).`);
        return;
      }
      const created = await res.json();
      setResult(created);
      setAdded(created.slug);
      setCanSubmit(false);
    } catch {
      setError("Could not reach the registry API.");
    } finally {
      setSubmitting(false);
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
      <p className="text-sm font-semibold uppercase text-signal">Check a tool — or add one</p>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          value={slug}
          onChange={e => setSlug(e.target.value)}
          onKeyDown={e => e.key === "Enter" && check()}
          placeholder="tool-slug or github.com/owner/repo"
          aria-label="Tool slug or GitHub repo"
        />
        <button
          onClick={check}
          disabled={loading || submitting}
          className="rounded bg-ink px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {loading || submitting ? "…" : "Check"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {canSubmit && (
        <button
          onClick={() => submitRepo(slug.trim())}
          disabled={submitting}
          className="w-full rounded bg-moss px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 transition disabled:opacity-50"
        >
          {submitting ? "Adding…" : "Add it to the registry →"}
        </button>
      )}

      {added && (
        <p className="text-sm text-moss">
          Added <span className="font-mono font-semibold">{added}</span> as a draft (L1). Claim it to advance its trust.
        </p>
      )}

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
