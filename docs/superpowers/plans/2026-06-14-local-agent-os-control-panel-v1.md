# Local Agent OS Control Panel V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first local HBF Agent OS control panel so `hands-body-and-feet serve` exposes `/control`, `/setup`, and `/api/local/*` for mission-first setup, capability visibility, autonomy modes, hard spend caps, kill switch state, Strategy Skill records, harness detection, and local events.

**Architecture:** HBF remains the npm MCP server and real-world tool layer. The control panel is served by the existing Express app in `packages/hands-body-and-feet/src/server.ts`; local state is stored in the existing SQLite database from `spend-tracker.ts`. Static UI assets live under `src/control-panel/ui`, and focused API/store modules live under `src/control-panel`.

**Tech Stack:** TypeScript, Express, better-sqlite3, Vitest, supertest, existing HBF config/state/spend tracker.

---

## File Structure

- Create `packages/hands-body-and-feet/src/control-panel/types.ts` for modes, missions, events, capabilities, budgets, harness records, and provider status types.
- Create `packages/hands-body-and-feet/src/control-panel/store.ts` for SQLite migrations and CRUD around missions, events, strategy records, capabilities, permission profiles, and harness detections.
- Create `packages/hands-body-and-feet/src/control-panel/capabilities.ts` for current HBF capability definitions and environment/provider readiness checks.
- Create `packages/hands-body-and-feet/src/control-panel/permissions.ts` for Manager, Operator, Shopkeeper, Founder mode metadata and hard-budget spend decisions.
- Create `packages/hands-body-and-feet/src/control-panel/harnesses.ts` for Hermes Agent, OpenClaw, Codex, and Claude detection metadata.
- Create `packages/hands-body-and-feet/src/control-panel/strategy.ts` for local Strategy Skill classification and strategy record creation.
- Create `packages/hands-body-and-feet/src/control-panel/routes.ts` to register `/control`, `/setup`, and `/api/local/*`.
- Create `packages/hands-body-and-feet/src/control-panel/ui/index.html`, `app.js`, and `styles.css`.
- Modify `packages/hands-body-and-feet/src/server.ts` to call `registerControlPanelRoutes(app, options)`.
- Create tests under `packages/hands-body-and-feet/src/__tests__/control-panel-*.test.ts`.

## Task Split

Codex owns:

- `types.ts`, `store.ts`, `permissions.ts`, `strategy.ts`, `routes.ts`, server integration, and API tests.

Claude Code owns:

- `capabilities.ts`, `harnesses.ts`, UI files, and UI/static route smoke tests.

The write sets are disjoint except `routes.ts` may need to import Claude-owned modules. Codex should create route placeholders that tolerate those modules being added later; Claude should not edit `server.ts`, `store.ts`, or `permissions.ts`.

---

### Task 1: Local State And Permission Core

**Files:**
- Create: `packages/hands-body-and-feet/src/control-panel/types.ts`
- Create: `packages/hands-body-and-feet/src/control-panel/store.ts`
- Create: `packages/hands-body-and-feet/src/control-panel/permissions.ts`
- Test: `packages/hands-body-and-feet/src/__tests__/control-panel-store.test.ts`
- Test: `packages/hands-body-and-feet/src/__tests__/control-panel-permissions.test.ts`

- [x] **Step 1: Add tests for mode metadata and hard-budget spend decisions**

Create tests that assert all four public modes exist, money actions are allowed inside hard caps, and above-cap actions are blocked.

- [x] **Step 2: Add store tests**

Create tests that use a temp `HBF_TEST_CONFIG_DIR`, create a mission, append events, update budgets, and read the append-only timeline.

- [x] **Step 3: Implement focused types, store migrations, and permission helpers**

Store tables:

- `agent_os_missions`
- `agent_os_events`
- `agent_os_strategy_records`
- `agent_os_capability_status`
- `agent_os_harness_status`

- [x] **Step 4: Run focused tests**

Run:

```bash
cd packages/hands-body-and-feet
npm test -- src/__tests__/control-panel-store.test.ts src/__tests__/control-panel-permissions.test.ts
```

Expected: new tests pass.

### Task 2: Local API Routes And Server Integration

**Files:**
- Create: `packages/hands-body-and-feet/src/control-panel/routes.ts`
- Modify: `packages/hands-body-and-feet/src/server.ts`
- Test: `packages/hands-body-and-feet/src/__tests__/control-panel-routes.test.ts`

- [x] **Step 1: Add route tests**

Test:

