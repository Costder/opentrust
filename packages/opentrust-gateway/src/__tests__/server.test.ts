import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createGatewayApp } from "../server.js";
import type { GatewayAdapter } from "../types.js";

function gatewayCallBody({
  requestedCostUsd = 10,
  trustLevel = 4,
}: {
  requestedCostUsd?: number;
  trustLevel?: number;
} = {}) {
  return {
    tool: {
      slug: "hands-body-and-feet.pay_with_usdc",
      name: "Pay with USDC",
      providerSlug: "hands-body-and-feet",
      executionMode: "hosted_hbf",
      risk: {
        category: "payment",
        permissions: ["wallet.spend"],
        defaultDecision: "approval_required",
        approvalRequiredFor: ["wallet.spend"],
      },
    },
    policy: {
      minTrustLevel: 3,
      blockDisputed: true,
      spendCapUsdPerCall: 25,
      autoApproveMaxUsd: 5,
      blockedPermissions: [],
      approvalRequiredFor: [],
    },
    context: {
      agentId: "agent_scout",
      trustLevel,
      disputed: false,
      requestedCostUsd,
      toolArgs: { amount: requestedCostUsd },
    },
  };
}

describe("createGatewayApp", () => {
  it("returns health without auth", async () => {
    const app = createGatewayApp();
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, service: "opentrust-gateway" });
  });

  it("requires approval for a risky payment call", async () => {
    const app = createGatewayApp();
    const response = await request(app)
      .post("/api/v1/tools/call")
      .set("Authorization", "Bearer dev-token")
      .send(gatewayCallBody({ requestedCostUsd: 10 }));

    expect(response.status).toBe(202);
    expect(response.body.status).toBe("approval_required");
    expect(response.body.decision.reason).toBe(
      "approval_required_for_wallet.spend",
    );
  });

  it("records audit events for approval-required valid requests", async () => {
    const recordAuditEvent = vi.fn(async (event) => event);
    const app = createGatewayApp({ recordAuditEvent });

    const response = await request(app)
      .post("/api/v1/tools/call")
      .set("Authorization", "Bearer dev-token")
      .send(gatewayCallBody({ requestedCostUsd: 10 }));

    expect(response.status).toBe(202);
    expect(recordAuditEvent).toHaveBeenCalledOnce();
    expect(recordAuditEvent).toHaveBeenCalledWith({
      agentId: "agent_scout",
      toolSlug: "hands-body-and-feet.pay_with_usdc",
      decisionReason: "approval_required_for_wallet.spend",
      allowed: false,
      approvalRequired: true,
    });
  });

  it("returns 401 when authorization is missing", async () => {
    const app = createGatewayApp();
    const response = await request(app)
      .post("/api/v1/tools/call")
      .send(gatewayCallBody());

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "missing_bearer_token" });
  });

  it("returns 400 JSON for malformed JSON with auth", async () => {
    const response = await request(createGatewayApp())
      .post("/api/v1/tools/call")
      .set("Authorization", "Bearer dev-token")
      .set("Content-Type", "application/json")
      .send('{"tool":');

    expect(response.status).toBe(400);
    expect(response.type).toBe("application/json");
    expect(response.body).toEqual({ error: "invalid_json" });
  });

  it("returns 400 JSON for malformed JSON before missing-auth checks", async () => {
    const response = await request(createGatewayApp())
      .post("/api/v1/tools/call")
      .set("Content-Type", "application/json")
      .send('{"tool":');

    expect(response.status).toBe(400);
    expect(response.type).toBe("application/json");
    expect(response.body).toEqual({ error: "invalid_json" });
  });

  it("returns 400 for wrong-cased body fields without routing to an adapter", async () => {
    const getAdapter = vi.fn();
    const recordAuditEvent = vi.fn(async (event) => event);
    const body = gatewayCallBody();
    const response = await request(
      createGatewayApp({ getAdapter, recordAuditEvent }),
    )
      .post("/api/v1/tools/call")
      .set("Authorization", "Bearer dev-token")
      .send({
        ...body,
        context: {
          ...body.context,
          requestedCostUsd: undefined,
          requested_cost_usd: 10,
        },
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "invalid_gateway_call_context" });
    expect(getAdapter).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("routes allowed low-dollar wallet.spend calls to the hosted HBF adapter", async () => {
    const app = createGatewayApp();
    const response = await request(app)
      .post("/api/v1/tools/call")
      .set("Authorization", "Bearer dev-token")
      .send(gatewayCallBody({ requestedCostUsd: 2.5 }));

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.decision).toEqual({
      allowed: true,
      approvalRequired: false,
      reason: "allowed",
    });
    expect(response.body.result).toEqual({
      ok: true,
      result: {
        pendingRealDispatch: true,
        name: "pay_with_usdc",
        args: { amount: 2.5 },
      },
    });
  });

  it("returns 502 when the adapter reports a non-ok result", async () => {
    const adapter: GatewayAdapter = {
      executionMode: "hosted_hbf",
      async callTool() {
        return { ok: false, error: "upstream_failed" };
      },
    };

    const response = await request(
      createGatewayApp({ getAdapter: () => adapter }),
    )
      .post("/api/v1/tools/call")
      .set("Authorization", "Bearer dev-token")
      .send(gatewayCallBody({ requestedCostUsd: 2.5 }));

    expect(response.status).toBe(502);
    expect(response.body.status).toBe("adapter_error");
    expect(response.body.decision).toEqual({
      allowed: true,
      approvalRequired: false,
      reason: "allowed",
    });
    expect(response.body.result).toEqual({
      ok: false,
      error: "upstream_failed",
    });
  });

  it("returns a generic 500 when the adapter throws", async () => {
    const adapter: GatewayAdapter = {
      executionMode: "hosted_hbf",
      async callTool() {
        throw new Error("secret:/tmp/api-key");
      },
    };

    const response = await request(
      createGatewayApp({ getAdapter: () => adapter }),
    )
      .post("/api/v1/tools/call")
      .set("Authorization", "Bearer dev-token")
      .send(gatewayCallBody({ requestedCostUsd: 2.5 }));

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "unexpected_gateway_error" });
    expect(JSON.stringify(response.body)).not.toContain("secret:/tmp/api-key");
  });

  it("does not treat post-auth sentinel collisions as auth failures", async () => {
    const adapter: GatewayAdapter = {
      executionMode: "hosted_hbf",
      async callTool() {
        throw new Error("missing_bearer_token");
      },
    };

    const response = await request(
      createGatewayApp({ getAdapter: () => adapter }),
    )
      .post("/api/v1/tools/call")
      .set("Authorization", "Bearer dev-token")
      .send(gatewayCallBody({ requestedCostUsd: 2.5 }));

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "unexpected_gateway_error" });
  });

  it("returns 403 for denied calls", async () => {
    const app = createGatewayApp();
    const response = await request(app)
      .post("/api/v1/tools/call")
      .set("Authorization", "Bearer dev-token")
      .send(gatewayCallBody({ requestedCostUsd: 0, trustLevel: 2 }));

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      status: "denied",
      decision: {
        allowed: false,
        approvalRequired: false,
        reason: "trust_level_too_low",
      },
    });
  });

  it("records audit events for denied valid requests", async () => {
    const recordAuditEvent = vi.fn(async (event) => event);
    const app = createGatewayApp({ recordAuditEvent });

    const response = await request(app)
      .post("/api/v1/tools/call")
      .set("Authorization", "Bearer dev-token")
      .send(gatewayCallBody({ requestedCostUsd: 0, trustLevel: 2 }));

    expect(response.status).toBe(403);
    expect(recordAuditEvent).toHaveBeenCalledOnce();
    expect(recordAuditEvent).toHaveBeenCalledWith({
      agentId: "agent_scout",
      toolSlug: "hands-body-and-feet.pay_with_usdc",
      decisionReason: "trust_level_too_low",
      allowed: false,
      approvalRequired: false,
    });
  });
});
