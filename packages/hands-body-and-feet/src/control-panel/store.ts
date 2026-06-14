import { randomUUID } from 'crypto';
import { openDb } from '../spend-tracker.js';
import { defaultSpendCaps } from './permissions.js';
import type {
  AgentOsEvent,
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
