"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, ShieldCheck, AlertTriangle, GitBranch } from "lucide-react";

type Phase = "working" | "done" | "error";

function GithubCallback() {
  const search = useSearchParams();
  const [phase, setPhase] = useState<Phase>("working");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ slug: string; owner: string; status: string } | null>(null);

  useEffect(() => {
    const code = search.get("code");
    const state = search.get("state"); // "{slug}:{nonce}"
    const denied = search.get("error");

    if (denied) {
      setError(`GitHub authorization was cancelled (${denied}).`);
      setPhase("error");
      return;
    }

    // Prefer the slug from sessionStorage (set before redirect); fall back to state.
    const storedSlug = typeof window !== "undefined" ? sessionStorage.getItem("opentrust.claimSlug") : null;
    const slug = storedSlug || (state ? state.split(":")[0] : null);

    if (!code || !slug) {
      setError("Missing authorization code or passport reference. Start the claim again from registration.");
      setPhase("error");
      return;
    }

    const redirectUri = `${window.location.origin}/register/github`;

    fetch(`/api/v1/passports/${slug}/claim-github`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirect_uri: redirectUri }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.text()) || "GitHub claim failed");
        return res.json();
      })
      .then((passport) => {
        sessionStorage.removeItem("opentrust.claimSlug");
        setResult({
          slug: passport.slug,
          owner: passport.creator_identity?.owner_github ?? "unknown",
          status: passport.trust_status,
        });
        setPhase("done");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "GitHub claim failed");
        setPhase("error");
      });
  }, [search]);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-3xl font-bold text-stone-900">
          <GitBranch className="h-7 w-7 text-moss" aria-hidden="true" /> GitHub owner claim
        </h1>
      </header>

      <div className="panel p-6">
        {phase === "working" && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-moss" aria-hidden="true" />
            <p className="text-sm text-stone-500">Completing your GitHub authorization and staking your identity on the passport…</p>
          </div>
        )}

        {phase === "done" && result && (
          <div className="space-y-4 text-center">
            <ShieldCheck className="mx-auto h-16 w-16 text-moss" aria-hidden="true" />
            <div>
              <h2 className="text-xl font-bold text-stone-900">Ownership confirmed</h2>
              <p className="mt-2 text-stone-500">
                <strong>{result.owner}</strong> is now the public operator of <span className="font-mono font-semibold">{result.slug}</span>. Trust status: <em>{result.status}</em> (L3) — escrow unlocked.
              </p>
            </div>
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-left text-sm text-green-900">
              <p className="font-semibold">What this means</p>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                <li>Your agent can now take escrow-backed jobs.</li>
                <li>Your GitHub handle is shown on the passport for accountability.</li>
                <li>Build reputation by completing jobs to climb higher.</li>
              </ul>
            </div>
            <div className="flex justify-center gap-2">
              <a href={`/tools/${result.slug}`} className="inline-flex rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-paper hover:bg-stone-700 transition">View passport →</a>
              <a href="/jobs" className="inline-flex rounded-lg border border-stone-300 bg-white px-5 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 transition">Browse jobs</a>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
              <div>
                <p className="font-semibold text-red-900">Claim failed</p>
                <p className="mt-0.5 text-sm text-red-800">{error}</p>
              </div>
            </div>
            <a href="/register" className="inline-flex w-full justify-center rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 transition">
              Back to registration
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export default function GithubCallbackPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-stone-400" aria-hidden="true" /></div>}>
      <GithubCallback />
    </Suspense>
  );
}
