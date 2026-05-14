import { notFound } from "next/navigation";
import { BadgeEmbed } from "@/components/BadgeEmbed";
import { PermissionTable } from "@/components/PermissionTable";
import { RiskSummary } from "@/components/RiskSummary";
import { TrustBadge } from "@/components/TrustBadge";
import { getTool } from "@/lib/api";

export default async function ToolPage({ params }: { params: { slug: string } }) {
  const tool = await getTool(params.slug);
  if (!tool) notFound();
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{tool.name}</h1>
          <p className="mt-2 text-stone-700">{tool.description}</p>
        </div>
        <TrustBadge status={tool.trust_status} />
      </header>
      <section className="grid gap-4 md:grid-cols-2">
        <div className="panel p-4">
          <h2 className="mb-3 text-lg font-semibold">Permissions</h2>
          <PermissionTable permissions={tool.permission_manifest} />
        </div>
        <div className="panel p-4">
          <h2 className="mb-3 text-lg font-semibold">Commercial Status</h2>
          <p>{tool.commercial_status.status}</p>
          {tool.billing_plan ? (
            <p className="mt-2 text-sm">{tool.billing_plan.tier}: {tool.billing_plan.amount_usdc} USDC / {tool.billing_plan.interval}</p>
          ) : (
            <p className="mt-2 text-sm text-stone-700">Payment info is available through the public payment contract schema.</p>
          )}
        </div>
      </section>
      <RiskSummary summary={tool.risk_summary} warning={tool.warning} />
      <section className="panel p-4">
        <h2 className="mb-3 text-lg font-semibold">Badge</h2>
        <BadgeEmbed slug={tool.slug} />
      </section>
    </div>
  );
}
