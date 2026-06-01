import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { ToolCard } from "@/components/ToolCard";
import type { Passport } from "@/types/passport";

const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function getDemoTools(): Promise<Passport[]> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/tools?demo_only=true&limit=100`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return data.items ?? [];
  } catch {
    return [];
  }
}

export default async function DemoPage() {
  const tools = await getDemoTools();

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold text-stone-900">
            <FlaskConical className="h-7 w-7 text-moss" aria-hidden="true" /> Demo tools
          </h1>
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
            examples
          </span>
        </div>
        <p className="mt-2 max-w-2xl text-stone-500">
          These are illustrative example passports for exploring the trust model and the UI. They are
          <strong> not real tools</strong> and are kept separate from the{" "}
          <Link href="/tools" className="text-moss underline underline-offset-2">live registry</Link>.
        </p>
      </header>

      {tools.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-stone-50 py-12 text-center text-sm text-stone-400">
          No demo tools are currently published.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list">
          {tools.map((tool) => (
            <li key={tool.slug}>
              <ToolCard passport={tool} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
