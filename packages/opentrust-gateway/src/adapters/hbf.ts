import type {
  GatewayAdapter,
  GatewayAdapterResult,
  GatewayToolCall,
} from "../types.js";

export type HbfDispatch = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

function hbfToolNameFromGatewaySlug(slug: string): string {
  const prefix = "hands-body-and-feet.";
  if (!slug.startsWith(prefix)) {
    throw new Error(`Invalid hosted HBF slug: ${slug}`);
  }
  return slug.slice(prefix.length);
}

export class HostedHbfAdapter implements GatewayAdapter {
  executionMode = "hosted_hbf" as const;

  constructor(private readonly dispatch: HbfDispatch) {}

  async callTool(call: GatewayToolCall): Promise<GatewayAdapterResult> {
    try {
      const hbfToolName = hbfToolNameFromGatewaySlug(call.tool.slug);
      const result = await this.dispatch(hbfToolName, call.context.toolArgs);
      return { ok: true, result };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
