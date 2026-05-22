"use client";

import { useState } from "react";
import { CheckCircle2, GitBranch, Loader2, Copy, Check, ShieldCheck, AlertTriangle } from "lucide-react";

type Step = "enter" | "verify" | "confirming" | "done" | "error";

export default function ClaimPage({ params }: { params: { slug: string } }) {
  const { slug } = params;

  const [step, setStep] = useState<Step>("enter");
  const [username, setUsername] = useState("");
  const [token] = useState(() => `opentrust-claim-${Math.random().toString(36).slice(2, 10)}`);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmitUsername(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    setStep("verify");
  }

  async function handleConfirmToken() {
    setStep("confirming");
    // Simulate a 2-second check (real flow would POST to /api/v1/claim/verify)
    await new Promise((r) => setTimeout(r, 2000));
    try {
      // In the real flow this would be a GitHub OAuth check.
      // For demo purposes we always succeed after the delay.
      setStep("done");
    } catch {
      setError("Verification failed. In production, this checks your GitHub profile for the token.");
      setStep("error");
    }
  }

  function copyToken() {
    navigator.clipboard.writeText(token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">

      {/* Header */}
      <header>
        <h1 className="text-3xl font-bold text-stone-900">Claim <span className="text-moss">{slug}</span></h1>
        <p className="mt-2 text-stone-500">
          Claiming links your GitHub identity to this passport. Once claimed, you can update the tool's description, permissions, and trust metadata.
        </p>
      </header>

      {/* Progress steps */}
      <nav aria-label="Claim progress">
        <ol className="flex items-center gap-0">
          {[
            { id: "enter", label: "Enter username" },
            { id: "verify", label: "Place token" },
            { id: "done", label: "Confirmed" },
          ].map((s, i) => {
            const stepOrder = { enter: 0, verify: 1, confirming: 1, done: 2, error: 2 };
            const currentOrder = stepOrder[step] ?? 0;
            const thisOrder = i;
            const isDone = thisOrder < currentOrder || step === "done";
            const isActive = thisOrder === currentOrder && step !== "done";

            return (
              <li key={s.id} className="flex flex-1 items-center">
                <div className="flex flex-col items-center gap-1 flex-1">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors ${
                    isDone
                      ? "border-moss bg-moss text-white"
                      : isActive
                      ? "border-ink bg-ink text-white"
                      : "border-stone-300 bg-white text-stone-400"
                  }`} aria-current={isActive ? "step" : undefined}>
                    {isDone ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : i + 1}
                  </div>
                  <span className={`text-xs font-medium ${isActive ? "text-stone-900" : "text-stone-400"}`}>
                    {s.label}
                  </span>
                </div>
                {i < 2 && <div className={`h-0.5 flex-1 mx-2 mb-5 ${isDone ? "bg-moss" : "bg-stone-200"}`} aria-hidden="true" />}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Step panels */}
      <div className="panel p-6">

        {/* Step 1: Enter username */}
        {step === "enter" && (
          <form onSubmit={handleSubmitUsername} className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-stone-900">Step 1 — GitHub username</h2>
              <p className="mt-1 text-sm text-stone-500">
                Enter the GitHub username of the account that owns <strong>{slug}</strong>. We'll give you a token to place in your profile bio.
              </p>
            </div>
            <div>
              <label htmlFor="github-username" className="block text-sm font-medium text-stone-700">
                GitHub username
              </label>
              <div className="relative mt-1">
                <GitBranch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
                <input
                  id="github-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="your-github-username"
                  required
                  className="w-full rounded-lg border border-stone-300 bg-white py-2.5 pl-10 pr-4 text-sm text-stone-900 placeholder:text-stone-400 focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30"
                />
              </div>
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition hover:bg-stone-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              Continue
            </button>
          </form>
        )}

        {/* Step 2: Verify token */}
        {(step === "verify" || step === "confirming") && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-stone-900">Step 2 — Place your verification token</h2>
              <p className="mt-1 text-sm text-stone-500">
                Add this token to the bio of your GitHub profile (<strong>github.com/{username}</strong>). It only needs to be there during verification — you can remove it after.
              </p>
            </div>

            {/* Token display */}
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg border border-stone-300 bg-stone-50 px-4 py-3 font-mono text-sm text-stone-900 break-all">
                {token}
              </code>
              <button
                onClick={copyToken}
                aria-label={copied ? "Token copied" : "Copy token to clipboard"}
                className="shrink-0 rounded-lg border border-stone-300 bg-white p-2.5 transition hover:bg-stone-50"
              >
                {copied
                  ? <Check className="h-4 w-4 text-moss" aria-hidden="true" />
                  : <Copy className="h-4 w-4 text-stone-500" aria-hidden="true" />
                }
              </button>
            </div>

            <ol className="space-y-2 text-sm text-stone-600 list-none">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-200 text-xs font-bold text-stone-700">1</span>
                Go to <a href={`https://github.com/${username}`} target="_blank" rel="noopener noreferrer" className="text-moss underline underline-offset-2">github.com/{username}</a> → Edit profile
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-200 text-xs font-bold text-stone-700">2</span>
                Paste the token above into your <strong>Bio</strong> field and save.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-200 text-xs font-bold text-stone-700">3</span>
                Come back here and click <strong>I've added it — verify now</strong>.
              </li>
            </ol>

            <button
              onClick={handleConfirmToken}
              disabled={step === "confirming"}
              aria-busy={step === "confirming"}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-green-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss disabled:cursor-not-allowed disabled:opacity-60"
            >
              {step === "confirming" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Checking your profile…
                </>
              ) : (
                "I've added it — verify now"
              )}
            </button>
          </div>
        )}

        {/* Step 3: Done */}
        {step === "done" && (
          <div className="space-y-4 text-center">
            <ShieldCheck className="mx-auto h-16 w-16 text-moss" aria-hidden="true" />
            <div>
              <h2 className="text-xl font-bold text-stone-900">Claim confirmed!</h2>
              <p className="mt-2 text-stone-500">
                <strong>github.com/{username}</strong> is now recorded as the creator of <strong>{slug}</strong>. The trust status has been updated to <em>creator_claimed</em>.
              </p>
            </div>
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-left text-sm text-green-900">
              <p className="font-semibold">What happens next?</p>
              <ul className="mt-2 space-y-1 list-disc pl-4">
                <li>You can now edit the passport's metadata from the tool page.</li>
                <li>Remove the verification token from your GitHub bio — it's no longer needed.</li>
                <li>To reach higher trust levels, submit your tool for community or security review.</li>
              </ul>
            </div>
            <a
              href={`/tools/${slug}`}
              className="inline-flex rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-paper hover:bg-stone-700 transition"
            >
              View passport →
            </a>
          </div>
        )}

        {/* Error state */}
        {step === "error" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
              <div>
                <p className="font-semibold text-red-900">Verification failed</p>
                <p className="mt-0.5 text-sm text-red-800">{error}</p>
              </div>
            </div>
            <button
              onClick={() => setStep("verify")}
              className="w-full rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 transition"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      {/* Note about demo */}
      <p className="text-center text-xs text-stone-400">
        This is a demo claim flow. Production verifies ownership via GitHub OAuth and updates the registry database.
      </p>
    </div>
  );
}
