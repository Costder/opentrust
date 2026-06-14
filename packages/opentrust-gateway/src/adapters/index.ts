import type {
  GatewayAdapter,
  GatewayAdapterResult,
  GatewayToolCall,
} from "../types.js";
import { HostedHbfAdapter } from "./hbf.js";
import { RemoteMcpAdapter } from "./remote-mcp.js";

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
  [
    "hosted_hbf",
    new HostedHbfAdapter(async (name, args) => ({
      pendingRealDispatch: true,
      name,
      args,
    })),
  ],
  ["hosted_mcp", new PendingAdapter("hosted_mcp")],
  [
    "remote_mcp",
    new RemoteMcpAdapter({
      endpointUrl:
        process.env.OPENTRUST_REMOTE_MCP_URL ?? "http://127.0.0.1:3999/mcp",
    }),
  ],
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
