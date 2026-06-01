"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Briefcase,
  Plus,
  Loader2,
  Coins,
  ShieldCheck,
  Clock,
  AlertTriangle,
  CheckCircle2,
  X,
  ArrowRight,
} from "lucide-react";
import { useWallet, truncateAddress } from "@/lib/useWallet";

// ── Types ───────────────────────────────────────────────────────────────────

type ProviderKind = "mcp_server" | "skill" | "tool" | "agent_service" | "human_service";
type JobStatus = "open" | "engaged" | "completed" | "cancelled";

type Job = {
  job_id: string;
  title: string;
  description: string;
  budget_usdc: string;
  provider_kind: ProviderKind;
  status: JobStatus;
  min_provider_trust_score: number | null;
  client_wallet_id: string;
  escrow_id: string | null;
  delivery_proof: { type: string; timeout_seconds: number; result_hash_required: boolean };
};

const PROVIDER_KINDS: ProviderKind[] = ["mcp_server", "skill", "tool", "agent_service", "human_service"];

const STATUS_STYLES: Record<JobStatus, string> = {
  open: "bg-green-100 text-green-800",
  engaged: "bg-blue-100 text-blue-800",
  completed: "bg-stone-200 text-stone-700",
  cancelled: "bg-red-100 text-red-700",
};

// ── API ──────────────────────────────────────────────────────────────────────

