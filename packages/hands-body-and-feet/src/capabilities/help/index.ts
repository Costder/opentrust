// packages/hands-body-and-feet/src/capabilities/help/index.ts
// Tool catalog introspection — returns the full tool list grouped by domain.
import { enforceTrust } from '../../trust.js';
import { CATALOG, RECIPES } from '../../catalog.js';
import type { PassportClaims, ToolDefinition, SpendPolicy } from '../../types.js';

// ── Tool definition ──────────────────────────────────────────
const HBF_HELP_TOOL: ToolDefinition = { name: 'hbf_help', minTrustLevel: 1 };

export const HELP_TOOLS = {
  hbf_help: HBF_HELP_TOOL,
} as const;

// ── Types ────────────────────────────────────────────────────
interface DomainCatalog {
  domain: string;
  tools: Array<{
    name: string;
    description: string;
    minTrustLevel: number;
    spendPolicy?: SpendPolicy;
  }>;
}

export async function hbfHelp(
  params: { domain?: string },
  claims: PassportClaims,
): Promise<{ domains: DomainCatalog[]; recipes: string[] }> {
  enforceTrust(claims, HBF_HELP_TOOL);

  const entries = params.domain
    ? CATALOG.filter((e) => e.domain === params.domain)
    : CATALOG;

  // Group by domain preserving insertion order
  const domainMap = new Map<string, DomainCatalog>();
  for (const entry of entries) {
    if (!domainMap.has(entry.domain)) {
      domainMap.set(entry.domain, { domain: entry.domain, tools: [] });
    }
    const dc = domainMap.get(entry.domain)!;
    dc.tools.push({
      name: entry.name,
      description: entry.description,
      minTrustLevel: entry.minTrustLevel,
      ...(entry.spendPolicy ? { spendPolicy: entry.spendPolicy } : {}),
    });
  }

  return {
    domains: Array.from(domainMap.values()),
    recipes: RECIPES,
  };
}
