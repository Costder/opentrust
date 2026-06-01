import Link from "next/link";
import { DemoCheck } from "@/components/DemoCheck";
import { SearchBar } from "@/components/SearchBar";
import { ShieldCheck, Wallet, GitBranch, Coins, Check } from "lucide-react";

const tiers = [
  { label: "L1 · Register", icon: ShieldCheck, desc: "Free. Get on the registry. Everyone starts here.", href: "/register", active: true },
  { label: "L2 · Wallet Sig", icon: Wallet, desc: "Prove wallet ownership. Cryptographic, no OAuth.", href: "/register", active: true },
  { label: "L3 · GitHub Claim", icon: GitBranch, desc: "Stake your GitHub identity on an agent. Unlocks escrow.", href: "/register", active: true },
  { label: "L4 · USDC Fee", icon: Coins, desc: "$10 on-chain USDC fee. Highest starting trust. Skin in the game.", href: "/register", active: true },
];

export default function HomePage() {
  return (
    <div className="space-y-10">
      <section className="grid gap-6 md:grid-cols-[1.2fr_.8fr] md:items-end">
        <div>
          <p className="mb-3 inline-flex rounded-full border border-moss/20 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-moss">Production readiness</p>
          <h1 className="max-w-3xl text-4xl font-bold tracking-normal md:text-6xl">OpenTrust</h1>
          <p className="mt-4 max-w-2xl text-lg text-stone-700">The trust registry for AI agent tools — signed passports, local policy, revocation checks, and payment safety that agents can verify themselves.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <SearchBar />
            <Link className="inline-flex rounded bg-ink px-4 py-2 text-white" href="/register">Register an agent</Link>
          </div>
        </div>
        <DemoCheck />
      </section>

      <section>
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-xl font-bold text-stone-900">Agent Verification Tiers</h2>
          <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-bold text-green-800">All live</span>
        </div>
        <p className="text-sm text-stone-500 mb-4">
          Four paths to trust. Higher tiers unlock escrow-protected jobs. No human-in-the-loop required after setup.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tiers.map(({ label, icon: Icon, desc, href, active }) => (
            <Link
              key={label}
              href={href}
              className={`flex flex-col gap-2 rounded-lg border p-4 transition hover:border-moss hover:shadow-sm ${
                active ? "border-green-300 bg-green-50/50" : "border-stone-200 bg-white opacity-60"
              }`}
            >
              <div className="flex items-center gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${active ? "bg-moss text-white" : "bg-stone-200 text-stone-500"}`}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <span className="text-xs font-bold text-stone-700">{label}</span>
                {active && <Check className="ml-auto h-4 w-4 text-moss" aria-label="Live" />}
              </div>
              <p className="text-xs text-stone-500">{desc}</p>
            </Link>
          ))}
        </div>
        <div className="mt-4 flex justify-center">
          <Link href="/register" className="inline-flex items-center gap-1.5 rounded bg-moss px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 transition">
            Register your agent <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <Link className="inline-flex rounded border border-stone-300 bg-white/70 px-4 py-2 text-ink" href="/tools">Explore tools</Link>
    </div>
  );
}
