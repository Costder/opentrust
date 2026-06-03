"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Wallet,
  ShoppingCart,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Plus,
  Coins,
  ExternalLink,
  ShieldCheck,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { useWallet, truncateAddress } from "@/lib/useWallet";
import { sendUsdc } from "@/lib/browserWallet";

// ── Types ─────────────────────────────────────────────────────────────────────

type Listing = {
  listing_id: string;
  title: string;
  price_usdc: string;
  seller_wallet_id: string;
  provider_kind: string;
  seller_trust_status: string | null;
  seller_trust_level: number | null;
  escrow_required: boolean;
  repo_id: string | null;
  pricing_model?: string;
  unit_price_usdc?: string | null;
  unit_label?: string | null;
};

function priceDisplay(l: Listing): string {
  if (l.pricing_model && l.pricing_model !== "flat" && l.unit_price_usdc) {
    const unit = l.unit_label || l.pricing_model.replace("per_", "").replace("_", " ");
    return `$${Number(l.unit_price_usdc)} / ${unit}`;
  }
  return `${Number(l.price_usdc).toFixed(2)} USDC`;
}

type Order = {
  order_id: string;
  listing_id: string;
  buyer_wallet_id: string;
  seller_wallet_id: string;
  amount_usdc: string;
  transaction_hash: string | null;
};

const PROVIDER_KINDS = ["tool", "mcp_server", "skill", "agent_service", "human_service"];

