const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type GatewayConnectorSummary = {
  slug: string;
  name: string;
  description: string;
  execution_modes: string[];
  tool_slugs: string[];
  risk_categories: string[];
};

export async function getGatewayConnectors(): Promise<GatewayConnectorSummary[]> {
  try {
    const response = await fetch(`${apiUrl}/api/v1/gateway/connectors`, { cache: "no-store" });
    if (!response.ok) return [];
    const body = await response.json();
    return body.items ?? [];
  } catch {
    return [];
  }
}
