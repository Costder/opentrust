import { mkdirSync } from 'fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../config.js', () => ({
  CONFIG_DIR: '/tmp/test-hbf-agent-os-routes',
  ensureConfigDir: vi.fn(() => mkdirSync('/tmp/test-hbf-agent-os-routes', { recursive: true })),
  readState: vi.fn(() => ({ paused: false })),
  writeState: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  extractBearerToken: vi.fn(),
  validatePassport: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(msg: string, code = 401) {
      super(msg);
      this.statusCode = code;
      this.name = 'AuthError';
    }
  },
}));

import { createApp } from '../server.js';
import { _resetDb, openDb } from '../spend-tracker.js';

const APP_OPTIONS = { registryUrl: 'https://opentrust.sh' };

afterAll(() => {
  delete process.env['HBF_LOCAL_SESSION_TOKEN'];
  _resetDb();
});

beforeEach(() => {
  _resetDb();
  process.env['HBF_LOCAL_SESSION_TOKEN'] = 'test';
});

function resetAgentOsTables(): void {
  const db = openDb();
  db.exec(`
    DELETE FROM agent_os_strategy_records;
    DELETE FROM agent_os_events;
    DELETE FROM agent_os_missions;
  `);
}

describe('Agent OS control panel routes', () => {
  it('serves /control and /setup without passport auth', async () => {
    const app = createApp(APP_OPTIONS);

    const control = await request(app).get('/control');
    expect(control.status).toBe(200);
    expect(control.text).toMatch(/Mission Control|Agent OS/i);

    const setup = await request(app).get('/setup');
    expect(setup.status).toBe(200);
    expect(setup.text).toMatch(/Local Mode/i);
  });

  it('returns local status with modes, capabilities, harnesses, and no login requirement', async () => {
    const app = createApp(APP_OPTIONS);
    const res = await request(app).get('/api/local/status');

    expect(res.status).toBe(200);
    expect(res.body.loginRequired).toBe(false);
    expect(res.body.modes.map((mode: { mode: string }) => mode.mode)).toEqual([
      'manager',
      'operator',
      'shopkeeper',
      'founder',
    ]);
    expect(res.body.capabilities).toHaveProperty('email');
    expect(res.body.harnesses).toHaveProperty('claude');
    expect(res.body.harnesses.claude.socialAutomationAllowed).toBe(false);
  });

  it('requires a local session header for mission creation', async () => {
    const app = createApp(APP_OPTIONS);
    const res = await request(app)
      .post('/api/local/missions')
      .send({ objective: 'Run a quick test', mode: 'manager' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('LOCAL_SESSION_REQUIRED');
  });

  it('creates a big mission with a Strategy Skill event', async () => {
    const app = createApp(APP_OPTIONS);
    await request(app).get('/api/local/status');
    resetAgentOsTables();

    const res = await request(app)
      .post('/api/local/missions')
      .set('x-hbf-local-session', 'test')
      .send({
        objective: 'Launch a marketplace business and grow it to meaningful revenue.',
        mode: 'founder',
        budget: { perCall: 20, daily: 100, missionTotal: 500 },
      });

    expect(res.status).toBe(201);
    expect(res.body.mission.mode).toBe('founder');
    expect(res.body.strategy.classification).toBe('big_goal');
    expect(res.body.mission.strategyGoalId).toBe(res.body.strategy.strategyGoalId);
    expect(res.body.events.map((event: { type: string }) => event.type)).toContain('strategy');

    const events = await request(app).get(`/api/local/missions/${res.body.mission.missionId}/events`);
    expect(events.status).toBe(200);
    expect(events.body.events.length).toBeGreaterThanOrEqual(2);
    expect(events.body.strategies).toHaveLength(1);
  });

  it('serves mission detail, decisions, and agents from the live store', async () => {
    const app = createApp(APP_OPTIONS);
    await request(app).get('/api/local/status');
    resetAgentOsTables();

    const created = await request(app)
      .post('/api/local/missions')
      .set('x-hbf-local-session', 'test')
      .send({ objective: 'Grow the marketplace and onboard sellers.', mode: 'shopkeeper', status: 'running' });
    const missionId = created.body.mission.missionId;

    // seed a decision + an agent directly through the store
    const { createDecision, upsertAgent } = await import('../control-panel/store.js');
    createDecision({
      missionId, trigger: 'assumption_invalidated', title: 'Pivot to warm intros',
      rationale: 'Cold email got no replies.',
      alternatives: [{ option: 'Keep cold emailing', rejectedBecause: '0% reply rate' }],
      approvedBy: 'autonomous',
    });
    upsertAgent({
      agentId: 'agent-claude-01', missionId, harness: 'claude', model: 'claude-opus-4-8',
      status: 'running', currentTaskId: 'drafting', processId: null, sessionRef: null,
      telemetryQuality: 'exact', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });

    const detail = await request(app).get(`/api/local/missions/${missionId}/detail`);
    expect(detail.status).toBe(200);
    expect(detail.body.mission.missionId).toBe(missionId);
    expect(detail.body.decisions).toHaveLength(1);
    expect(detail.body.agents).toHaveLength(1);

    const decisions = await request(app).get('/api/local/decisions');
    expect(decisions.status).toBe(200);
    expect(decisions.body.decisions[0].title).toBe('Pivot to warm intros');
    expect(decisions.body.decisions[0].missionTitle).toBeTruthy();

    const agents = await request(app).get('/api/local/agents');
    expect(agents.status).toBe(200);
    expect(agents.body.agents[0].agentId).toBe('agent-claude-01');
    expect(agents.body.agents[0].missionTitle).toBeTruthy();
  });

  it('updates mission status with a session header and rejects without one', async () => {
    const app = createApp(APP_OPTIONS);
    await request(app).get('/api/local/status');
    resetAgentOsTables();

    const created = await request(app)
      .post('/api/local/missions')
      .set('x-hbf-local-session', 'test')
      .send({ objective: 'Quick task to pause.', mode: 'manager', status: 'running' });
    const missionId = created.body.mission.missionId;

    const noAuth = await request(app).post(`/api/local/missions/${missionId}/status`).send({ status: 'stopped' });
    expect(noAuth.status).toBe(403);

    const ok = await request(app)
      .post(`/api/local/missions/${missionId}/status`)
      .set('x-hbf-local-session', 'test')
      .send({ status: 'stopped' });
    expect(ok.status).toBe(200);
    expect(ok.body.mission.status).toBe('stopped');

    const bad = await request(app)
      .post(`/api/local/missions/${missionId}/status`)
      .set('x-hbf-local-session', 'test')
      .send({ status: 'not-a-status' });
    expect(bad.status).toBe(400);
  });
});
