import type {
  GatewayAdapter,
  GatewayAdapterResult,
  GatewayToolCall,
} from "../types.js";

class PendingAdapter implements GatewayAdapter {
  constructor(public executionMode: GatewayAdapter["executionMode"]) {}

  async callTool(call: GatewayToolCall): Promise<GatewayAdapterResult> {
    return {
      ok: true,
      result: {
        routed: true,
        executionMode: this.executionMode,
        toolSlug: call.tool.slug,
      },
    };
  }
}

const adapters = new Map<GatewayAdapter["executionMode"], GatewayAdapter>([
  ["hosted_hbf", new PendingAdapter("hosted_hbf")],
  ["hosted_mcp", new PendingAdapter("hosted_mcp")],
  ["remote_mcp", new PendingAdapter("remote_mcp")],
  ["api_oauth", new PendingAdapter("api_oauth")],
  ["local_connector", new PendingAdapter("local_connector")],
]);

export function getGatewayAdapter(
  executionMode: GatewayAdapter["executionMode"],
): GatewayAdapter {
  const adapter = adapters.get(executionMode);
  if (!adapter) {
    throw new Error(`No adapter registered for execution mode: ${executionMode}`);
  }
  return adapter;
}
