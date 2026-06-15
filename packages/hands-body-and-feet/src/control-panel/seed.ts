import {
  appendEvent,
  createDecision,
  createMission,
  listMissions,
  saveStrategyRecord,
  setMissionStrategyGoal,
  upsertAgent,
} from './store.js';
import { createStrategyRecord } from './strategy.js';
import type { AgentInstance } from './types.js';

/**
 * Populates the local store with a small, realistic demo so the control panel
 * shows live data on a fresh machine. Idempotent — only runs when the store is
 * empty. Called from startServer (real runtime), never from createApp (tests).
 */
export function seedControlPanelDemoIfEmpty(): void {
  try {
    if (listMissions().length > 0) return;

    const m1 = createMission({
      title: 'Marketplace growth',
      objective: 'Onboard 5 marketplace sellers and validate their passports this week.',
      mode: 'shopkeeper',
      status: 'running',
      budget: { perCall: 2, daily: 50, missionTotal: 200 },
    });
    const s1 = createStrategyRecord(m1);
    if (s1) { saveStrategyRecord(s1); setMissionStrategyGoal(m1.missionId, s1.strategyGoalId); }
    createDecision({
      missionId: m1.missionId, trigger: 'strategy_plan', approvedBy: 'autonomous',
      title: 'Onboard sellers before acquiring buyers',
      rationale: 'The marketplace is supply-constrained; adding sellers unlocks buyer value. Front-load supply first.',
      alternatives: [{ option: 'Acquire buyers first', rejectedBecause: 'Nothing to buy yet — they would churn' }],
    });
    createDecision({
      missionId: m1.missionId, trigger: 'budget_allocation', approvedBy: 'human', cost: 60,
      title: 'Allocate $60 to Apollo for seller sourcing',
      rationale: 'Need verified contact data for 20 candidate sellers; Apollo is the cheapest option inside the mission budget.',
      alternatives: [{ option: 'Source sellers manually', rejectedBecause: 'Too slow for a one-week milestone' }],
    });
    appendEvent({ missionId: m1.missionId, type: 'spend', summary: 'Spent $0.42 · lead enrichment (within cap).', data: { amount: 0.42 } });

    const m2 = createMission({
      title: 'Lead outreach',
      objective: 'Find 50 qualified leads, draft outreach, send from inbox, and track replies.',
      mode: 'operator',
      status: 'waiting_approval',
      budget: { perCall: 1, daily: 25, missionTotal: 50 },
    });
    const s2 = createStrategyRecord(m2);
    if (s2) { saveStrategyRecord(s2); setMissionStrategyGoal(m2.missionId, s2.strategyGoalId); }
    createDecision({
      missionId: m2.missionId, trigger: 'assumption_invalidated', approvedBy: 'autonomous',
      title: 'Pivot from cold email to warm intros',
      rationale: '0 of 40 cold emails drew a reply — the assumption "leads respond to cold email" is invalidated. Switching to LinkedIn warm intros through shared connections.',
      alternatives: [
        { option: 'Keep sending cold email', rejectedBecause: '0% reply rate after 40 sends' },
        { option: 'Buy a larger lead list', rejectedBecause: 'Outside budget and lower intent' },
      ],
    });

    const m3 = createMission({
      title: 'Repo + landing page',
      objective: 'Set up the GitHub repo and ship the first landing page PR.',
      mode: 'manager',
      status: 'done',
      budget: { perCall: 0, daily: 0, missionTotal: 25 },
    });

    const now = new Date().toISOString();
    const agents: AgentInstance[] = [
      { agentId: 'agent-claude-01', missionId: m2.missionId, harness: 'claude', model: 'claude-opus-4-8', status: 'running', currentTaskId: 'Drafting outreach emails', processId: null, sessionRef: null, telemetryQuality: 'exact', createdAt: now, updatedAt: now },
      { agentId: 'agent-hermes-01', missionId: m1.missionId, harness: 'hermes', model: '—', status: 'idle', currentTaskId: null, processId: null, sessionRef: null, telemetryQuality: 'parsed', createdAt: now, updatedAt: now },
      { agentId: 'agent-codex-01', missionId: m3.missionId, harness: 'codex', model: 'gpt-5-codex', status: 'stopped', currentTaskId: null, processId: null, sessionRef: null, telemetryQuality: 'estimated', createdAt: now, updatedAt: now },
    ];
    agents.forEach(upsertAgent);
  } catch {
    // Seeding is best-effort; never block server startup on it.
  }
}