const BASE_CHAIN_ID = 8453;
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchListings(): Promise<Listing[]> {
  const res = await fetch("/api/v1/marketplace/listings", { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

async function fetchOrders(): Promise<Order[]> {
  const res = await fetch("/api/v1/marketplace/orders", { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

// ── Trust badge ─────────────────────────────────────────────────────────────────

function TrustPill({ status, level }: { status: string | null; level: number | null }) {
  if (!status) return <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-500">unverified</span>;
  const escrowReady = level != null && level >= 3 && status !== "disputed";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
      status === "disputed" ? "bg-red-100 text-red-700"
      : escrowReady ? "bg-green-100 text-green-800"
      : "bg-stone-100 text-stone-600"
    }`}>
      {escrowReady && <ShieldCheck className="h-3 w-3" aria-hidden="true" />}
      {status.replace(/_/g, " ")}{level != null ? ` · L${level}` : ""}
    </span>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────────

export default function MarketplacePage() {
  const { wallet } = useWallet();
  const [listings, setListings] = useState<Listing[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"browse" | "list" | "orders">("browse");
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [funding, setFunding] = useState<Listing | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [l, o] = await Promise.all([fetchListings(), fetchOrders()]);
    setListings(l);
    setOrders(o);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const myOrders = wallet ? orders.filter((o) => o.buyer_wallet_id === wallet.wallet_id) : [];
  const boughtIds = new Set(myOrders.map((o) => o.listing_id));

  async function handleDelete(listing: Listing) {
    if (!wallet) return;
    setErrors({});
    try {
      const res = await fetch(`/api/v1/marketplace/listings/${listing.listing_id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seller_wallet_id: wallet.wallet_id }),
      });
      if (!res.ok) throw new Error((await res.text()) || "Delete failed");
      await load();
    } catch (err) {
      setErrors({ buy: err instanceof Error ? err.message : "Delete failed" });
    }
  }

  async function handleBuy(listing: Listing) {
    if (!wallet) { setErrors({ buy: "Connect a wallet first." }); return; }
    setBuyingId(listing.listing_id);
    setErrors({});
    try {
      // Resolve the seller's on-chain address from the listing's seller wallet.
      const sellerRes = await fetch(`/api/v1/wallets/${listing.seller_wallet_id}`);
      let sellerAddress: string | null = null;
      if (sellerRes.ok) sellerAddress = (await sellerRes.json()).address;
      if (!sellerAddress) throw new Error("Could not resolve seller's wallet address.");

      // Real on-chain USDC payment on Base — the wallet prompts for confirmation.
      const txHash = await sendUsdc({
        from: wallet.address,
        to: sellerAddress,
        amountUsdc: listing.price_usdc,
        usdcContract: USDC_BASE,
        chainId: BASE_CHAIN_ID,
      });

      const orderRes = await fetch("/api/v1/marketplace/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listing_id: listing.listing_id,
          buyer_wallet_id: wallet.wallet_id,
          transaction_hash: txHash,
        }),
      });
      if (!orderRes.ok) throw new Error((await orderRes.text()) || "Order verification failed");
      await load();
      setTab("orders");
    } catch (err) {
      setErrors({ buy: err instanceof Error ? err.message : "Purchase failed" });
    } finally {
      setBuyingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-3xl font-bold text-stone-900">
          <Store className="h-7 w-7 text-moss" aria-hidden="true" /> Marketplace
        </h1>
        <p className="mt-2 max-w-2xl text-stone-500">
          Buy and sell AI agent tools, MCP servers, and services. Payments settle in real USDC on Base L2, and every listing carries a verifiable trust passport.
        </p>
      </header>

      {/* Tabs */}
      <div role="tablist" className="flex w-fit gap-1 rounded-lg border border-stone-200 bg-stone-100 p-1">
        {([["browse", "Browse"], ["list", "Sell"], ["orders", `My orders (${myOrders.length})`]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${tab === id ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "browse" && (
        <div className="space-y-4">
          {errors.buy && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-signal" role="alert">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> {errors.buy}
            </div>
          )}
          {!wallet && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <a href="/register" className="font-semibold underline">Connect a wallet</a> to buy.
            </div>
          )}
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-stone-400" aria-hidden="true" /></div>
          ) : listings.length === 0 ? (
            <div className="rounded-lg border border-stone-200 bg-stone-50 py-12 text-center text-sm text-stone-400">
              No listings yet. Be the first to <button onClick={() => setTab("list")} className="font-semibold text-moss underline">sell something</button>.
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2" role="list">
              {listings.map((listing) => (
                <li key={listing.listing_id} className="panel flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-stone-900">{listing.title}</p>
                      <p className="mt-0.5 text-xs text-stone-500">{listing.provider_kind.replace(/_/g, " ")}</p>
                    </div>
                    <TrustPill status={listing.seller_trust_status} level={listing.seller_trust_level} />
                  </div>
                  <div className="mt-auto flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 font-mono text-sm font-medium text-stone-800">
                      <Coins className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" />
                      {priceDisplay(listing)}
                    </span>
                    {wallet && listing.seller_wallet_id === wallet.wallet_id ? (
                      <button
                        onClick={() => handleDelete(listing)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-500 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                        aria-label="Delete your listing"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Your listing
                      </button>
                    ) : (listing.pricing_model && listing.pricing_model !== "flat") ? (
                      <button
                        onClick={() => setFunding(listing)}
                        disabled={!wallet}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-paper transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Coins className="h-3.5 w-3.5" aria-hidden="true" /> Fund balance
                      </button>
                    ) : boughtIds.has(listing.listing_id) ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Purchased
                      </span>
                    ) : (
                      <button
                        onClick={() => handleBuy(listing)}
                        disabled={!wallet || buyingId === listing.listing_id}
                        aria-busy={buyingId === listing.listing_id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-paper transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {buyingId === listing.listing_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ShoppingCart className="h-3.5 w-3.5" aria-hidden="true" />}
                        Buy
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "list" && <SellForm wallet={wallet} onListed={() => { setTab("browse"); void load(); }} />}

      {tab === "orders" && (
        !wallet ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <a href="/register" className="font-semibold underline">Connect a wallet</a> to see your orders.
          </div>
        ) : myOrders.length === 0 ? (
          <div className="rounded-lg border border-stone-200 bg-stone-50 py-12 text-center text-sm text-stone-400">No orders yet.</div>
        ) : (
          <ul className="space-y-3" role="list">
            {myOrders.map((order) => {
              const listing = listings.find((l) => l.listing_id === order.listing_id);
              return (
                <li key={order.order_id} className="panel p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-stone-900">{listing?.title ?? order.listing_id}</p>
                      <p className="mt-1 font-mono text-xs text-stone-500">{Number(order.amount_usdc).toFixed(2)} USDC · Base L2</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-800">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Paid
                    </span>
                  </div>
                  {order.transaction_hash && (
                    <a
                      href={`https://basescan.org/tx/${order.transaction_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 font-mono text-xs text-stone-400 hover:text-moss"
                    >
                      tx: {truncateAddress(order.transaction_hash)}
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )
      )}

      {funding && <FundDrawer listing={funding} wallet={wallet} onClose={() => setFunding(null)} />}
    </div>
  );
}

// ── Fund-balance drawer (metered listings) ─────────────────────────────────────────

function FundDrawer({ listing, wallet, onClose }: { listing: Listing; wallet: ReturnType<typeof useWallet>["wallet"]; onClose: () => void }) {
  const [amount, setAmount] = useState("1.00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [account, setAccount] = useState<{ account_id: string; balance_usdc: string; consumed_usdc: string; calls_count: number } | null>(null);

  const loadAccount = useCallback(async () => {
    if (!wallet) return;
    const res = await fetch(`/api/v1/usage/accounts?listing_id=${listing.listing_id}&buyer_wallet_id=${wallet.wallet_id}`, { cache: "no-store" });
    if (res.ok) setAccount(await res.json());
  }, [wallet, listing.listing_id]);

  useEffect(() => { void loadAccount(); }, [loadAccount]);

  async function fund() {
    if (!wallet) return;
    setError(""); setBusy(true);
    try {
      // Resolve the seller's on-chain address, send USDC, then record the fund.
      const sellerRes = await fetch(`/api/v1/wallets/${listing.seller_wallet_id}`);
      const sellerAddress = sellerRes.ok ? (await sellerRes.json()).address : null;
      if (!sellerAddress) throw new Error("Could not resolve seller wallet.");
      const txHash = await sendUsdc({ from: wallet.address, to: sellerAddress, amountUsdc: amount, usdcContract: USDC_BASE, chainId: BASE_CHAIN_ID });
      const res = await fetch("/api/v1/usage/fund", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listing_id: listing.listing_id, buyer_wallet_id: wallet.wallet_id, amount_usdc: amount, transaction_hash: txHash }),
      });
      if (!res.ok) throw new Error((await res.text()) || "Funding failed");
      setAccount(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Funding failed");
    } finally {
      setBusy(false);
    }
  }

  const unit = listing.unit_label || (listing.pricing_model ?? "").replace("per_", "");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-paper p-6 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-stone-900">{listing.title}</h2>
            <p className="mt-0.5 text-sm text-stone-500">{priceDisplay(listing)}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-stone-400 hover:bg-stone-100"><X className="h-5 w-5" aria-hidden="true" /></button>
        </div>

        {account && (
          <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg border border-stone-200 bg-white p-3 text-center text-sm">
            <div><p className="text-xs text-stone-400">Balance</p><p className="font-mono font-semibold text-stone-900">${Number(account.balance_usdc).toFixed(4)}</p></div>
            <div><p className="text-xs text-stone-400">Used</p><p className="font-mono text-stone-700">${Number(account.consumed_usdc).toFixed(4)}</p></div>
            <div><p className="text-xs text-stone-400">Calls</p><p className="font-mono text-stone-700">{account.calls_count}</p></div>
          </div>
        )}

        <div className="mt-4 space-y-3">
          <p className="text-sm text-stone-500">
            Prepay a balance. Each {unit} draws it down by the unit price; top up anytime. Funds settle to the seller on Base.
          </p>
          <div>
            <label htmlFor="fund-amt" className="block text-xs font-medium text-stone-600">{account ? "Top up" : "Fund"} amount</label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-400">$</span>
              <input id="fund-amt" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-lg border border-stone-300 bg-white py-2 pl-7 pr-14 font-mono text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400">USDC</span>
            </div>
          </div>
          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-signal" role="alert">{error}</p>}
          <button onClick={fund} disabled={busy || !wallet} aria-busy={busy} className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-800 transition disabled:opacity-60">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Funding…</> : <><Coins className="h-4 w-4" aria-hidden="true" /> {account ? "Top up balance" : "Fund balance"}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sell form ────────────────────────────────────────────────────────────────────

const PRICING_MODELS: { value: string; label: string; unit: string }[] = [
  { value: "flat",         label: "Flat (one-time)",    unit: "" },
  { value: "per_call",     label: "Per call",           unit: "call" },
  { value: "per_token",    label: "Per 1k tokens",      unit: "1k tokens" },
  { value: "per_unit",     label: "Per unit",           unit: "unit" },
  { value: "subscription", label: "Subscription / mo",  unit: "month" },
];

function SellForm({ wallet, onListed }: { wallet: ReturnType<typeof useWallet>["wallet"]; onListed: () => void }) {
  const [form, setForm] = useState({ title: "", price: "", provider_kind: "tool", pricing_model: "flat", unit_price: "", unit_label: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!wallet) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <a href="/register" className="font-semibold underline">Connect a wallet</a> to list a tool.
      </div>
    );
  }

  const metered = form.pricing_model !== "flat";
  const modelMeta = PRICING_MODELS.find((m) => m.value === form.pricing_model)!;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        seller_wallet_id: wallet!.wallet_id,
        title: form.title,
        provider_kind: form.provider_kind,
        pricing_model: form.pricing_model,
        // price_usdc is required by the API; for metered listings it's a
        // representative/fallback value (use the unit price).
        price_usdc: metered ? (form.unit_price || "0.01") : form.price,
      };
      if (metered) {
        body.unit_price_usdc = form.unit_price;
        body.unit_label = form.unit_label || modelMeta.unit;
      }
      const res = await fetch("/api/v1/marketplace/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.text()) || "Failed to create listing");
      onListed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to list");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel max-w-lg space-y-4 p-6">
      <div>
        <label htmlFor="s-title" className="block text-sm font-medium text-stone-700">Tool / service name</label>
        <input id="s-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required placeholder="GitHub Code Search MCP" className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30" />
      </div>

      {/* Pricing model + kind */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="s-model" className="block text-sm font-medium text-stone-700">Pricing</label>
          <select id="s-model" value={form.pricing_model} onChange={(e) => setForm((f) => ({ ...f, pricing_model: e.target.value }))} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30">
            {PRICING_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="s-kind" className="block text-sm font-medium text-stone-700">Kind</label>
          <select id="s-kind" value={form.provider_kind} onChange={(e) => setForm((f) => ({ ...f, provider_kind: e.target.value }))} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30">
            {PROVIDER_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
          </select>
        </div>
      </div>

      {/* Price input — flat vs. metered */}
      {!metered ? (
        <div>
          <label htmlFor="s-price" className="block text-sm font-medium text-stone-700">Price (one-time)</label>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-400">$</span>
            <input id="s-price" type="number" min="0.01" step="0.01" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} required placeholder="5.00" className="w-full rounded-lg border border-stone-300 bg-white py-2 pl-7 pr-14 font-mono text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400">USDC</span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="s-unit-price" className="block text-sm font-medium text-stone-700">Price per {modelMeta.unit}</label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-400">$</span>
              <input id="s-unit-price" type="number" min="0.0001" step="0.0001" value={form.unit_price} onChange={(e) => setForm((f) => ({ ...f, unit_price: e.target.value }))} required placeholder="0.002" className="w-full rounded-lg border border-stone-300 bg-white py-2 pl-7 pr-14 font-mono text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400">USDC</span>
            </div>
          </div>
          <div>
            <label htmlFor="s-unit-label" className="block text-sm font-medium text-stone-700">Unit label <span className="text-stone-400">(optional)</span></label>
            <input id="s-unit-label" value={form.unit_label} onChange={(e) => setForm((f) => ({ ...f, unit_label: e.target.value }))} placeholder={modelMeta.unit} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30" />
          </div>
        </div>
      )}

      {metered && (
        <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          Buyers prepay a balance for this listing; each {modelMeta.unit} draws it down by your unit price. They top up when it runs low. The balance settles to your wallet on Base.
        </p>
      )}

      <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
        <p className="font-medium text-stone-700">Seller wallet</p>
        <p className="mt-0.5 font-mono text-xs">{wallet.address}</p>
        <p className="mt-1 text-xs text-stone-400">Payments go directly to your wallet on Base. OpenTrust takes no cut.</p>
      </div>
      {error && <p className="text-sm text-signal" role="alert">{error}</p>}
      <button type="submit" disabled={submitting} aria-busy={submitting} className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-800 transition disabled:opacity-60">
        {submitting ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Listing…</> : <><Plus className="h-4 w-4" aria-hidden="true" /> Create listing</>}
      </button>
    </form>
  );
}
