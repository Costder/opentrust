import Link from "next/link";
import { DemoCheck } from "@/components/DemoCheck";
import { SearchBar } from "@/components/SearchBar";

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
            <Link className="inline-flex rounded bg-ink px-4 py-2 text-white" href="/launch-lab">Open Launch Lab</Link>
          </div>
        </div>
        <DemoCheck />
      </section>
      <Link className="inline-flex rounded border border-stone-300 bg-white/70 px-4 py-2 text-ink" href="/tools">Explore tools</Link>
    </div>
  );
}
