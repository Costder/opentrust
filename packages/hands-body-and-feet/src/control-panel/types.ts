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

// ── Decisions ────────────────────────────────────────────────────────────────
// The decision ledger is distinct from the event timeline. The timeline records
// every event (granular, high volume). A decision records a *branch point* — the
// "why" behind a major move, the alternatives weighed, and what it cost. Most are
// authored by the Strategy Skill (plans, reroutes) or by a mode/budget change.
// Append-only: a revised decision is superseded, never mutated.
export type DecisionTrigger =
  | 'strategy_plan'
  | 'assumption_invalidated'
  | 'new_information'
  | 'mode_change'
  | 'budget_allocation'
  | 'approval'
  | 'manual';

export interface DecisionAlternative {
  option: string;
  rejectedBecause: string;
}

export interface DecisionRecord {
  decisionId: string;
  missionId: string;
  agentId: string | null;
  title: string;
  rationale: string;
  alternatives: DecisionAlternative[];
  trigger: DecisionTrigger;
  cost: number; // USDC committed by this decision; 0 if none
  reversible: boolean;
  approvedBy: 'autonomous' | 'human';
  supersededBy: string | null; // decisionId that revised this one
  createdAt: string;
}

export interface DecisionInput {
  missionId: string;
  agentId?: string | null;
  title: string;
  rationale: string;
  alternatives?: DecisionAlternative[];
  trigger: DecisionTrigger;
  cost?: number;
  reversible?: boolean;
  approvedBy?: 'autonomous' | 'human';
}

// ── Agents ───────────────────────────────────────────────────────────────────
// An agent instance is a running (or recently run) loop inside a harness. Agents
// are entities with their own history across missions — the roster view lists
// them; the detail view shows everything one agent did.
export type AgentStatus =
  | 'available'
  | 'starting'
  | 'running'
  | 'idle'
  | 'blocked'
  | 'failed'
  | 'stopped';

export interface AgentInstance {
  agentId: string;
  missionId: string | null;
  harness: HarnessStatus['harnessId'];
  model: string;
  status: AgentStatus;
  currentTaskId: string | null;
  processId: number | null;
  sessionRef: string | null;
  telemetryQuality: 'exact' | 'parsed' | 'estimated' | 'unavailable';
  createdAt: string;
  updatedAt: string;
}
