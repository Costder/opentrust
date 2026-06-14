import express from "express";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { getGatewayAdapter } from "./adapters/index.js";
import { recordGatewayAuditEvent } from "./audit.js";
import { extractGatewayBearerToken } from "./auth.js";
import {
  evaluateGatewayPolicy,
  gatewayCallContextSchema,
  gatewayPolicySchema,
  gatewayToolSpecSchema,
} from "./policy.js";
import type { GatewayAdapter } from "./types.js";

const gatewayCallRequestSchema = z
  .object({
    tool: gatewayToolSpecSchema,
    policy: gatewayPolicySchema,
    context: gatewayCallContextSchema,
  })
  .strict();

export interface CreateGatewayAppOptions {
  getAdapter?: (executionMode: GatewayAdapter["executionMode"]) => GatewayAdapter;
  recordAuditEvent?: typeof recordGatewayAuditEvent;
}

const jsonParseErrorHandler: express.ErrorRequestHandler = (
  error,
  _req,
  res,
  next,
) => {
  if (
    error instanceof SyntaxError &&
    typeof error === "object" &&
    "body" in error
  ) {
    return res.status(400).json({ error: "invalid_json" });
  }

  return next(error);
};

export function createGatewayApp(
  options: CreateGatewayAppOptions = {},
): express.Application {
  const app = express();
  const lookupAdapter = options.getAdapter ?? getGatewayAdapter;
  const recordAudit = options.recordAuditEvent ?? recordGatewayAuditEvent;

  app.use(express.json({ limit: "1mb" }));
  app.use(jsonParseErrorHandler);

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true, service: "opentrust-gateway" });
  });

  app.post("/api/v1/tools/call", async (req, res) => {
    try {
      extractGatewayBearerToken(req.get("authorization"));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unexpected_gateway_error";
      if (message === "missing_bearer_token") {
        return res.status(401).json({ error: "missing_bearer_token" });
      }
      return res.status(500).json({ error: "unexpected_gateway_error" });
    }

    try {
      const parsed = gatewayCallRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_gateway_call_context" });
      }

      const { tool, policy, context } = parsed.data;
      const decision = evaluateGatewayPolicy({ tool, policy, context });

      await recordAudit({
        agentId: context.agentId,
        toolSlug: tool.slug,
        decisionReason: decision.reason,
        allowed: decision.allowed,
        approvalRequired: decision.approvalRequired,
      });

      if (decision.approvalRequired) {
        return res.status(202).json({ status: "approval_required", decision });
      }

      if (!decision.allowed) {
        return res.status(403).json({ status: "denied", decision });
      }

      const result = await lookupAdapter(tool.executionMode).callTool({
        tool,
        context,
      });

      if (!result.ok) {
        return res.status(502).json({
          status: "adapter_error",
          decision,
          result,
        });
      }

      return res.status(200).json({ status: "ok", decision, result });
    } catch (error) {
      return res.status(500).json({ error: "unexpected_gateway_error" });
    }
  });

  return app;
}

const modulePath = resolve(fileURLToPath(import.meta.url));
const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;

if (entryPath === modulePath) {
  const port = Number(process.env.PORT ?? 8787);
  createGatewayApp().listen(port, () => {
    console.log(`opentrust-gateway listening on ${port}`);
  });
}
