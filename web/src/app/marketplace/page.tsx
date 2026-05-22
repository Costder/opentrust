"use client";

import { useState } from "react";
import {
  Wallet,
  ShoppingCart,
  Package,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Plus,
  ArrowRight,
  ExternalLink,
  Coins,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type WalletAccount = {
  wallet_id: string;
  owner: string;
  address: string;
  kind: "byo" | "embedded";
};

type Listing = {
  listing_id: string;
  title: string;
  price_usdc: number;
  seller_wallet_id: string;
  repo_id?: string;
};

type Order = {
  order_id: string;
  listing_id: string;
  buyer_wallet_id: string;
  seller_wallet_id: string;
  amount_usdc: number;
  transaction_hash?: string;
};

type DemoState = {
  wallet: WalletAccount | null;
  listings: Listing[];
  orders: Order[];
};

// ── Demo seed listings (displayed before wallet connect) ──────────────────────

const DEMO_LISTINGS: Listing[] = [
  {
    listing_id: "demo-1",
    title: "GitHub Code Search MCP",
    price_usdc: 0.05,
    seller_wallet_id: "demo-seller",
  },
  {
    listing_id: "demo-2",
    title: "Deep Code Audit (semgrep + CodeQL)",
    price_usdc: 19.0,
    seller_wallet_id: "demo-seller",
  },
  {
    listing_id: "demo-3",
    title: "Real-Time CVE Monitor",
    price_usdc: 9.0,
    seller_wallet_id: "demo-seller",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const API = process.env.NEXT_PUBLIC_API_URL || "";

async function connectWallet(owner: string, address: string): Promise<WalletAccount> {
  const res = await fetch(`${API}/api/v1/wallets/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, address, kind: "byo" }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function truncateAddress(addr: string) {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepBadge({ n, done }: { n: number; done: boolean }) {
  return (
    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-moss text-white" : "bg-stone-200 text-stone-600"}`}>
      {done ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : n}
    </div>
  );
}

function ListingCard({
  listing,
  onBuy,
  bought,
  buying,
  walletConnected,
}: {
  listing: Listing;
  onBuy: (id: string) => void;
  bought: boolean;
  buying: boolean;
  walletConnected: boolean;
}) {
  return (
    <div className={`panel p-4 flex items-start justify-between gap-4 ${bought ? "opacity-75" : ""}`}>
      <div className="min-w-0">
        <p className="font-semibold text-stone-900 truncate">{listing.title}</p>
        <p className="mt-1 flex items-center gap-1 text-sm text-stone-500">
          <Coins className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="font-mono font-medium text-stone-800">{listing.price_usdc.toFixed(2)} USDC</span>
          <span>per use · Base L2</span>
        </p>
      </div>
      {bought ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1.5 text-xs font-semibold text-green-800">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          Purchased
        </span>
      ) : (
        <button
          onClick={() => onBuy(listing.listing_id)}
          disabled={!walletConnected || buying}
          aria-busy={buying}
          title={walletConnected ? undefined : "Connect a wallet first"}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-paper transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          {buying ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ShoppingCart className="h-3.5 w-3.5" aria-hidden="true" />}
          Buy
        </button>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MarketplacePage() {
  const [state, setState] = useState<DemoState>({
    wallet: null,
    listings: DEMO_LISTINGS,
    orders: [],
  });

  const [walletForm, setWalletForm] = useState({ owner: "", address: "" });
  const [connecting, setConnecting] = useState(false);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [newListing, setNewListing] = useState({ title: "", price: "" });
  const [creatingListing, setCreatingListing] = useState(false);
  const [tab, setTab] = useState<"browse" | "orders" | "list">("browse");

  async function handleConnectWallet(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setConnecting(true);
    try {
      const wallet = await connectWallet(walletForm.owner, walletForm.address);
      setState((s) => ({ ...s, wallet }));
    } catch (err) {
      setErrors({ wallet: err instanceof Error ? err.message : "Connection failed" });
    } finally {
      setConnecting(false);
    }
  }

  async function handleBuy(listingId: string) {
    if (!state.wallet) return;
    setBuyingId(listingId);
    setErrors({});
    try {
      // In the real flow: broadcast USDC tx on Base, then POST /api/v1/marketplace/orders
      // For demo, we POST directly (store is in-memory; listing must exist in store)
      // Since demo listings are frontend-only, we simulate the order locally.
      await new Promise((r) => setTimeout(r, 1500)); // simulate tx broadcast
      const fakeOrder: Order = {
        order_id: `order_demo_${Math.random().toString(36).slice(2, 8)}`,
        listing_id: listingId,
        buyer_wallet_id: state.wallet.wallet_id,
        seller_wallet_id: "demo-seller",
        amount_usdc: state.listings.find((l) => l.listing_id === listingId)?.price_usdc ?? 0,
        transaction_hash: `0x${Math.random().toString(36).slice(2).repeat(4).slice(0, 64)}`,
      };
      setState((s) => ({ ...s, orders: [...s.orders, fakeOrder] }));
    } catch (err) {
      setErrors({ buy: err instanceof Error ? err.message : "Purchase failed" });
    } finally {
      setBuyingId(null);
    }
  }

  async function handleCreateListing(e: React.FormEvent) {
    e.preventDefault();
    if (!state.wallet) return;
    setErrors({});
    setCreatingListing(true);
    try {
      await new Promise((r) => setTimeout(r, 800));
      const listing: Listing = {
        listing_id: `listing_${Math.random().toString(36).slice(2, 8)}`,
        title: newListing.title,
        price_usdc: Number(newListing.price),
        seller_wallet_id: state.wallet.wallet_id,
      };
      setState((s) => ({ ...s, listings: [...s.listings, listing] }));
      setNewListing({ title: "", price: "" });
    } catch (err) {
      setErrors({ listing: err instanceof Error ? err.message : "Failed to create listing" });
    } finally {
      setCreatingListing(false);
    }
  }

  const boughtIds = new Set(state.orders.map((o) => o.listing_id));

  return (
    <div className="space-y-8">

      {/* Header */}
      <header>
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold text-stone-900">Marketplace</h1>
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
            v0.6 Demo
          </span>
        </div>
        <p className="mt-2 max-w-2xl text-stone-500">
          AI agents buy and sell tools directly — no human in the loop. Payments settle in USDC on Base L2, escrow holds funds until delivery, and the trust passport is machine-readable proof that the tool is what it claims.
        </p>
      </header>

      {/* How it works */}
      <section aria-labelledby="how-it-works-heading" className="panel p-6">
        <h2 id="how-it-works-heading" className="mb-4 text-sm font-semibold uppercase tracking-widest text-stone-400">
          How agent payments work
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              n: 1,
              icon: Wallet,
              title: "Agent holds a wallet",
              body: "The agent's wallet is just a private key. No account, no KYC. It signs USDC transactions on Base L2.",
            },
            {
              n: 2,
              icon: Package,
              title: "Reads the passport",
              body: "The tool's passport declares its price, USDC address, and escrow threshold. The agent parses this directly.",
            },
            {
              n: 3,
              icon: ShoppingCart,
              title: "Pays and gets access",
              body: "The agent broadcasts the USDC tx, gets the tx hash as receipt, and the tool unlocks — all in one step.",
            },
          ].map(({ n, icon: Icon, title, body }) => (
            <div key={n} className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink text-paper">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="font-semibold text-stone-900">{title}</p>
                <p className="mt-1 text-sm text-stone-500">{body}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          This demo uses simulated transactions. Real USDC payments on Base L2 ship in v1.0.
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-3">

        {/* Left: Wallet connect */}
        <div className="space-y-4">
          <section aria-labelledby="wallet-heading">
            <div className="panel p-5">
              <h2 id="wallet-heading" className="flex items-center gap-2 font-bold text-stone-900">
                <StepBadge n={1} done={!!state.wallet} />
                Connect wallet
              </h2>

              {state.wallet ? (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-green-900 truncate">{state.wallet.owner}</p>
                      <p className="font-mono text-xs text-green-700">{truncateAddress(state.wallet.address)}</p>
                    </div>
                  </div>
                  <p className="text-xs text-stone-400">Balance: 10.00 USDC (simulated)</p>
                </div>
              ) : (
                <form onSubmit={handleConnectWallet} className="mt-4 space-y-3">
                  <p className="text-sm text-stone-500">Enter a wallet address to simulate a BYO (bring-your-own) wallet connection.</p>
                  <div>
                    <label htmlFor="wallet-owner" className="block text-xs font-medium text-stone-600">Agent name</label>
                    <input
                      id="wallet-owner"
                      type="text"
                      value={walletForm.owner}
                      onChange={(e) => setWalletForm((f) => ({ ...f, owner: e.target.value }))}
                      placeholder="my-agent"
                      required
                      className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30"
                    />
                  </div>
                  <div>
                    <label htmlFor="wallet-address" className="block text-xs font-medium text-stone-600">USDC wallet address</label>
                    <input
                      id="wallet-address"
                      type="text"
                      value={walletForm.address}
                      onChange={(e) => setWalletForm((f) => ({ ...f, address: e.target.value }))}
                      placeholder="0xYourWalletAddress"
                      required
                      className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-mono focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30"
                    />
                  </div>
                  {errors.wallet && (
                    <p className="text-sm text-signal" role="alert">{errors.wallet}</p>
                  )}
                  <button
                    type="submit"
                    disabled={connecting}
                    aria-busy={connecting}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper transition hover:bg-stone-700 disabled:opacity-60"
                  >
                    {connecting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Wallet className="h-4 w-4" aria-hidden="true" />}
                    {connecting ? "Connecting…" : "Connect wallet"}
                  </button>
                </form>
              )}
            </div>
          </section>

          {/* Orders panel */}
          {state.orders.length > 0 && (
            <section aria-labelledby="orders-heading">
              <div className="panel p-5">
                <h2 id="orders-heading" className="flex items-center gap-2 font-bold text-stone-900">
                  <StepBadge n={3} done={state.orders.length > 0} />
                  My orders ({state.orders.length})
                </h2>
                <ul className="mt-4 space-y-2" role="list">
                  {state.orders.map((order) => {
                    const listing = state.listings.find((l) => l.listing_id === order.listing_id);
                    return (
                      <li key={order.order_id} className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
                        <p className="font-semibold text-stone-900">{listing?.title ?? order.listing_id}</p>
                        <p className="mt-0.5 font-mono text-xs text-stone-500">
                          {order.amount_usdc.toFixed(2)} USDC
                        </p>
                        {order.transaction_hash && (
                          <p className="mt-1 flex items-center gap-1 font-mono text-xs text-stone-400">
                            tx: {truncateAddress(order.transaction_hash)}
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          )}
        </div>

        {/* Right: Listings + List a tool */}
        <div className="lg:col-span-2 space-y-4">

          {/* Tab bar */}
          <div role="tablist" className="flex gap-1 rounded-lg border border-stone-200 bg-stone-100 p-1 w-fit">
            {[
              { id: "browse" as const, label: "Browse listings" },
              { id: "list" as const, label: "List a tool", disabled: !state.wallet },
              { id: "orders" as const, label: `Orders (${state.orders.length})` },
            ].map(({ id, label, disabled }) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => !disabled && setTab(id)}
                disabled={disabled}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                  tab === id
                    ? "bg-white text-stone-900 shadow-sm"
                    : disabled
                    ? "cursor-not-allowed text-stone-300"
                    : "text-stone-500 hover:text-stone-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Browse tab */}
          {tab === "browse" && (
            <section aria-labelledby="listings-heading">
              <h2 id="listings-heading" className="flex items-center gap-2 font-bold text-stone-900 mb-3">
                <StepBadge n={2} done={state.orders.length > 0} />
                Available tools
              </h2>
              {!state.wallet && (
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Connect a wallet first to purchase tools.
                </div>
              )}
              {errors.buy && (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-signal" role="alert">
                  {errors.buy}
                </div>
              )}
              <ul className="space-y-3" role="list" aria-label="Tool listings">
                {state.listings.map((listing) => (
                  <li key={listing.listing_id}>
                    <ListingCard
                      listing={listing}
                      onBuy={handleBuy}
                      bought={boughtIds.has(listing.listing_id)}
                      buying={buyingId === listing.listing_id}
                      walletConnected={!!state.wallet}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* List a tool tab */}
          {tab === "list" && state.wallet && (
            <section aria-labelledby="create-listing-heading">
              <h2 id="create-listing-heading" className="font-bold text-stone-900 mb-3">List a new tool</h2>
              <div className="panel p-5">
                <form onSubmit={handleCreateListing} className="space-y-4">
                  <div>
                    <label htmlFor="listing-title" className="block text-sm font-medium text-stone-700">Tool name</label>
                    <input
                      id="listing-title"
                      type="text"
                      value={newListing.title}
                      onChange={(e) => setNewListing((f) => ({ ...f, title: e.target.value }))}
                      placeholder="My Awesome MCP Tool"
                      required
                      className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30"
                    />
                  </div>
                  <div>
                    <label htmlFor="listing-price" className="block text-sm font-medium text-stone-700">Price (USDC per call)</label>
                    <div className="relative mt-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-400">$</span>
                      <input
                        id="listing-price"
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={newListing.price}
                        onChange={(e) => setNewListing((f) => ({ ...f, price: e.target.value }))}
                        placeholder="0.05"
                        required
                        className="w-full rounded-lg border border-stone-300 bg-white py-2 pl-7 pr-16 text-sm font-mono focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400">USDC</span>
                    </div>
                    <p className="mt-1 text-xs text-stone-400">Minimum ~$0.001. Near-zero gas fees on Base L2.</p>
                  </div>
                  <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
                    <p className="font-medium text-stone-700">Seller wallet</p>
                    <p className="mt-0.5 font-mono text-xs">{state.wallet.address}</p>
                    <p className="mt-1 text-xs text-stone-400">Payments go directly to your wallet — OpenTrust takes no cut.</p>
                  </div>
                  {errors.listing && (
                    <p className="text-sm text-signal" role="alert">{errors.listing}</p>
                  )}
                  <button
                    type="submit"
                    disabled={creatingListing}
                    aria-busy={creatingListing}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-green-800 disabled:opacity-60"
                  >
                    {creatingListing
                      ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Creating…</>
                      : <><Plus className="h-4 w-4" aria-hidden="true" /> Create listing</>
                    }
                  </button>
                </form>
              </div>
            </section>
          )}

          {/* Orders tab */}
          {tab === "orders" && (
            <section aria-labelledby="orders-tab-heading">
              <h2 id="orders-tab-heading" className="font-bold text-stone-900 mb-3">My orders</h2>
              {state.orders.length === 0 ? (
                <div className="rounded-lg border border-stone-200 bg-stone-50 py-12 text-center text-sm text-stone-400">
                  No orders yet. Browse listings and buy a tool first.
                </div>
              ) : (
                <ul className="space-y-3" role="list">
                  {state.orders.map((order) => {
                    const listing = state.listings.find((l) => l.listing_id === order.listing_id);
                    return (
                      <li key={order.order_id} className="panel p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-stone-900">{listing?.title ?? order.listing_id}</p>
                            <p className="mt-1 font-mono text-xs text-stone-500">{order.order_id}</p>
                          </div>
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-800">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            Paid
                          </span>
                        </div>
                        <div className="mt-3 border-t border-stone-100 pt-3 grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-stone-400">Amount</span>
                            <p className="font-mono font-medium text-stone-800">{order.amount_usdc.toFixed(4)} USDC</p>
                          </div>
                          <div>
                            <span className="text-stone-400">Network</span>
                            <p className="font-medium text-stone-800">Base L2</p>
                          </div>
                          {order.transaction_hash && (
                            <div className="col-span-2">
                              <span className="text-stone-400">Transaction</span>
                              <p className="font-mono text-stone-800 break-all">{order.transaction_hash}</p>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

        </div>
      </div>

      {/* Roadmap note */}
      <section className="border-t border-stone-200 pt-6">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-stone-400 mb-3">Roadmap to v1.0</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { done: true,  label: "Signed passports",           detail: "Ed25519, offline verification" },
            { done: true,  label: "Spend policy enforcement",   detail: "Local caps, escrow thresholds" },
            { done: true,  label: "Signed payment quotes",      detail: "Nonce, expiry, wallet-bound" },
            { done: false, label: "Live USDC on Base",          detail: "Real on-chain settlement" },
            { done: false, label: "On-chain escrow contracts",  detail: "Auto-refund on non-delivery" },
            { done: false, label: "Wallet connect UI",          detail: "MetaMask, WalletConnect" },
          ].map(({ done, label, detail }) => (
            <div key={label} className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${done ? "border-green-200 bg-green-50" : "border-stone-200 bg-stone-50"}`}>
              {done
                ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-moss" aria-label="Done" />
                : <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" aria-label="Coming soon" />
              }
              <div>
                <p className={`text-sm font-medium ${done ? "text-green-900" : "text-stone-700"}`}>{label}</p>
                <p className="mt-0.5 text-xs text-stone-400">{detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
