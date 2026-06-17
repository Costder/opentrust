import express, { type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getCapabilityStatuses } from './capabilities.js';
import { getHarnessStatuses } from './harnesses.js';
import { AUTONOMY_MODES, defaultSpendCaps } from './permissions.js';
import { createStrategyRecord } from './strategy.js';
import {
  appendEvent,
  createMission,
  deleteMission,
  getMission,
  listAgents,
  listAllDecisions,
  listDecisions,
  listEvents,
  listMissions,
  listStrategyRecords,
  saveStrategyRecord,
  setMissionStrategyGoal,
  updateMission,
  updateMissionStatus,
  type MissionUpdate,
} from './store.js';
import type { MissionStatus, SpendCaps } from './types.js';
import { isPaused, pause, resume } from '../state.js';

const MISSION_STATUSES: MissionStatus[] = [
  'draft', 'starting', 'running', 'waiting_approval', 'blocked', 'done', 'failed', 'stopped',
];

// Browser-bound setup secret: used to authorize local write routes when no
// HBF_LOCAL_SESSION_TOKEN is configured. Injected into the served HTML so the
// loopback control panel can authenticate writes without a cloud login.
const GENERATED_SESSION_TOKEN = randomUUID();
function activeSessionToken(): string {
  return process.env['HBF_LOCAL_SESSION_TOKEN'] || GENERATED_SESSION_TOKEN;
}

