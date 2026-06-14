export type AutonomyMode = 'manager' | 'operator' | 'shopkeeper' | 'founder';

export type MissionStatus =
  | 'draft'
  | 'starting'
  | 'running'
  | 'waiting_approval'
  | 'blocked'
  | 'done'
  | 'failed'
  | 'stopped';

export type EventType =
  | 'mission'
  | 'strategy'
  | 'task'
  | 'tool_call'
  | 'approval'
  | 'spend'
  | 'token_usage'
  | 'capability'
  | 'harness'
  | 'error';

export type EventSeverity = 'info' | 'warning' | 'critical';

export interface SpendCaps {
  perCall: number;
  daily: number;
  missionTotal: number;
  currency: 'USD' | 'USDC';
}

export interface Mission {
  missionId: string;
  title: string;
  objective: string;
  mode: AutonomyMode;
  status: MissionStatus;
  strategyGoalId: string | null;
  budget: SpendCaps;
  forbiddenActions: string[];
  activeAgentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MissionInput {
  title?: string;
  objective: string;
  mode: AutonomyMode;
  budget?: Partial<SpendCaps>;
  forbiddenActions?: string[];
  activeAgentIds?: string[];
  status?: MissionStatus;
  strategyGoalId?: string | null;
}

export interface AgentOsEvent {
  eventId: string;
  missionId: string;
  agentId: string | null;
  type: EventType;
  severity: EventSeverity;
  summary: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface EventInput {
  missionId: string;
  agentId?: string | null;
  type: EventType;
  severity?: EventSeverity;
  summary: string;
  data?: Record<string, unknown>;
}

export interface StrategyRecord {
  strategyGoalId: string;
  missionId: string;
  classification: 'simple' | 'big_goal';
  goal: string;
  assumptions: string[];
  milestones: string[];
  exitRules: string[];
  tasks: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityStatus {
  capabilityId: string;
  label: string;
  provider: string | null;
  status: 'ready' | 'missing_config' | 'failed_test' | 'disabled';
  riskClass: 'local' | 'external_message' | 'money' | 'infrastructure' | 'public_action';
  phase: 1 | 2;
  details: string;
}

export interface HarnessStatus {
  harnessId: 'hermes' | 'openclaw' | 'codex' | 'claude';
  label: string;
  dayOne: boolean;
  detected: boolean;
  unattendedAllowed: boolean;
  socialAutomationAllowed: boolean;
  telemetryQuality: 'exact' | 'parsed' | 'estimated' | 'unavailable';
  launchHint: string;
}
