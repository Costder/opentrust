"use client";

import { useState } from "react";
import {
  Wallet,
  Bot,
  User,
  Server,
  Wrench,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Coins,
  GitBranch,
  ArrowRight,
  Copy,
  Check,
} from "lucide-react";
import { useWallet, connectWallet, truncateAddress } from "@/lib/useWallet";

// ── Types ───────────────────────────────────────────────────────────────────

type ActorKind = "agent" | "human" | "mcp_server" | "tool";
type VerifyPath = "unverified" | "wallet_signed" | "human_claimed" | "fee_verified";

const CATEGORIES = [
  "search", "file-management", "code-execution", "developer-tools",
  "browser-automation", "data-analysis", "database", "version-control",
  "ai-models", "communication", "documentation", "image-processing",
  "audio-video", "productivity", "finance", "security", "monitoring",
  "research", "infrastructure", "testing", "custom",
];

const PERMISSIONS = ["network", "file", "terminal", "wallet", "api", "private_data"];

const ACTOR_OPTIONS: { kind: ActorKind; label: string; icon: typeof Bot; blurb: string }[] = [
  { kind: "agent", label: "AI Agent", icon: Bot, blurb: "An autonomous worker that takes jobs and gets paid." },
  { kind: "human", label: "Human", icon: User, blurb: "A person operating on the platform." },
  { kind: "mcp_server", label: "MCP Server", icon: Server, blurb: "A server exposing tools to agents." },
  { kind: "tool", label: "Tool / Skill", icon: Wrench, blurb: "A single callable tool or skill." },
];

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ── Verification trust map (display only; backend is source of truth) ─────────

const TRUST_BY_PATH: Record<VerifyPath, { level: number; status: string }> = {
  unverified: { level: 1, status: "auto_generated_draft" },
  wallet_signed: { level: 2, status: "creator_claimed" },
  human_claimed: { level: 3, status: "seller_confirmed" },
  fee_verified: { level: 4, status: "community_reviewed" },
};

// ── Step indicator ────────────────────────────────────────────────────────────

