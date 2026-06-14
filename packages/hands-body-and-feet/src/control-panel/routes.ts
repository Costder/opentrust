import express, { type Request, type Response, type NextFunction } from 'express';
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
  listEvents,
  listMissions,
  listStrategyRecords,
  saveStrategyRecord,
  setMissionStrategyGoal,
} from './store.js';
import { isPaused, pause, resume } from '../state.js';

interface ControlPanelOptions {
  registryUrl: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(__dirname, 'ui');

function readUiFile(fileName: string): string {
  return readFileSync(join(UI_DIR, fileName), 'utf-8');
}

function requireLocalSession(req: Request, res: Response, next: NextFunction): void {
  const configuredToken = process.env['HBF_LOCAL_SESSION_TOKEN'];
  const provided = req.header('x-hbf-local-session');

  if (configuredToken && provided === configuredToken) {
    next();
    return;
  }

  res.status(403).json({
    error: 'LOCAL_SESSION_REQUIRED',
    message: 'Mutating local Agent OS routes require x-hbf-local-session.',
  });
}

function sendIndex(_req: Request, res: Response): void {
  res.type('html').send(readUiFile('index.html'));
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

    let mission = createMission({
      title: typeof req.body?.title === 'string' ? req.body.title : undefined,
      objective,
      mode,
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

  app.post('/api/local/kill-switch/pause', requireLocalSession, (_req, res) => {
    const state = pause('agent-os-control-panel');
    res.json({ paused: true, state });
  });

  app.post('/api/local/kill-switch/resume', requireLocalSession, (_req, res) => {
    const state = resume('agent-os-control-panel');
    res.json({ paused: false, state });
  });
}
