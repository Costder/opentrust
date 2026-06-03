"use client";

import { Suspense, useCallback, useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PassportCard } from "@/components/PassportCard";
import type { Passport } from "@/types/passport";
import { Search, SlidersHorizontal, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

// ── Trust levels ──────────────────────────────────────────────────────────────

const TRUST_FILTERS = [
  { value: "", label: "All" },
  { value: "auto_generated_draft", label: "Draft" },
  { value: "creator_claimed", label: "Claimed" },
  { value: "community_reviewed", label: "Community" },
  { value: "reviewer_signed", label: "Signed" },
  { value: "security_checked", label: "Security Checked" },
  { value: "continuously_monitored", label: "Monitored" },
];

const COMMERCIAL_FILTERS = [
  { value: "", label: "All" },
  { value: "free", label: "Free" },
  { value: "freemium", label: "Freemium" },
  { value: "paid", label: "Paid" },
  { value: "enterprise", label: "Enterprise" },
];

const PAGE_LIMIT = 12;

/**
 * Resolve a passport's pricing model across the shapes the API actually returns:
 *  - { "status": "free" | "paid" | ... }   (older / explicit)
 *  - { "model":  "free" | "paid" | ... }   (seeded tools)
 *  - missing / empty                        -> treat as "free"
 */
function priceModelOf(t: Passport): string {
  const cs = (t.commercial_status ?? {}) as { status?: string; model?: string };
  return cs.status || cs.model || "free";
}

// ── Client component ──────────────────────────────────────────────────────────

export default function ToolsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-stone-400" aria-label="Loading" />
      </div>
    }>
      <ToolsInner />
    </Suspense>
  );
}

function ToolsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initQ = searchParams.get("q") ?? "";
  const initTrust = searchParams.get("trust_status") ?? "";
  const initCommercial = searchParams.get("commercial") ?? "";
  const initPage = Number(searchParams.get("page") ?? "1");

  const [q, setQ] = useState(initQ);
  const [debouncedQ, setDebouncedQ] = useState(initQ);
  const [trust, setTrust] = useState(initTrust);
  const [commercial, setCommercial] = useState(initCommercial);
  const [page, setPage] = useState(initPage);
  const [items, setItems] = useState<Passport[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Debounce the search query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  // Fetch whenever filters change.
  // The commercial/pricing filter is applied client-side. Because that means we
  // must filter the FULL result set (not just one server page) for paging+counts
  // to be correct, we fetch a large page when a pricing filter is active and
  // paginate locally. Trust + search stay server-side.
  const fetchTools = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (debouncedQ) qs.set("q", debouncedQ);
      if (trust) qs.set("trust_status", trust);
      if (commercial) {
        // pull everything matching trust/search, filter + paginate locally
        qs.set("page", "1");
        qs.set("limit", "100");
      } else {
        qs.set("page", String(page));
        qs.set("limit", String(PAGE_LIMIT));
      }
      const res = await fetch(`/api/v1/tools?${qs}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const all = (data.items ?? []) as Passport[];
        if (commercial) {
          const matches = all.filter((t) => priceModelOf(t) === commercial);
          setTotal(matches.length);
          const start = (page - 1) * PAGE_LIMIT;
          setItems(matches.slice(start, start + PAGE_LIMIT));
        } else {
          setItems(all);
          setTotal(data.total ?? 0);
        }
      }
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, trust, commercial, page]);

  useEffect(() => {
    startTransition(() => { fetchTools(); });
  }, [fetchTools]);

  // Sync state changes to URL
  useEffect(() => {
    const qs = new URLSearchParams();
    if (debouncedQ) qs.set("q", debouncedQ);
    if (trust) qs.set("trust_status", trust);
    if (commercial) qs.set("commercial", commercial);
    if (page > 1) qs.set("page", String(page));
    const newUrl = `/tools${qs.toString() ? `?${qs}` : ""}`;
    router.replace(newUrl, { scroll: false });
  }, [debouncedQ, trust, commercial, page, router]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  function handleTrustChange(val: string) {
    setTrust(val);
    setPage(1);
  }
  function handleCommercialChange(val: string) {
    setCommercial(val);
    setPage(1);
  }
  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    setQ(e.target.value);
    setPage(1);
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <header>
        <h1 className="text-3xl font-bold text-stone-900">Tool Directory</h1>
        <p className="mt-1 text-stone-500">
          {total > 0 ? `${total} tool${total === 1 ? "" : "s"} registered` : "Browse all registered AI agent tools"}
        </p>
      </header>

      {/* Search + Filters */}
      <div className="space-y-3">
        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
          <input
            type="search"
            value={q}
            onChange={handleSearch}
            placeholder="Search by name, description, or capability…"
            aria-label="Search tools"
            className="w-full rounded-lg border border-stone-300 bg-white py-2.5 pl-10 pr-4 text-sm text-stone-900 placeholder:text-stone-400 focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30"
          />
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-4">
          {/* Trust filter */}
          <div className="flex items-center gap-2" role="group" aria-label="Filter by trust level">
            <SlidersHorizontal className="h-4 w-4 text-stone-400" aria-hidden="true" />
            <span className="text-xs font-medium text-stone-500 uppercase tracking-wide">Trust</span>
            <div className="flex flex-wrap gap-1">
              {TRUST_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => handleTrustChange(f.value)}
                  aria-pressed={trust === f.value}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss ${
                    trust === f.value
                      ? "bg-ink text-paper"
                      : "border border-stone-300 bg-white text-stone-600 hover:bg-stone-50"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Commercial filter */}
          <div className="flex items-center gap-2" role="group" aria-label="Filter by commercial status">
            <span className="text-xs font-medium text-stone-500 uppercase tracking-wide">Pricing</span>
            <div className="flex flex-wrap gap-1">
              {COMMERCIAL_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => handleCommercialChange(f.value)}
                  aria-pressed={commercial === f.value}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss ${
                    commercial === f.value
                      ? "bg-ink text-paper"
                      : "border border-stone-300 bg-white text-stone-600 hover:bg-stone-50"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      <div aria-live="polite" aria-busy={loading}>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-stone-400" aria-label="Loading tools" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-stone-200 bg-stone-50 py-16 text-center">
            <p className="text-stone-500">No tools found{q ? ` matching "${q}"` : ""}.</p>
            {(q || trust || commercial) && (
              <button
                onClick={() => { setQ(""); setDebouncedQ(""); setTrust(""); setCommercial(""); setPage(1); }}
                className="mt-3 text-sm text-moss underline underline-offset-2"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((tool) => (
              <PassportCard key={tool.slug} passport={tool} />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <nav className="flex items-center justify-between border-t border-stone-200 pt-4" aria-label="Pagination">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Previous
          </button>

          <span className="text-sm text-stone-500">
            Page {page} of {totalPages}
          </span>

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Next page"
          >
            Next
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </nav>
      )}
    </div>
  );
}
