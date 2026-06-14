import { Plug, ShieldCheck } from "lucide-react";
import type { GatewayConnectorSummary } from "@/lib/gateway";

export function GatewayActionCard({ connector }: { connector: GatewayConnectorSummary }) {
  return (
    <article className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-stone-900">{connector.name}</h2>
          <p className="mt-1 text-sm text-stone-600">{connector.description}</p>
        </div>
        <Plug className="h-5 w-5 shrink-0 text-moss" aria-hidden="true" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {connector.execution_modes.map((mode) => (
          <span key={mode} className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">
            {mode}
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-sm text-stone-600">
        <ShieldCheck className="h-4 w-4 text-moss" aria-hidden="true" />
        Policy, approvals, audit logs, and marketplace reputation wrap every call.
      </div>
    </article>
  );
}
