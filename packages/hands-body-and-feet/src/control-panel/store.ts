import { randomUUID } from 'crypto';
import { openDb } from '../spend-tracker.js';
import { defaultSpendCaps } from './permissions.js';
import type {
  AgentInstance,
  AgentOsEvent,
  DecisionInput,
  DecisionRecord,
  EventInput,
  Mission,
  MissionInput,
  StrategyRecord,
} from './types.js';

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function ensureControlPanelSchema(): void {
  const db = openDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_os_missions (
      mission_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      strategy_goal_id TEXT,
      budget_json TEXT NOT NULL,
      forbidden_actions_json TEXT NOT NULL DEFAULT '[]',
      active_agent_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_os_events (
      event_id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      agent_id TEXT,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      summary TEXT NOT NULL,
      data_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_os_strategy_records (
      strategy_goal_id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      classification TEXT NOT NULL,
      goal TEXT NOT NULL,
      assumptions_json TEXT NOT NULL DEFAULT '[]',
      milestones_json TEXT NOT NULL DEFAULT '[]',
      exit_rules_json TEXT NOT NULL DEFAULT '[]',
      tasks_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_os_capability_status (
      capability_id TEXT PRIMARY KEY,
      status_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_os_harness_status (
      harness_id TEXT PRIMARY KEY,
      status_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_os_decisions (
      decision_id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      agent_id TEXT,
      title TEXT NOT NULL,
      rationale TEXT NOT NULL,
      alternatives_json TEXT NOT NULL DEFAULT '[]',
      trigger TEXT NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      reversible INTEGER NOT NULL DEFAULT 1,
      approved_by TEXT NOT NULL DEFAULT 'autonomous',
      superseded_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_os_agents (
      agent_id TEXT PRIMARY KEY,
      mission_id TEXT,
      harness TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      current_task_id TEXT,
      process_id INTEGER,
      session_ref TEXT,
      telemetry_quality TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export function createMission(input: MissionInput): Mission {
  ensureControlPanelSchema();
  const createdAt = nowIso();
  const budget = defaultSpendCaps(input.budget);
  const mission: Mission = {
    missionId: randomUUID(),
    title: input.title?.trim() || input.objective.trim().slice(0, 80) || 'Untitled mission',
    objective: input.objective,
    mode: input.mode,
    status: input.status ?? 'draft',
    strategyGoalId: input.strategyGoalId ?? null,
    budget,
    forbiddenActions: input.forbiddenActions ?? [],
    activeAgentIds: input.activeAgentIds ?? [],
    createdAt,
    updatedAt: createdAt,
  };

  openDb().prepare(`
    INSERT INTO agent_os_missions (
      mission_id, title, objective, mode, status, strategy_goal_id,
      budget_json, forbidden_actions_json, active_agent_ids_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    mission.missionId,
    mission.title,
    mission.objective,
    mission.mode,
    mission.status,
    mission.strategyGoalId,
    JSON.stringify(mission.budget),
    JSON.stringify(mission.forbiddenActions),
    JSON.stringify(mission.activeAgentIds),
    mission.createdAt,
    mission.updatedAt,
  );

  appendEvent({
    missionId: mission.missionId,
    type: 'mission',
    summary: `Mission created in ${mission.mode} mode.`,
    data: { objective: mission.objective, budget: mission.budget },
  });

  return mission;
}

export function getMission(missionId: string): Mission | null {
  ensureControlPanelSchema();
  const row = openDb().prepare(`
    SELECT * FROM agent_os_missions WHERE mission_id = ?
  `).get(missionId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    missionId: String(row['mission_id']),
    title: String(row['title']),
    objective: String(row['objective']),
    mode: row['mode'] as Mission['mode'],
    status: row['status'] as Mission['status'],
    strategyGoalId: row['strategy_goal_id'] ? String(row['strategy_goal_id']) : null,
    budget: parseJson(String(row['budget_json']), defaultSpendCaps()),
    forbiddenActions: parseJson(String(row['forbidden_actions_json']), []),
    activeAgentIds: parseJson(String(row['active_agent_ids_json']), []),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  };
}

export function listMissions(): Mission[] {
  ensureControlPanelSchema();
  const rows = openDb().prepare(`
    SELECT mission_id FROM agent_os_missions ORDER BY created_at DESC
  `).all() as Array<{ mission_id: string }>;
  return rows.map((row) => getMission(row.mission_id)).filter((mission): mission is Mission => mission !== null);
}

export function updateMissionStatus(missionId: string, status: Mission['status']): Mission | null {
  ensureControlPanelSchema();
  openDb().prepare(`
    UPDATE agent_os_missions SET status = ?, updated_at = ? WHERE mission_id = ?
  `).run(status, nowIso(), missionId);
  return getMission(missionId);
}

export function setMissionStrategyGoal(missionId: string, strategyGoalId: string): Mission | null {
  ensureControlPanelSchema();
  const updatedAt = nowIso();
  openDb().prepare(`
    UPDATE agent_os_missions
       SET strategy_goal_id = ?, updated_at = ?
     WHERE mission_id = ?
  `).run(strategyGoalId, updatedAt, missionId);
  return getMission(missionId);
}

export function appendEvent(input: EventInput): AgentOsEvent {
  ensureControlPanelSchema();
  const event: AgentOsEvent = {
    eventId: randomUUID(),
    missionId: input.missionId,
    agentId: input.agentId ?? null,
    type: input.type,
    severity: input.severity ?? 'info',
    summary: input.summary,
    data: input.data ?? {},
    createdAt: nowIso(),
  };

  openDb().prepare(`
    INSERT INTO agent_os_events (
      event_id, mission_id, agent_id, type, severity, summary, data_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.eventId,
    event.missionId,
    event.agentId,
    event.type,
    event.severity,
    event.summary,
    JSON.stringify(event.data),
    event.createdAt,
  );

  return event;
}

export function listEvents(missionId: string): AgentOsEvent[] {
  ensureControlPanelSchema();
  const rows = openDb().prepare(`
    SELECT * FROM agent_os_events WHERE mission_id = ? ORDER BY created_at ASC
  `).all(missionId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    eventId: String(row['event_id']),
    missionId: String(row['mission_id']),
    agentId: row['agent_id'] ? String(row['agent_id']) : null,
    type: row['type'] as AgentOsEvent['type'],
    severity: row['severity'] as AgentOsEvent['severity'],
    summary: String(row['summary']),
    data: parseJson(String(row['data_json']), {}),
    createdAt: String(row['created_at']),
  }));
}

export function saveStrategyRecord(record: StrategyRecord): StrategyRecord {
  ensureControlPanelSchema();
  openDb().prepare(`
    INSERT INTO agent_os_strategy_records (
      strategy_goal_id, mission_id, classification, goal, assumptions_json,
      milestones_json, exit_rules_json, tasks_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.strategyGoalId,
    record.missionId,
    record.classification,
    record.goal,
    JSON.stringify(record.assumptions),
    JSON.stringify(record.milestones),
    JSON.stringify(record.exitRules),
    JSON.stringify(record.tasks),
    record.createdAt,
    record.updatedAt,
  );
  return record;
}

export function listStrategyRecords(missionId: string): StrategyRecord[] {
  ensureControlPanelSchema();
  const rows = openDb().prepare(`
    SELECT * FROM agent_os_strategy_records WHERE mission_id = ? ORDER BY created_at ASC
  `).all(missionId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    strategyGoalId: String(row['strategy_goal_id']),
    missionId: String(row['mission_id']),
    classification: row['classification'] as StrategyRecord['classification'],
    goal: String(row['goal']),
    assumptions: parseJson(String(row['assumptions_json']), []),
    milestones: parseJson(String(row['milestones_json']), []),
    exitRules: parseJson(String(row['exit_rules_json']), []),
    tasks: parseJson(String(row['tasks_json']), []),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  }));
}

// ── Decisions ────────────────────────────────────────────────────────────────
function rowToDecision(row: Record<string, unknown>): DecisionRecord {
  return {
    decisionId: String(row['decision_id']),
    missionId: String(row['mission_id']),
    agentId: row['agent_id'] ? String(row['agent_id']) : null,
    title: String(row['title']),
    rationale: String(row['rationale']),
    alternatives: parseJson(String(row['alternatives_json']), []),
    trigger: row['trigger'] as DecisionRecord['trigger'],
    cost: Number(row['cost']) || 0,
    reversible: Number(row['reversible']) === 1,
    approvedBy: row['approved_by'] as DecisionRecord['approvedBy'],
    supersededBy: row['superseded_by'] ? String(row['superseded_by']) : null,
    createdAt: String(row['created_at']),
  };
}

export function createDecision(input: DecisionInput): DecisionRecord {
  ensureControlPanelSchema();
  const decision: DecisionRecord = {
    decisionId: randomUUID(),
    missionId: input.missionId,
    agentId: input.agentId ?? null,
    title: input.title,
    rationale: input.rationale,
    alternatives: input.alternatives ?? [],
    trigger: input.trigger,
    cost: input.cost ?? 0,
    reversible: input.reversible ?? true,
    approvedBy: input.approvedBy ?? 'autonomous',
    supersededBy: null,
    createdAt: nowIso(),
  };

  openDb().prepare(`
    INSERT INTO agent_os_decisions (
      decision_id, mission_id, agent_id, title, rationale, alternatives_json,
      trigger, cost, reversible, approved_by, superseded_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    decision.decisionId,
    decision.missionId,
    decision.agentId,
    decision.title,
    decision.rationale,
    JSON.stringify(decision.alternatives),
    decision.trigger,
    decision.cost,
    decision.reversible ? 1 : 0,
    decision.approvedBy,
    decision.supersededBy,
    decision.createdAt,
  );

  appendEvent({
    missionId: decision.missionId,
    agentId: decision.agentId,
    type: 'strategy',
    summary: `Decision: ${decision.title}`,
    data: { decisionId: decision.decisionId, trigger: decision.trigger },
  });

  return decision;
}

// Append-only revision: a new decision supersedes an earlier one.
export function supersedeDecision(decisionId: string, supersededBy: string): void {
  ensureControlPanelSchema();
  openDb().prepare(`
    UPDATE agent_os_decisions SET superseded_by = ? WHERE decision_id = ?
  `).run(supersededBy, decisionId);
}

export function listDecisions(missionId: string): DecisionRecord[] {
  ensureControlPanelSchema();
  const rows = openDb().prepare(`
    SELECT * FROM agent_os_decisions WHERE mission_id = ? ORDER BY created_at DESC
  `).all(missionId) as Array<Record<string, unknown>>;
  return rows.map(rowToDecision);
}

export function listAllDecisions(): DecisionRecord[] {
  ensureControlPanelSchema();
  const rows = openDb().prepare(`
    SELECT * FROM agent_os_decisions ORDER BY created_at DESC
  `).all() as Array<Record<string, unknown>>;
  return rows.map(rowToDecision);
}

// ── Agents ───────────────────────────────────────────────────────────────────
function rowToAgent(row: Record<string, unknown>): AgentInstance {
  return {
    agentId: String(row['agent_id']),
    missionId: row['mission_id'] ? String(row['mission_id']) : null,
    harness: row['harness'] as AgentInstance['harness'],
    model: String(row['model']),
    status: row['status'] as AgentInstance['status'],
    currentTaskId: row['current_task_id'] ? String(row['current_task_id']) : null,
    processId: row['process_id'] != null ? Number(row['process_id']) : null,
    sessionRef: row['session_ref'] ? String(row['session_ref']) : null,
    telemetryQuality: row['telemetry_quality'] as AgentInstance['telemetryQuality'],
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  };
}

export function upsertAgent(agent: AgentInstance): AgentInstance {
  ensureControlPanelSchema();
  openDb().prepare(`
    INSERT INTO agent_os_agents (
      agent_id, mission_id, harness, model, status, current_task_id,
      process_id, session_ref, telemetry_quality, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      mission_id = excluded.mission_id,
      status = excluded.status,
      current_task_id = excluded.current_task_id,
      process_id = excluded.process_id,
      session_ref = excluded.session_ref,
      telemetry_quality = excluded.telemetry_quality,
      updated_at = excluded.updated_at
  `).run(
    agent.agentId,
    agent.missionId,
    agent.harness,
    agent.model,
    agent.status,
    agent.currentTaskId,
    agent.processId,
    agent.sessionRef,
    agent.telemetryQuality,
    agent.createdAt,
    agent.updatedAt,
  );
  return agent;
}

export function listAgents(missionId?: string): AgentInstance[] {
  ensureControlPanelSchema();
  const db = openDb();
  const rows = (missionId
    ? db.prepare(`SELECT * FROM agent_os_agents WHERE mission_id = ? ORDER BY updated_at DESC`).all(missionId)
    : db.prepare(`SELECT * FROM agent_os_agents ORDER BY updated_at DESC`).all()) as Array<Record<string, unknown>>;
  return rows.map(rowToAgent);
}
