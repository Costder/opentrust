import { describe, expect, it, vi } from "vitest";

import { RemoteMcpAdapter } from "../adapters/remote-mcp.js";
import type { GatewayToolCall } from "../types.js";

function gatewayCall(overrides: Partial<GatewayToolCall> = {}): GatewayToolCall {
  return {
    tool: {
      slug: "remote-provider.notify_human",
      name: "Notify Human",
      providerSlug: "remote-provider",
      executionMode: "remote_mcp",
      risk: {
        category: "notification",
        permissions: ["notify.send"],
        defaultDecision: "allow",
        approvalRequiredFor: [],
      },
    },
    context: {
      agentId: "agent_scout",
      trustLevel: 3,
      disputed: false,
      requestedCostUsd: 0,
      toolArgs: { message: "hello" },
    },
    ...overrides,
  };
}

describe("RemoteMcpAdapter", () => {
  it("posts a JSON-RPC tools/call request and returns the result", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: "response-id",
        result: { delivered: true },
      }),
    })) as unknown as typeof fetch;
    const adapter = new RemoteMcpAdapter({
      endpointUrl: "https://mcp.example.com/rpc",
      fetchImpl,
    });

    const result = await adapter.callTool(gatewayCall());

    expect(result).toEqual({ ok: true, result: { delivered: true } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(url).toBe("https://mcp.example.com/rpc");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init?.body as string)).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "notify_human",
        arguments: { message: "hello" },
      },
    });
    expect(JSON.parse(init?.body as string).id).toEqual(expect.any(String));
  });

  it("returns an HTTP adapter error for non-ok responses", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ result: { ignored: true } }),
    })) as unknown as typeof fetch;
    const adapter = new RemoteMcpAdapter({
      endpointUrl: "https://mcp.example.com/rpc",
      fetchImpl,
    });

    const result = await adapter.callTool(gatewayCall());

    expect(result).toEqual({ ok: false, error: "remote_mcp_http_500" });
  });

  it("returns a JSON-RPC adapter error when the response body has an error", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: "response-id",
        error: { code: -32601, message: "Unknown tool" },
      }),
    })) as unknown as typeof fetch;
    const adapter = new RemoteMcpAdapter({
      endpointUrl: "https://mcp.example.com/rpc",
      fetchImpl,
    });

    const result = await adapter.callTool(gatewayCall());

    expect(result).toEqual({
      ok: false,
      error: JSON.stringify({ code: -32601, message: "Unknown tool" }),
    });
  });

  it("returns an adapter error when fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network unavailable");
    }) as unknown as typeof fetch;
    const adapter = new RemoteMcpAdapter({
      endpointUrl: "https://mcp.example.com/rpc",
      fetchImpl,
    });

    const result = await adapter.callTool(gatewayCall());

    expect(result).toEqual({ ok: false, error: "network unavailable" });
  });
});
