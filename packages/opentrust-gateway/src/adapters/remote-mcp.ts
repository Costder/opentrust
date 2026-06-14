import { webcrypto as crypto } from "node:crypto";

import type {
  GatewayAdapter,
  GatewayAdapterResult,
  GatewayToolCall,
} from "../types.js";

export interface RemoteMcpAdapterOptions {
  endpointUrl: string;
  fetchImpl?: typeof fetch;
}

function toolNameFromSlug(slug: string): string {
  const parts = slug.split(".");
  return parts[parts.length - 1] ?? slug;
}

export class RemoteMcpAdapter implements GatewayAdapter {
  executionMode = "remote_mcp" as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: RemoteMcpAdapterOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async callTool(call: GatewayToolCall): Promise<GatewayAdapterResult> {
    try {
      const response = await this.fetchImpl(this.options.endpointUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: crypto.randomUUID(),
          method: "tools/call",
          params: {
            name: toolNameFromSlug(call.tool.slug),
            arguments: call.context.toolArgs,
          },
        }),
      });

      if (!response.ok) {
        return { ok: false, error: `remote_mcp_http_${response.status}` };
      }

      const body = (await response.json()) as {
        result?: unknown;
        error?: unknown;
      };

      if (body.error !== undefined) {
        return { ok: false, error: JSON.stringify(body.error) };
      }

      return { ok: true, result: body.result };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
