import Link from "next/link";
import { PricingCard } from "@/components/PricingCard";
import { SearchBar } from "@/components/SearchBar";

export default function HomePage() {
  return (
    <div className="space-y-10">
      <section className="grid gap-6 md:grid-cols-[1.2fr_.8fr] md:items-end">
        <div>
          <h1 className="max-w-3xl text-4xl font-bold tracking-normal md:text-6xl">OpenTrust</h1>
          <p className="mt-4 max-w-2xl text-lg text-stone-700">The trust registry for agents before they install tools or spend money.</p>
          <div className="mt-6">
            <SearchBar />
          </div>
        </div>
        <div className="panel p-5">
          <p className="text-sm font-semibold uppercase text-signal">Phase 0 Registry</p>
          <p className="mt-3 text-sm text-stone-700">Payment interfaces are public contracts. Real checkout, USDC, Circle, and escrow code lives in opentrust-private.</p>
        </div>
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        <PricingCard title="Discovery" price="Free" body="Browse machine-readable Agent Tool Passports." />
        <PricingCard title="Verification" price="Coming Soon" body="Reviewer-signed checks and monitoring arrive through payment contract stubs." />
        <PricingCard title="Private Add-on" price="Separate Repo" body="Install opentrust-private to wire real payment providers." />
      </section>
      <Link className="inline-flex rounded bg-ink px-4 py-2 text-white" href="/tools">Explore tools</Link>
    </div>
  );
}
