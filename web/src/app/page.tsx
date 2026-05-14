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
          <p className="mt-3 text-sm text-stone-700">Payment contracts and no-secret demo checkout flows ship in the public repo.</p>
        </div>
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        <PricingCard title="Discovery" price="Free" body="Browse machine-readable Agent Tool Passports." />
        <PricingCard title="Trust Report" price="19 USDC" body="Create a mock paid checkout for a report demo." />
        <PricingCard title="Verified Badge" price="49 USDC" body="Create a mock paid checkout for badge issuance." />
      </section>
      <Link className="inline-flex rounded bg-ink px-4 py-2 text-white" href="/tools">Explore tools</Link>
    </div>
  );
}
