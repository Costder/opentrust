import Link from "next/link";
import { DemoCheck } from "@/components/DemoCheck";
import { SearchBar } from "@/components/SearchBar";

export default function HomePage() {
  return (
    <div className="space-y-10">
      <section className="grid gap-6 md:grid-cols-[1.2fr_.8fr] md:items-end">
        <div>
          <h1 className="max-w-3xl text-4xl font-bold tracking-normal md:text-6xl">OpenTrust</h1>
          <p className="mt-4 max-w-2xl text-lg text-stone-700">The trust registry for AI agent tools — one passport, one trust status, readable by any agent.</p>
          <div className="mt-6">
            <SearchBar />
          </div>
        </div>
        <DemoCheck />
      </section>
      <Link className="inline-flex rounded bg-ink px-4 py-2 text-white" href="/tools">Explore tools</Link>
    </div>
  );
}
