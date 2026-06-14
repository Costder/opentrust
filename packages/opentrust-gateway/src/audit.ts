export interface GatewayAuditEvent {
  agentId: string;
  toolSlug: string;
  decisionReason: string;
  allowed: boolean;
  approvalRequired: boolean;
}

export async function recordGatewayAuditEvent(
  event: GatewayAuditEvent,
): Promise<GatewayAuditEvent> {
  return event;
}
