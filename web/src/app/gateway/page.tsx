import { GatewayActionCard } from "@/components/GatewayActionCard";
import { getGatewayConnectors } from "@/lib/gateway";

export default async function GatewayPage() {
  const connectors = await getGatewayConnectors();

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <header>
        <h1 className="text-3xl font-bold text-stone-900">OpenTrust Gateway</h1>
        <p className="mt-2 max-w-3xl text-stone-600">
          One trusted MCP/API gateway for hosted hands, third-party MCP servers, user credentials,
          and local connector tools. Risky capabilities are available from day one, but controlled
          by identity, policy, approvals, spend caps, and audit logs.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        {connectors.map((connector) => (
          <GatewayActionCard key={connector.slug} connector={connector} />
        ))}
      </section>
    </main>
  );
}