interface ControlPanelOptions {
  registryUrl: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(__dirname, 'ui');

function readUiFile(fileName: string): string {
  return readFileSync(join(UI_DIR, fileName), 'utf-8');
}

function requireLocalSession(req: Request, res: Response, next: NextFunction): void {
  const provided = req.header('x-hbf-local-session');

  if (provided && provided === activeSessionToken()) {
    next();
    return;
  }

  res.status(403).json({
    error: 'LOCAL_SESSION_REQUIRED',
    message: 'Mutating local Agent OS routes require x-hbf-local-session.',
  });
}

function sendIndex(_req: Request, res: Response): void {
  const html = readUiFile('index.html').replaceAll('__HBF_SESSION_TOKEN__', activeSessionToken());
  res.type('html').send(html);
}

function missionTitleMap(): Map<string, string> {
  return new Map(listMissions().map((m) => [m.missionId, m.title]));
}

export function registerControlPanelRoutes(
  app: express.Application,
  options: ControlPanelOptions,
): void {
  app.get('/control', sendIndex);
  app.get('/setup', sendIndex);
  app.use('/control-panel', express.static(UI_DIR));

  app.get('/api/local/status', (_req, res) => {
    res.json({
      ok: true,
      localMode: true,
      loginRequired: false,
      registryUrl: options.registryUrl,
      paused: isPaused(),
      modes: AUTONOMY_MODES,
      defaultBudget: defaultSpendCaps(),
      capabilities: getCapabilityStatuses(),
      harnesses: getHarnessStatuses(),
      missions: listMissions(),
    });
  });

  app.get('/api/local/missions', (_req, res) => {
    res.json({ missions: listMissions() });
  });

  app.post('/api/local/missions', requireLocalSession, (req, res) => {
    const objective = typeof req.body?.objective === 'string' ? req.body.objective.trim() : '';
    const mode = typeof req.body?.mode === 'string' ? req.body.mode : 'manager';

    if (!objective) {
      res.status(400).json({ error: 'OBJECTIVE_REQUIRED' });
      return;
    }

    if (!AUTONOMY_MODES.some((item) => item.mode === mode)) {
      res.status(400).json({ error: 'INVALID_MODE' });
      return;
    }

    const requestedStatus = typeof req.body?.status === 'string' && MISSION_STATUSES.includes(req.body.status as MissionStatus)
      ? (req.body.status as MissionStatus)
      : undefined;

    let mission = createMission({
      title: typeof req.body?.title === 'string' ? req.body.title : undefined,
      objective,
      mode,
      status: requestedStatus,
      budget: typeof req.body?.budget === 'object' ? req.body.budget : undefined,
      forbiddenActions: Array.isArray(req.body?.forbiddenActions) ? req.body.forbiddenActions : undefined,
    });

    const strategy = createStrategyRecord(mission);
    if (strategy) {
      saveStrategyRecord(strategy);
      mission = setMissionStrategyGoal(mission.missionId, strategy.strategyGoalId) ?? mission;
      appendEvent({
        missionId: mission.missionId,
        type: 'strategy',
        summary: 'Strategy Skill created a big-goal plan.',
        data: {
          strategyGoalId: strategy.strategyGoalId,
          assumptions: strategy.assumptions,
          milestones: strategy.milestones,
          exitRules: strategy.exitRules,
        },
      });
    }

    res.status(201).json({
      mission,
      strategy,
      events: listEvents(mission.missionId),
    });
  });

  app.get('/api/local/missions/:missionId/events', (req, res) => {
    res.json({
      events: listEvents(req.params.missionId),
      strategies: listStrategyRecords(req.params.missionId),
    });
  });

  // Full mission detail in one call: mission + plan + timeline + decisions + agents.
  app.get('/api/local/missions/:missionId/detail', (req, res) => {
    const mission = getMission(req.params.missionId);
    if (!mission) {
      res.status(404).json({ error: 'MISSION_NOT_FOUND' });
      return;
    }
    res.json({
      mission,
      strategies: listStrategyRecords(mission.missionId),
      events: listEvents(mission.missionId),
      decisions: listDecisions(mission.missionId),
      agents: listAgents(mission.missionId),
    });
  });

  // Edit a mission — objective, mode, and spend caps.
  app.patch('/api/local/missions/:missionId', requireLocalSession, (req, res) => {
    const body = req.body ?? {};
    const patch: MissionUpdate = {};

    if (typeof body.title === 'string') patch.title = body.title.trim();
    if (typeof body.objective === 'string') patch.objective = body.objective.trim();

    if (typeof body.mode === 'string') {
      if (!AUTONOMY_MODES.some((item) => item.mode === body.mode)) {
        res.status(400).json({ error: 'INVALID_MODE' });
        return;
      }
      patch.mode = body.mode as MissionUpdate['mode'];
    }

    if (typeof body.status === 'string') {
      if (!MISSION_STATUSES.includes(body.status as MissionStatus)) {
        res.status(400).json({ error: 'INVALID_STATUS' });
        return;
      }
      patch.status = body.status as MissionStatus;
    }

    if (body.budget && typeof body.budget === 'object') {
      const budget: Partial<SpendCaps> = {};
      for (const key of ['perCall', 'daily', 'missionTotal'] as const) {
        if (body.budget[key] !== undefined) {
          const n = Number(body.budget[key]);
          if (!Number.isFinite(n) || n < 0) {
            res.status(400).json({ error: 'INVALID_BUDGET' });
            return;
          }
          budget[key] = n;
        }
      }
      patch.budget = budget;
    }

    if (Array.isArray(body.forbiddenActions)) patch.forbiddenActions = body.forbiddenActions;

    const mission = updateMission(req.params.missionId, patch);
    if (!mission) {
      res.status(404).json({ error: 'MISSION_NOT_FOUND' });
      return;
    }
    appendEvent({ missionId: mission.missionId, type: 'mission', summary: 'Mission settings updated.' });
    res.json({ mission });
  });

  // Kill a mission — permanently delete it and its events/decisions/strategy/agents.
  app.delete('/api/local/missions/:missionId', requireLocalSession, (req, res) => {
    const deleted = deleteMission(req.params.missionId);
    if (!deleted) {
      res.status(404).json({ error: 'MISSION_NOT_FOUND' });
      return;
    }
    res.json({ deleted: true });
  });

  // Per-mission status change (pause/resume/stop) — distinct from the global kill switch.
  app.post('/api/local/missions/:missionId/status', requireLocalSession, (req, res) => {
    const status = typeof req.body?.status === 'string' ? req.body.status : '';
    if (!MISSION_STATUSES.includes(status as MissionStatus)) {
      res.status(400).json({ error: 'INVALID_STATUS' });
      return;
    }
    const mission = updateMissionStatus(req.params.missionId, status as MissionStatus);
    if (!mission) {
      res.status(404).json({ error: 'MISSION_NOT_FOUND' });
      return;
    }
    appendEvent({ missionId: mission.missionId, type: 'mission', summary: `Mission status set to ${status}.` });
    res.json({ mission });
  });

  // Decision ledger across all missions (mission title attached for display).
  app.get('/api/local/decisions', (_req, res) => {
    const titles = missionTitleMap();
    res.json({
      decisions: listAllDecisions().map((d) => ({ ...d, missionTitle: titles.get(d.missionId) ?? d.missionId })),
    });
  });

  // Agent roster across all missions (mission title attached for display).
  app.get('/api/local/agents', (_req, res) => {
    const titles = missionTitleMap();
    res.json({
      agents: listAgents().map((a) => ({ ...a, missionTitle: a.missionId ? titles.get(a.missionId) ?? a.missionId : null })),
    });
  });

  app.post('/api/local/kill-switch/pause', requireLocalSession, (_req, res) => {
    const state = pause('agent-os-control-panel');
    res.json({ paused: true, state });
  });

  app.post('/api/local/kill-switch/resume', requireLocalSession, (_req, res) => {
    const state = resume('agent-os-control-panel');
    res.json({ paused: false, state });
  });
}