async function fetchJobs(params: { provider_kind?: string; status?: string; max_budget?: string }): Promise<Job[]> {
  const qs = new URLSearchParams();
  if (params.provider_kind) qs.set("provider_kind", params.provider_kind);
  if (params.status) qs.set("status", params.status);
  if (params.max_budget) qs.set("max_budget", params.max_budget);
  const res = await fetch(`/api/v1/jobs${qs.toString() ? `?${qs}` : ""}`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

// ── Main ────────────────────────────────────────────────────────────────────

export default function JobsPage() {
  const { wallet } = useWallet();
  const [tab, setTab] = useState<"browse" | "post" | "mine">("browse");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ provider_kind: "", status: "open", max_budget: "" });
  const [engaging, setEngaging] = useState<Job | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setJobs(await fetchJobs(filters));
    setLoading(false);
  }, [filters]);

  useEffect(() => { void load(); }, [load]);

  const myJobs = wallet ? jobs.filter((j) => j.client_wallet_id === wallet.wallet_id) : [];

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold text-stone-900">
            <Briefcase className="h-7 w-7 text-moss" aria-hidden="true" /> Jobs
          </h1>
          <p className="mt-2 max-w-2xl text-stone-500">
            A venue where clients post work and providers take it. Engaging a job locks funds in escrow; settling builds two-way reputation.
          </p>
        </div>
      </header>

      {/* Tabs */}
      <div role="tablist" className="flex w-fit gap-1 rounded-lg border border-stone-200 bg-stone-100 p-1">
        {([["browse", "Browse"], ["post", "Post a job"], ["mine", `My jobs (${myJobs.length})`]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${tab === id ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Browse */}
      {tab === "browse" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 rounded-lg border border-stone-200 bg-white/60 p-3">
            <select value={filters.provider_kind} onChange={(e) => setFilters((f) => ({ ...f, provider_kind: e.target.value }))} className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm">
              <option value="">All kinds</option>
              {PROVIDER_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm">
              <option value="open">Open only</option>
              <option value="">All statuses</option>
            </select>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-stone-400">$</span>
              <input type="number" placeholder="Max budget" value={filters.max_budget} onChange={(e) => setFilters((f) => ({ ...f, max_budget: e.target.value }))} className="w-32 rounded-lg border border-stone-300 bg-white py-1.5 pl-6 pr-2 text-sm" />
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-stone-400" aria-hidden="true" /></div>
          ) : jobs.length === 0 ? (
            <div className="rounded-lg border border-stone-200 bg-stone-50 py-12 text-center text-sm text-stone-400">
              No jobs match. Be the first to <button onClick={() => setTab("post")} className="font-semibold text-moss underline">post one</button>.
            </div>
          ) : (
            <ul className="space-y-3" role="list">
              {jobs.map((job) => (
                <li key={job.job_id}>
                  <JobCard job={job} canEngage={!!wallet && job.status === "open"} onEngage={() => setEngaging(job)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Post */}
      {tab === "post" && <PostJobForm wallet={wallet} onPosted={() => { setTab("browse"); void load(); }} />}

      {/* Mine */}
      {tab === "mine" && (
        !wallet ? (
          <WalletPrompt />
        ) : myJobs.length === 0 ? (
          <div className="rounded-lg border border-stone-200 bg-stone-50 py-12 text-center text-sm text-stone-400">You haven't posted any jobs yet.</div>
        ) : (
          <ul className="space-y-3" role="list">
            {myJobs.map((job) => (
              <li key={job.job_id}><JobCard job={job} canEngage={false} onEngage={() => {}} showEscrow /></li>
            ))}
          </ul>
        )
      )}

      {engaging && <EngageDrawer job={engaging} wallet={wallet} onClose={() => setEngaging(null)} onEngaged={() => { setEngaging(null); void load(); }} />}
    </div>
  );
}

// ── Job card ──────────────────────────────────────────────────────────────────

function JobCard({ job, canEngage, onEngage, showEscrow }: { job: Job; canEngage: boolean; onEngage: () => void; showEscrow?: boolean }) {
  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-stone-900">{job.title}</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLES[job.status]}`}>{job.status}</span>
          </div>
          {job.description && <p className="mt-1 line-clamp-2 text-sm text-stone-500">{job.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
            <span className="inline-flex items-center gap-1"><Coins className="h-3.5 w-3.5" aria-hidden="true" /><span className="font-mono font-medium text-stone-800">{Number(job.budget_usdc).toFixed(2)} USDC</span></span>
            <span className="rounded bg-stone-100 px-2 py-0.5 font-medium text-stone-600">{job.provider_kind}</span>
            <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden="true" />{Math.round(job.delivery_proof.timeout_seconds / 3600)}h to deliver</span>
            {job.min_provider_trust_score != null && (
              <span className="inline-flex items-center gap-1 text-amber-700"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />min score {job.min_provider_trust_score}</span>
            )}
            {showEscrow && job.escrow_id && <span className="font-mono text-stone-400">escrow: {job.escrow_id.slice(0, 14)}…</span>}
          </div>
        </div>
        {canEngage && (
          <button onClick={onEngage} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-paper hover:bg-stone-700 transition">
            Engage <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Post job form ──────────────────────────────────────────────────────────────

function PostJobForm({ wallet, onPosted }: { wallet: ReturnType<typeof useWallet>["wallet"]; onPosted: () => void }) {
  const [form, setForm] = useState({ title: "", description: "", budget: "", provider_kind: "agent_service" as ProviderKind, timeoutHours: "24", resultHash: true, minScore: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!wallet) return <WalletPrompt />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const body = {
        client_wallet_id: wallet!.wallet_id,
        title: form.title,
        description: form.description,
        budget_usdc: form.budget,
        provider_kind: form.provider_kind,
        delivery_proof: {
          type: "http_endpoint",
          standard: "opentrust/delivery-proof@v1",
          timeout_seconds: Math.max(60, Number(form.timeoutHours) * 3600),
          result_hash_required: form.resultHash,
        },
        min_provider_trust_score: form.minScore ? Number(form.minScore) : null,
      };
      const res = await fetch("/api/v1/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.text()) || "Failed to post job");
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel max-w-xl space-y-4 p-6">
      <div>
        <label htmlFor="j-title" className="block text-sm font-medium text-stone-700">Title</label>
        <input id="j-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required placeholder="Summarize 100 PDFs" className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30" />
      </div>
      <div>
        <label htmlFor="j-desc" className="block text-sm font-medium text-stone-700">Description</label>
        <textarea id="j-desc" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} placeholder="Full brief for the provider…" className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="j-budget" className="block text-sm font-medium text-stone-700">Budget</label>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-400">$</span>
            <input id="j-budget" type="number" min="0.01" step="0.01" value={form.budget} onChange={(e) => setForm((f) => ({ ...f, budget: e.target.value }))} required placeholder="250.00" className="w-full rounded-lg border border-stone-300 bg-white py-2 pl-7 pr-14 font-mono text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400">USDC</span>
          </div>
        </div>
        <div>
          <label htmlFor="j-kind" className="block text-sm font-medium text-stone-700">Provider kind</label>
          <select id="j-kind" value={form.provider_kind} onChange={(e) => setForm((f) => ({ ...f, provider_kind: e.target.value as ProviderKind }))} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30">
            {PROVIDER_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="j-timeout" className="block text-sm font-medium text-stone-700">Delivery window (hours)</label>
          <input id="j-timeout" type="number" min="1" value={form.timeoutHours} onChange={(e) => setForm((f) => ({ ...f, timeoutHours: e.target.value }))} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30" />
        </div>
        <div>
          <label htmlFor="j-score" className="block text-sm font-medium text-stone-700">Min provider score <span className="text-stone-400">(optional)</span></label>
          <input id="j-score" type="number" min="0" max="100" value={form.minScore} onChange={(e) => setForm((f) => ({ ...f, minScore: e.target.value }))} placeholder="60" className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input type="checkbox" checked={form.resultHash} onChange={(e) => setForm((f) => ({ ...f, resultHash: e.target.checked }))} className="h-4 w-4 rounded border-stone-300 text-moss focus:ring-moss/30" />
        Require result hash on delivery
      </label>
      {error && <p className="text-sm text-signal" role="alert">{error}</p>}
      <button type="submit" disabled={submitting} aria-busy={submitting} className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-800 transition disabled:opacity-60">
        {submitting ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Posting…</> : <><Plus className="h-4 w-4" aria-hidden="true" /> Post job</>}
      </button>
    </form>
  );
}

// ── Engage drawer ──────────────────────────────────────────────────────────────

function EngageDrawer({ job, wallet, onClose, onEngaged }: { job: Job; wallet: ReturnType<typeof useWallet>["wallet"]; onClose: () => void; onEngaged: () => void }) {
  const [form, setForm] = useState({ trustLevel: "3", trustStatus: "seller_confirmed", agentPassport: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [escrow, setEscrow] = useState<{ escrow_id: string; deposit: { recipient_address: string; amount_usdc: string } } | null>(null);

  async function engage() {
    if (!wallet) return;
    setError("");
    setSubmitting(true);
    try {
      const body = {
        provider_wallet_id: wallet.wallet_id,
        provider_trust_level: Number(form.trustLevel),
        provider_trust_status: form.trustStatus,
        ...(form.agentPassport ? { agent_passport_id: form.agentPassport } : {}),
      };
      const res = await fetch(`/api/v1/jobs/${job.job_id}/engage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.text()) || "Engage failed");
      const data = await res.json();
      setEscrow(data.escrow);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Engage failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-paper p-6 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold text-stone-900">Engage: {job.title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-stone-400 hover:bg-stone-100"><X className="h-5 w-5" aria-hidden="true" /></button>
        </div>

        {escrow ? (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-900">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> Engaged. Escrow created.
            </div>
            <div className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
              <p className="text-xs text-stone-400">Client deposits to</p>
              <p className="font-mono text-xs break-all text-stone-800">{escrow.deposit.recipient_address}</p>
              <p className="mt-2 text-xs text-stone-400">Amount</p>
              <p className="font-mono font-semibold text-stone-900">{Number(escrow.deposit.amount_usdc).toFixed(2)} USDC</p>
              <p className="mt-2 text-xs text-stone-400">Escrow ID</p>
              <p className="font-mono text-xs break-all text-stone-800">{escrow.escrow_id}</p>
            </div>
            <button onClick={onEngaged} className="w-full rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper hover:bg-stone-700 transition">Done</button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-stone-500">Engaging mints an escrow for <span className="font-mono font-medium text-stone-800">{Number(job.budget_usdc).toFixed(2)} USDC</span>. You deliver, the client releases, both get rated.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="e-level" className="block text-xs font-medium text-stone-600">Your trust level</label>
                <select id="e-level" value={form.trustLevel} onChange={(e) => setForm((f) => ({ ...f, trustLevel: e.target.value }))} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm">
                  {[3, 4, 5, 6, 7].map((l) => <option key={l} value={l}>L{l}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="e-status" className="block text-xs font-medium text-stone-600">Trust status</label>
                <input id="e-status" value={form.trustStatus} onChange={(e) => setForm((f) => ({ ...f, trustStatus: e.target.value }))} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" />
              </div>
            </div>
            <div>
              <label htmlFor="e-agent" className="block text-xs font-medium text-stone-600">Agent passport ID <span className="text-stone-400">(optional)</span></label>
              <input id="e-agent" value={form.agentPassport} onChange={(e) => setForm((f) => ({ ...f, agentPassport: e.target.value }))} placeholder="my-agent" className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-sm" />
            </div>
            {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-signal" role="alert">{error}</p>}
            <button onClick={engage} disabled={submitting} aria-busy={submitting} className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-800 transition disabled:opacity-60">
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Engaging…</> : "Engage & create escrow"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function WalletPrompt() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      Connect a wallet first — <a href="/register" className="font-semibold underline">register or connect</a> to continue.
    </div>
  );
}