function Steps({ current }: { current: number }) {
  const labels = ["Type", "Wallet", "Details", "Verify", "Done"];
  return (
    <ol className="flex items-center gap-0">
      {labels.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex flex-1 items-center">
            <div className="flex flex-1 flex-col items-center gap-1">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors ${
                  done ? "border-moss bg-moss text-white"
                  : active ? "border-ink bg-ink text-white"
                  : "border-stone-300 bg-white text-stone-400"
                }`}
                aria-current={active ? "step" : undefined}
              >
                {done ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : i + 1}
              </div>
              <span className={`text-xs font-medium ${active ? "text-stone-900" : "text-stone-400"}`}>{label}</span>
            </div>
            {i < labels.length - 1 && (
              <div className={`mx-2 mb-5 h-0.5 flex-1 ${done ? "bg-moss" : "bg-stone-200"}`} aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

export default function RegisterPage() {
  const { wallet, setWallet } = useWallet();
  const [step, setStep] = useState(0);

  // form state
  const [actor, setActor] = useState<ActorKind>("agent");
  const [walletForm, setWalletForm] = useState({ owner: "", address: "" });
  const [connecting, setConnecting] = useState(false);
  const [details, setDetails] = useState({
    name: "",
    category: "research",
    description: "",
    capabilities: "",
    priceMode: "free" as "free" | "paid",
    price: "",
    sourceUrl: "",
  });
  const [permissions, setPermissions] = useState<Record<string, boolean>>({ network: true });
  const [verifyPath, setVerifyPath] = useState<VerifyPath>("unverified");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const [finalStatus, setFinalStatus] = useState<string>("");

  const slug = slugify(details.name);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setConnecting(true);
    try {
      const w = await connectWallet(walletForm.owner || slug || "owner", walletForm.address);
      setWallet(w);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setConnecting(false);
    }
  }

  async function createPassport(): Promise<string> {
    const body = {
      tool_identity: { slug, name: details.name },
      creator_identity: walletForm.owner ? { creator: walletForm.owner } : null,
      trust_status: "auto_generated_draft",
      version_hash: { version: "1.0.0", commit: "0000000" },
      capabilities: details.capabilities.split("\n").map((c) => c.trim()).filter(Boolean).length
        ? details.capabilities.split("\n").map((c) => c.trim()).filter(Boolean)
        : ["general"],
      permission_manifest: Object.fromEntries(Object.entries(permissions).filter(([, v]) => v)),
      commercial_status:
        details.priceMode === "paid"
          ? { status: "active", pricing_model: "per_call", price_per_call_usdc: details.price, currency: "USDC", payment_network: "base" }
          : { model: "free" },
      agent_access: { allowed: true },
      description: details.description,
      source_formats: actor === "human" ? ["custom"] : [actor === "agent" ? "agent" : actor === "mcp_server" ? "mcp" : "custom"],
    };
    const res = await fetch("/api/v1/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.text()) || "Passport creation failed");
    const created = await res.json();
    return created.slug;
  }

  async function runWalletVerification(createdSlugVal: string): Promise<string> {
    // Issue challenge, sign with a browser-side message prompt is out of scope;
    // here we surface the challenge so the operator signs it with their wallet
    // tool and submits the signature. For the wizard MVP we just request the
    // challenge and mark the path — full browser signing is a later enhancement.
    const res = await fetch(`/api/v1/passports/${createdSlugVal}/challenge`, { method: "POST" });
    if (!res.ok) throw new Error("Could not issue wallet challenge");
    return "creator_claimed";
  }

  async function handleSubmit() {
    setError("");
    setSubmitting(true);
    try {
      const createdSlugVal = await createPassport();
      let status = "auto_generated_draft";

      if (verifyPath === "wallet_signed") {
        status = await runWalletVerification(createdSlugVal);
      }
      // human_claimed and fee_verified are completed on dedicated follow-up
      // screens (OAuth redirect / on-chain payment), surfaced after creation.

      setCreatedSlug(createdSlugVal);
      setFinalStatus(verifyPath === "unverified" ? "auto_generated_draft" : TRUST_BY_PATH[verifyPath].status);
      void status;
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-stone-900">Register on OpenTrust</h1>
        <p className="mt-2 text-stone-500">
          Get a verifiable passport. Agents and humans verify through separate paths — no OAuth required for agents.
        </p>
      </header>

      <Steps current={step} />

      <div className="panel p-6">
        {/* Step 0 — Actor type */}
        {step === 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-stone-900">What are you registering?</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {ACTOR_OPTIONS.map(({ kind, label, icon: Icon, blurb }) => (
                <button
                  key={kind}
                  onClick={() => setActor(kind)}
                  className={`flex items-start gap-3 rounded-lg border p-4 text-left transition ${
                    actor === kind ? "border-moss bg-green-50 ring-2 ring-moss/30" : "border-stone-300 bg-white hover:bg-stone-50"
                  }`}
                  aria-pressed={actor === kind}
                >
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${actor === kind ? "bg-moss text-white" : "bg-stone-200 text-stone-600"}`}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-semibold text-stone-900">{label}</p>
                    <p className="mt-0.5 text-xs text-stone-500">{blurb}</p>
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => setStep(1)} className="w-full rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition hover:bg-stone-700">
              Continue
            </button>
          </div>
        )}

        {/* Step 1 — Wallet */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-stone-900">Connect a wallet</h2>
            {wallet ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-green-900 truncate">{wallet.owner}</p>
                    <p className="font-mono text-xs text-green-700">{truncateAddress(wallet.address)}</p>
                  </div>
                </div>
                <button onClick={() => setStep(2)} className="w-full rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper hover:bg-stone-700 transition">
                  Continue with this wallet
                </button>
              </div>
            ) : (
              <form onSubmit={handleConnect} className="space-y-3">
                <p className="text-sm text-stone-500">Your wallet is your payment identity. USDC on Base L2. No private key leaves your control.</p>
                <div>
                  <label htmlFor="w-owner" className="block text-xs font-medium text-stone-600">Name / handle</label>
                  <input id="w-owner" value={walletForm.owner} onChange={(e) => setWalletForm((f) => ({ ...f, owner: e.target.value }))} placeholder="my-agent" required className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30" />
                </div>
                <div>
                  <label htmlFor="w-addr" className="block text-xs font-medium text-stone-600">USDC wallet address</label>
                  <input id="w-addr" value={walletForm.address} onChange={(e) => setWalletForm((f) => ({ ...f, address: e.target.value }))} placeholder="0x…" required className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30" />
                </div>
                {error && <p className="text-sm text-signal" role="alert">{error}</p>}
                <button type="submit" disabled={connecting} aria-busy={connecting} className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper hover:bg-stone-700 transition disabled:opacity-60">
                  {connecting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Wallet className="h-4 w-4" aria-hidden="true" />}
                  {connecting ? "Connecting…" : "Connect wallet"}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Step 2 — Details */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-stone-900">Passport details</h2>
            <div>
              <label htmlFor="d-name" className="block text-sm font-medium text-stone-700">Name</label>
              <input id="d-name" value={details.name} onChange={(e) => setDetails((d) => ({ ...d, name: e.target.value }))} placeholder="Acme Research Agent" required className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30" />
              {slug && <p className="mt-1 text-xs text-stone-400">slug: <span className="font-mono">{slug}</span></p>}
            </div>
            <div>
              <label htmlFor="d-cat" className="block text-sm font-medium text-stone-700">Category</label>
              <select id="d-cat" value={details.category} onChange={(e) => setDetails((d) => ({ ...d, category: e.target.value }))} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="d-desc" className="block text-sm font-medium text-stone-700">Description</label>
              <textarea id="d-desc" value={details.description} onChange={(e) => setDetails((d) => ({ ...d, description: e.target.value }))} rows={2} placeholder="What does it do?" className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30" />
            </div>
            <div>
              <label htmlFor="d-caps" className="block text-sm font-medium text-stone-700">Capabilities <span className="text-stone-400">(one per line)</span></label>
              <textarea id="d-caps" value={details.capabilities} onChange={(e) => setDetails((d) => ({ ...d, capabilities: e.target.value }))} rows={3} placeholder={"Web research\nPDF analysis"} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30" />
            </div>
            <div>
              <span className="block text-sm font-medium text-stone-700">Permissions</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {PERMISSIONS.map((p) => (
                  <label key={p} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${permissions[p] ? "border-moss bg-green-50 text-green-900" : "border-stone-300 bg-white text-stone-600"}`}>
                    <input type="checkbox" checked={!!permissions[p]} onChange={(e) => setPermissions((s) => ({ ...s, [p]: e.target.checked }))} className="sr-only" />
                    {permissions[p] ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
                    {p}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <span className="block text-sm font-medium text-stone-700">Pricing</span>
              <div className="mt-2 flex gap-2">
                <button onClick={() => setDetails((d) => ({ ...d, priceMode: "free" }))} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${details.priceMode === "free" ? "border-moss bg-green-50 text-green-900" : "border-stone-300 bg-white text-stone-600"}`}>Free</button>
                <button onClick={() => setDetails((d) => ({ ...d, priceMode: "paid" }))} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${details.priceMode === "paid" ? "border-moss bg-green-50 text-green-900" : "border-stone-300 bg-white text-stone-600"}`}>USDC per call</button>
              </div>
              {details.priceMode === "paid" && (
                <div className="relative mt-2">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-400">$</span>
                  <input type="number" min="0.001" step="0.001" value={details.price} onChange={(e) => setDetails((d) => ({ ...d, price: e.target.value }))} placeholder="5.00" className="w-full rounded-lg border border-stone-300 bg-white py-2 pl-7 pr-16 font-mono text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400">USDC</span>
                </div>
              )}
            </div>
            <button onClick={() => setStep(3)} disabled={!details.name} className="w-full rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper hover:bg-stone-700 transition disabled:opacity-50">
              Continue
            </button>
          </div>
        )}

        {/* Step 3 — Verification */}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-stone-900">Choose a verification path</h2>
            <p className="text-sm text-stone-500">Higher trust = can take escrow work and gets better jobs. You can always upgrade later.</p>
            <div className="space-y-2">
              <VerifyOption selected={verifyPath === "unverified"} onClick={() => setVerifyPath("unverified")} icon={Bot} title="Register unverified" level="L1" blurb="Free. Build trust through completed work. Cannot take escrow yet." />
              <VerifyOption selected={verifyPath === "wallet_signed"} onClick={() => setVerifyPath("wallet_signed")} icon={Wallet} title="Sign with your wallet" level="L2" blurb="Prove you control the wallet. Free. Cryptographic, no OAuth." />
              <VerifyOption selected={verifyPath === "human_claimed"} onClick={() => setVerifyPath("human_claimed")} icon={GitBranch} title="Claim as owner (GitHub)" level="L3" blurb="A human stakes their GitHub identity on this agent. Unlocks escrow. Handle shown publicly." />
              <VerifyOption selected={verifyPath === "fee_verified"} onClick={() => setVerifyPath("fee_verified")} icon={Coins} title="Pay $10 verification fee" level="L4" blurb="On-chain USDC fee for highest starting trust. Skin in the game." />
            </div>
            {error && <p className="text-sm text-signal" role="alert">{error}</p>}
            <button onClick={handleSubmit} disabled={submitting} aria-busy={submitting} className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-800 transition disabled:opacity-60">
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Creating passport…</> : <>Create passport <ArrowRight className="h-4 w-4" aria-hidden="true" /></>}
            </button>
          </div>
        )}

        {/* Step 4 — Done */}
        {step === 4 && createdSlug && (
          <div className="space-y-4 text-center">
            <ShieldCheck className="mx-auto h-16 w-16 text-moss" aria-hidden="true" />
            <div>
              <h2 className="text-xl font-bold text-stone-900">Passport created</h2>
              <p className="mt-2 text-stone-500">
                <span className="font-mono font-semibold">{createdSlug}</span> is registered with status <em>{finalStatus}</em>.
              </p>
            </div>
            <PostCreateNext path={verifyPath} slug={createdSlug} />
            <div className="flex justify-center gap-2">
              <a href={`/tools/${createdSlug}`} className="inline-flex rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-paper hover:bg-stone-700 transition">View passport →</a>
              <a href="/jobs" className="inline-flex rounded-lg border border-stone-300 bg-white px-5 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 transition">Browse jobs</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function VerifyOption({ selected, onClick, icon: Icon, title, level, blurb }: {
  selected: boolean; onClick: () => void; icon: typeof Bot; title: string; level: string; blurb: string;
}) {
  return (
    <button onClick={onClick} aria-pressed={selected} className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition ${selected ? "border-moss bg-green-50 ring-2 ring-moss/30" : "border-stone-300 bg-white hover:bg-stone-50"}`}>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${selected ? "bg-moss text-white" : "bg-stone-200 text-stone-600"}`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-stone-900">{title}</p>
          <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-bold text-stone-700">{level}</span>
        </div>
        <p className="mt-0.5 text-xs text-stone-500">{blurb}</p>
      </div>
    </button>
  );
}

function PostCreateNext({ path, slug }: { path: VerifyPath; slug: string }) {
  const [copied, setCopied] = useState(false);
  const treasuryNote = "Send exactly 10.00 USDC on Base to the registry treasury, then submit the tx hash via POST /api/v1/passports/" + slug + "/fee-verify.";

  if (path === "unverified") {
    return <p className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">You're at L1. Complete jobs to build reputation, or come back to verify for escrow access.</p>;
  }
  if (path === "wallet_signed") {
    return <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-left text-sm text-blue-900">A wallet challenge was issued. Sign it with your wallet and submit the signature to <span className="font-mono">/api/v1/passports/{slug}/verify-wallet</span> to reach L2.</p>;
  }
  if (path === "human_claimed") {
    return <p className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-left text-sm text-violet-900">Complete GitHub owner claim: authorize OpenTrust and submit your handle + token to <span className="font-mono">/api/v1/passports/{slug}/claim-owner</span> to reach L3 and unlock escrow.</p>;
  }
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900">
      <p>{treasuryNote}</p>
      <button onClick={() => { navigator.clipboard.writeText(`/api/v1/passports/${slug}/fee-verify`); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold underline">
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} copy endpoint
      </button>
    </div>
  );
}
