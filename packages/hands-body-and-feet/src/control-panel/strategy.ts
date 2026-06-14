import { randomUUID } from 'crypto';
import type { Mission, StrategyRecord } from './types.js';

const BIG_GOAL_RE = /\b(grow|growth|revenue|arr|company|launch|business|marketplace|customers?|leads?|sales|scale)\b/i;

export function classifyObjective(objective: string): 'simple' | 'big_goal' {
  if (objective.length > 140) return 'big_goal';
  return BIG_GOAL_RE.test(objective) ? 'big_goal' : 'simple';
}

export function createStrategyRecord(mission: Mission): StrategyRecord | null {
  const classification = classifyObjective(mission.objective);
  if (classification === 'simple') return null;

  const now = new Date().toISOString();
  return {
    strategyGoalId: randomUUID(),
    missionId: mission.missionId,
    classification,
    goal: mission.objective,
    assumptions: [
      'The mission requires multiple steps and should be managed through Strategy Skill state.',
      'The agent must stay within the selected autonomy mode and hard budget caps.',
      'The human operator needs visible progress, events, and stop controls.',
    ],
    milestones: [
      'Clarify the objective and constraints.',
      'Select the first execution vehicle and harness.',
      'Identify missing capabilities and setup blockers.',
      'Execute the first reversible task and record results.',
    ],
    exitRules: [
      'Stop if the user pauses or stops the mission.',
      'Stop money actions when hard caps are exhausted.',
      'Ask for approval when an action exceeds the selected mode policy.',
    ],
    tasks: [
      'Create initial work packet.',
      'Check capability readiness.',
      'Dispatch to selected harness.',
      'Record timeline events and reroute if assumptions fail.',
    ],
    createdAt: now,
    updatedAt: now,
  };
}
