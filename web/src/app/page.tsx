import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import { DemoCheck } from "@/components/DemoCheck";
import { SearchBar } from "@/components/SearchBar";
import { ShieldCheck, Wallet, GitBranch, Coins, Check, Package, Terminal } from "lucide-react";

const tiers = [
  { label: "L1 · Register", icon: ShieldCheck, desc: "Free. Get on the registry. Everyone starts here.", href: "/register", active: true },
  { label: "L2 · Wallet Sig", icon: Wallet, desc: "Prove wallet ownership. Cryptographic, no OAuth.", href: "/register", active: true },
  { label: "L3 · GitHub Claim", icon: GitBranch, desc: "Stake your GitHub identity on an agent. Unlocks escrow.", href: "/register", active: true },
  { label: "L4 · USDC Fee", icon: Coins, desc: "$10 on-chain USDC fee. Highest starting trust. Skin in the game.", href: "/register", active: true },
];

const packages = [
  {
    title: "Agent tool server",
    ecosystem: "npm",
    version: "2.3.1",
    command: "npm install -g @infinitestudios/hands-body-and-feet@latest",
    update: "npm update -g @infinitestudios/hands-body-and-feet",
    note: "Run the MCP server locally for Claude, Codex, or any MCP-compatible agent.",
  },
  {
    title: "TypeScript client",
    ecosystem: "npm",
    version: "1.0.2",
    command: "npm install @infinitestudios/opentrust-client@latest",
    update: "npm update @infinitestudios/opentrust-client",
    note: "Verify tool passports from JavaScript or TypeScript agent code.",
  },
  {
    title: "Python SDK + CLI",
    ecosystem: "pip",
    version: "1.0.1",
    command: "python -m pip install -U opentrust-sdk opentrust-cli opentrust-payment-contracts",
    update: "python -m pip install -U opentrust-sdk opentrust-cli opentrust-payment-contracts",
    note: "Use the Python SDK, CLI, and payment contracts from one command.",
  },
];

function CommandRow({ label, command }: { label: string; command: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-stone-200 bg-white px-3 py-2">
      <span className="w-14 shrink-0 text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</span>
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs text-stone-800">{command}</code>
      <CopyButton text={command} className="shrink-0 rounded border border-stone-200 bg-stone-50 p-2 transition hover:bg-white" />
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="space-y-10">
      <section className="grid gap-6 md:grid-cols-[1.2fr_.8fr] md:items-end">
        <div>
          <h1 className="max-w-3xl text-4xl font-bold tracking-normal md:text-6xl">OpenTrust</h1>
          <p className="mt-4 max-w-2xl text-lg text-stone-700">The trust registry for AI agent tools — signed passports, local policy, revocation checks, and payment safety that agents can verify themselves.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <SearchBar />
            <Link className="inline-flex rounded bg-ink px-4 py-2 text-white" href="/register">Register an agent</Link>
          </div>
        </div>
        <DemoCheck />
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-white">
                <Package className="h-4 w-4" aria-hidden="true" />
              </div>
              <h2 className="text-xl font-bold text-stone-900">Install or update OpenTrust</h2>
            </div>
            <p className="max-w-2xl text-sm text-stone-600">
              Copy the package command for your agent runtime. `@latest` pulls the newest published npm release; `-U` upgrades installed Python packages.
            </p>
          </div>
          <Link href="https://github.com/Costder/opentrust" className="inline-flex rounded border border-stone-300 bg-white/70 px-3 py-2 text-sm text-ink">
            GitHub repo
          </Link>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {packages.map((pkg) => (
            <div key={pkg.title} className="rounded-lg border border-stone-200 bg-white/75 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-stone-900">{pkg.title}</p>
                  <p className="mt-1 text-xs text-stone-500">{pkg.note}</p>
                </div>
                <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700">
                  {pkg.ecosystem} v{pkg.version}
                </span>
              </div>
              <div className="space-y-2">
                <CommandRow label="Install" command={pkg.command} />
                <CommandRow label="Update" command={pkg.update} />
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-moss/20 bg-green-50/70 px-4 py-3 text-sm text-stone-700">
          <Terminal className="h-4 w-4 text-moss" aria-hidden="true" />
          <span>
            Quick start: <code className="rounded bg-white px-1.5 py-0.5 text-xs">npx @infinitestudios/hands-body-and-feet init</code>, then connect your agent to the MCP server.
          </span>
        </div>
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