- `GET /control` returns HTML.
- `GET /setup` redirects or returns the same local app shell.
- `GET /api/local/status` returns paused state, registry URL, modes, budgets, capabilities, and harnesses.
- `POST /api/local/missions` creates a mission and a strategy event for big goals.
- `GET /api/local/missions/:id/events` returns append-only timeline.
- `POST /api/local/kill-switch/pause` and `/resume` update local paused state.

- [x] **Step 2: Implement routes**

Register routes before MCP auth middleware so browser control panel reads do not require an agent passport. Write operations must use a configured local session guard header.

- [x] **Step 3: Integrate into server**

Import `registerControlPanelRoutes` in `server.ts` and call it immediately after webhooks/RSS routes and before auth middleware.

- [x] **Step 4: Run focused tests**

Run:

```bash
cd packages/hands-body-and-feet
npm test -- src/__tests__/control-panel-routes.test.ts
```

Expected: route tests pass.

### Task 3: Capability And Harness Surface

**Files:**
- Create: `packages/hands-body-and-feet/src/control-panel/capabilities.ts`
- Create: `packages/hands-body-and-feet/src/control-panel/harnesses.ts`
- Test: `packages/hands-body-and-feet/src/__tests__/control-panel-capabilities.test.ts`
- Test: `packages/hands-body-and-feet/src/__tests__/control-panel-harnesses.test.ts`

- [x] **Step 1: Add capability tests**

Assert the surfaced capability list includes email, phone/SMS, GitHub, wallets/payments, virtual cards, Docker, tunnels/webhooks, IPFS, physical mail, and existing distribution-capable tools.

- [x] **Step 2: Add readiness tests**

Assert env var combinations mark AgentMail, Twilio, SignalWire, JMP, GitHub, Moon, IPFS, PostScan, and Earth Class Mail ready/missing without exposing secret values.

- [x] **Step 3: Add harness tests**

Assert Hermes Agent, OpenClaw, Codex, and Claude are included with `dayOne: true`; Claude supports unattended/overnight but has `socialAutomationAllowed: false`.

- [x] **Step 4: Implement modules**

Return safe metadata only. Do not return raw env values.

### Task 4: Static Local Control Panel UI

**Files:**
- Create: `packages/hands-body-and-feet/src/control-panel/ui/index.html`
- Create: `packages/hands-body-and-feet/src/control-panel/ui/app.js`
- Create: `packages/hands-body-and-feet/src/control-panel/ui/styles.css`
- Test: `packages/hands-body-and-feet/src/__tests__/control-panel-ui.test.ts`

- [x] **Step 1: Add static UI test**

Assert `/control` includes "What do you want done?", Manager/Operator/Shopkeeper/Founder, kill switch, spend cap, Strategy Skill, Hermes, OpenClaw, Codex, Claude, and OpenTrust marketplace prompts.

- [x] **Step 2: Implement UI**

Build a static local app shell with:

- first-run mission prompt
- autonomy cards
- mission dashboard placeholders
- capability cards
- kill switch and spend controls
- harness cards
- contextual marketplace/passport/job/review prompt

### Task 5: Strategy Records And Mission Creation

**Files:**
- Create: `packages/hands-body-and-feet/src/control-panel/strategy.ts`
- Modify: `packages/hands-body-and-feet/src/control-panel/routes.ts`
- Test: `packages/hands-body-and-feet/src/__tests__/control-panel-strategy.test.ts`

- [x] **Step 1: Add strategy tests**

Assert big goals produce a strategy record with goal, assumptions, milestones, exit rules, and a timeline event. Assert simple tasks can skip strategy with a direct-execution classification.

- [x] **Step 2: Implement strategy helper**

Use deterministic classification for v1:

- big if objective contains growth/revenue/company/ARR/launch/business/marketplace or has more than 140 characters
- otherwise simple

- [x] **Step 3: Wire into mission creation route**

`POST /api/local/missions` creates mission, strategy record when classified big, and timeline events.

### Task 6: Verification And Packaging

**Files:**
- Modify only if failures require small fixes.

- [x] **Step 1: Run full HBF tests**

```bash
cd packages/hands-body-and-feet
npm test
```

- [x] **Step 2: Run typecheck and build**

```bash
cd packages/hands-body-and-feet
npm run typecheck
npm run build
```

- [x] **Step 3: Smoke route manually**

Start:

```bash
cd packages/hands-body-and-feet
npm run build
node bin/hands-body-and-feet.js serve --port 3847 --allow-local-fallback
```

Open:

- `http://localhost:3847/control`
- `http://localhost:3847/api/local/status`

Expected: UI and JSON load.
