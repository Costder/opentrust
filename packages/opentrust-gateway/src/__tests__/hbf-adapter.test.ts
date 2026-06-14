import { describe, expect, it } from "vitest";

import { HostedHbfAdapter } from "../adapters/hbf.js";
import { getGatewayAdapter } from "../adapters/index.js";

describe("HostedHbfAdapter", () => {
  it("maps gateway tool slug to HBF tool name", async () => {
    const adapter = new HostedHbfAdapter(async (name, args) => ({
      ok: true,
      name,
      args,
    }));

    const result = await adapter.callTool({
      tool: {
        slug: "hands-body-and-feet.notify_human",
        name: "Notify Human",
        providerSlug: "hands-body-and-feet",
        executionMode: "hosted_hbf",
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
    });

    expect(result).toEqual({
      ok: true,
      result: {
        ok: true,
        name: "notify_human",
        args: { message: "hello" },
      },
    });
  });

  it("returns an adapter error for non-HBF slugs", async () => {
    const adapter = new HostedHbfAdapter(async (name, args) => ({
      name,
      args,
    }));

    const result = await adapter.callTool({
      tool: {
        slug: "other-provider.notify_human",
        name: "Notify Human",
        providerSlug: "other-provider",
        executionMode: "hosted_hbf",
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
    });

    expect(result).toEqual({
      ok: false,
      error: "Invalid hosted HBF slug: other-provider.notify_human",
    });
  });

  it("registers hosted_hbf with placeholder dispatch", async () => {
    const adapter = getGatewayAdapter("hosted_hbf");

    const result = await adapter.callTool({
      tool: {
        slug: "hands-body-and-feet.notify_human",
        name: "Notify Human",
        providerSlug: "hands-body-and-feet",
        executionMode: "hosted_hbf",
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
    });

    expect(result).toEqual({
      ok: true,
      result: {
        pendingRealDispatch: true,
        name: "notify_human",
        args: { message: "hello" },
      },
    });
  });
});
