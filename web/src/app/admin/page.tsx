"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Lock,
  Loader2,
  Plus,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  LogOut,
  FlaskConical,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tool = {
  slug: string;
  name: string;
  trust_status: string;
  is_demo: boolean;
};

const TRUST_LEVELS = [
  "auto_generated_draft",
  "creator_claimed",
  "seller_confirmed",
  "community_reviewed",
  "reviewer_signed",
  "security_checked",
  "continuously_monitored",
];

const CATEGORIES = [
  "search", "developer-tools", "code-execution", "database", "ai-models",
  "communication", "productivity", "infrastructure", "security", "custom",
];

const TOKEN_KEY = "opentrust.adminToken";

// ── Main ────────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDemo, setShowDemo] = useState(false);

  useEffect(() => {
    setToken(sessionStorage.getItem(TOKEN_KEY));
  }, []);

  const auth = useCallback(() => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }), [token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // include both demo and real so the admin sees everything; send the admin
      // token so this privileged listing is authenticated, not anonymous.
      const res = await fetch("/api/v1/tools?include_demo=true&limit=100", {
        cache: "no-store",
        headers: auth(),
      });
      const data = await res.json();
      setTools((data.items ?? []).map((t: { slug: string; name: string; trust_status: string; is_demo?: boolean }) => ({
        slug: t.slug, name: t.name, trust_status: t.trust_status, is_demo: !!t.is_demo,
      })));
    } catch {
      setError("Could not load tools");
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => { if (token) void load(); }, [token, load]);

  function saveToken() {
    sessionStorage.setItem(TOKEN_KEY, tokenInput.trim());
    setToken(tokenInput.trim());
  }
  function logout() {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setTools([]);
  }

  async function deleteTool(slug: string) {
    if (!confirm(`Hide "${slug}" from all listings? (soft delete — recoverable)`)) return;
    const res = await fetch(`/api/v1/admin/tools/${slug}`, { method: "DELETE", headers: auth() });
    if (res.status === 401 || res.status === 403) { setError("Admin token rejected."); return; }
    await load();
  }

  async function toggleDemo(tool: Tool) {
    await fetch(`/api/v1/admin/tools/${tool.slug}`, {
      method: "PATCH", headers: auth(), body: JSON.stringify({ is_demo: !tool.is_demo }),
    });
    await load();
  }

  // ── Login gate ──
  if (!token) {
    return (
      <div className="mx-auto max-w-md space-y-6">
        <header>
          <h1 className="flex items-center gap-2 text-3xl font-bold text-stone-900">
            <Lock className="h-7 w-7 text-moss" aria-hidden="true" /> Admin
          </h1>
          <p className="mt-2 text-stone-500">Elevated registry management. Paste your admin token to continue.</p>
        </header>
        <div className="panel space-y-3 p-6">
          <label htmlFor="tok" className="block text-sm font-medium text-stone-700">Admin token</label>
          <input
            id="tok" type="password" value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveToken(); }}
            placeholder="REGISTRY_ADMIN_TOKEN"
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30"
          />
          <button onClick={saveToken} disabled={!tokenInput.trim()} className="w-full rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper hover:bg-stone-700 transition disabled:opacity-50">
            Sign in
          </button>
          <p className="text-xs text-stone-400">Stored only in this browser tab (sessionStorage). The token is checked by the API on every action.</p>
        </div>
      </div>
    );
  }

  // ── Authenticated panel ──
  const visible = showDemo ? tools : tools.filter((t) => !t.is_demo);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold text-stone-900">
            <ShieldCheck className="h-7 w-7 text-moss" aria-hidden="true" /> Admin
          </h1>
          <p className="mt-2 text-stone-500">Add, hide, or flag tools in the registry.</p>
        </div>
        <button onClick={logout} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-50">
          <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
        </button>
      </header>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-signal" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> {error}
        </div>
      )}

      <AddToolForm auth={auth} onAdded={load} />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-stone-900">Registry ({visible.length})</h2>
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input type="checkbox" checked={showDemo} onChange={(e) => setShowDemo(e.target.checked)} className="h-4 w-4 rounded border-stone-300 text-moss focus:ring-moss/30" />
            show demo
          </label>
        </div>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-stone-400" aria-hidden="true" /></div>
        ) : (
          <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white/60" role="list">
            {visible.map((tool) => (
              <li key={tool.slug} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium text-stone-900">
                    {tool.name}
                    {tool.is_demo && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800"><FlaskConical className="h-3 w-3" />demo</span>}
                  </p>
                  <p className="font-mono text-xs text-stone-400">{tool.slug} · {tool.trust_status}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => toggleDemo(tool)} className="rounded-md border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50">
                    {tool.is_demo ? "mark real" : "mark demo"}
                  </button>
                  <button onClick={() => deleteTool(tool.slug)} className="inline-flex items-center gap-1 rounded-md border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-500 hover:border-red-300 hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> hide
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Add tool form ────────────────────────────────────────────────────────────────

function AddToolForm({ auth, onAdded }: { auth: () => Record<string, string>; onAdded: () => void }) {
  const [form, setForm] = useState({
    name: "", slug: "", category: "developer-tools",
    trust_status: "community_reviewed", description: "",
    mcp_command: "", source_url: "", is_demo: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  function slugify(s: string) { return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setOk(""); setSubmitting(true);
    const slug = form.slug || slugify(form.name);
    try {
      const body = {
        tool_identity: { slug, name: form.name, ...(form.source_url ? { source_url: form.source_url } : {}) },
        description: form.description,
        trust_status: form.trust_status,
        version_hash: { version: "1.0.0", commit: "0000000" },
        capabilities: ["general"],
        permission_manifest: { network: true },
        commercial_status: { model: "free" },
        agent_access: { allowed: true, ...(form.mcp_command ? { mcp_command: form.mcp_command } : {}) },
        source_formats: ["mcp"],
        is_demo: form.is_demo,
      };
      const res = await fetch("/api/v1/admin/tools", { method: "POST", headers: auth(), body: JSON.stringify(body) });
      if (res.status === 401 || res.status === 403) throw new Error("Admin token rejected.");
      if (res.status === 409) throw new Error(`Slug "${slug}" already exists.`);
      if (!res.ok) throw new Error((await res.text()) || "Failed to add");
      setOk(`Added ${slug}`);
      setForm((f) => ({ ...f, name: "", slug: "", description: "", mcp_command: "", source_url: "" }));
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel space-y-4 p-6">
      <h2 className="flex items-center gap-2 text-lg font-bold text-stone-900"><Plus className="h-5 w-5 text-moss" aria-hidden="true" /> Add MCP server / tool</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="a-name" className="block text-xs font-medium text-stone-600">Name</label>
          <input id="a-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="GitHub MCP Server" className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30" />
        </div>
        <div>
          <label htmlFor="a-slug" className="block text-xs font-medium text-stone-600">Slug <span className="text-stone-400">(auto if blank)</span></label>
          <input id="a-slug" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} placeholder="github-mcp-server" className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30" />
        </div>
        <div>
          <label htmlFor="a-cat" className="block text-xs font-medium text-stone-600">Category</label>
          <select id="a-cat" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="a-trust" className="block text-xs font-medium text-stone-600">Trust level (you vouch)</label>
          <select id="a-trust" value={form.trust_status} onChange={(e) => setForm((f) => ({ ...f, trust_status: e.target.value }))} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30">
            {TRUST_LEVELS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="a-mcp" className="block text-xs font-medium text-stone-600">MCP command / URL <span className="text-stone-400">(optional)</span></label>
        <input id="a-mcp" value={form.mcp_command} onChange={(e) => setForm((f) => ({ ...f, mcp_command: e.target.value }))} placeholder="npx -y @modelcontextprotocol/server-github" className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30" />
      </div>
      <div>
        <label htmlFor="a-desc" className="block text-xs font-medium text-stone-600">Description</label>
        <input id="a-desc" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="What it does" className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30" />
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" checked={form.is_demo} onChange={(e) => setForm((f) => ({ ...f, is_demo: e.target.checked }))} className="h-4 w-4 rounded border-stone-300 text-moss focus:ring-moss/30" />
          mark as demo/example
        </label>
        <button type="submit" disabled={submitting || !form.name} aria-busy={submitting} className="inline-flex items-center gap-2 rounded-lg bg-moss px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 transition disabled:opacity-60">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />} Add to registry
        </button>
      </div>
      {error && <p className="text-sm text-signal" role="alert">{error}</p>}
      {ok && <p className="text-sm text-moss">{ok}</p>}
    </form>
  );
}
