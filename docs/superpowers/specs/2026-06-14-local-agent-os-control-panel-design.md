# Local Agent OS Control Panel Design

Date: 2026-06-14
Status: design approved for planning

## Summary

OpenTrust should ship a local-first Agent OS control panel inside Hands Body and Feet (HBF). The first target user is a solo casual user who wants to give an AI a real-world objective and supervise the result without learning MCP, env files, or agent orchestration.

The product promise is:

> Tell an agent what real-world outcome you want. OpenTrust helps it plan, use the right harness, configure needed capabilities, act through HBF, track what happened, and stay stoppable.

This is not only a setup dashboard. It is a local mission control layer for agent work. Configuration remains available anytime, but the primary flow starts with the user's objective.

The local version is fully usable without an OpenTrust login. OpenTrust account connection comes later for marketplace sync, passports, jobs, reviews, reputation, hosted gateway, and cloud/team governance.

## Product Principles

1. Goal first, config second.
2. Local first, cloud optional.
3. Casual users should see plain language before env vars.
4. Every meaningful action becomes a timeline event.
5. Token/cost tracking is best effort and honest about gaps.
6. Risky capabilities are the reason the product exists, so they are present from the start but gated by autonomy mode, spend caps, approvals, and kill switch controls.
7. Loading and empty states may promote OpenTrust marketplace, jobs, passports, reviews, and registry growth. They should not repeatedly upsell cloud.

## Target Users

### V1: Solo Casual User

Examples:

- A founder trying to grow a small product.
- A creator who wants an agent to handle email, GitHub, web research, and simple operations.
- A non-technical user who wants useful automation without understanding MCP configuration.
- A developer-adjacent user who already uses Codex, Claude, Hermes, or OpenClaw but wants one control surface.

### Later: Developers And Businesses

Developer/operator and business/team use cases move mostly to hosted OpenTrust cloud:

- Multi-user roles and approvals.
- Organization budgets.
- Audit exports.
- Shared agent/tool inventory.
- Hosted gateway and SaaS credential vault.
- Marketplace seller/buyer workflows.

The local Agent OS architecture should support those future sync paths without making cloud required.

## Day-One Harnesses

The local control panel must treat harnesses as first-class. Day-one adapters:

- Hermes Agent
- OpenClaw
- Codex
- Claude Desktop / Claude Code

Later adapters:

- Cursor
- ChatGPT desktop or app integrations if practical
- Custom MCP runners
- Hosted OpenTrust cloud agents

Each harness adapter exposes the same minimal local interface:

```ts
interface HarnessAdapter {
  id: string;
  label: string;
  detect(): Promise<HarnessDetection>;
  launch(input: LaunchRequest): Promise<LaunchResult>;
  stop(instanceId: string): Promise<StopResult>;
  getStatus(instanceId: string): Promise<HarnessStatus>;
  getTelemetry(instanceId: string): Promise<HarnessTelemetry>;
}
```

Telemetry may be exact, parsed, estimated, or unavailable depending on the harness.

## Strategy Skill Integration

Agent OS should ship with `Costder/strategy-skill` as the day-one planning brain for larger goals, especially Shopkeeper Mode and Founder Mode.

Strategy is the route planner:

- clarifies the true outcome
- selects the best vehicle
- checks math and constraints
- registers assumptions
- defines kill and pivot rules
- creates milestones and tasks
- dispatches subagent work
- updates metrics
- reroutes when reality invalidates assumptions

HBF remains the execution body. OpenTrust remains the trust, permission, identity, payment, and audit layer.

Recommended packaging:

- Vendor or pin the Strategy Skill content into the OpenTrust repo for stable behavior.
- Store strategy runtime state locally under the HBF data directory, not in browser localStorage.
- Treat strategy records as local Agent OS data that may later be selectively synced.

## Autonomy Modes

Public names:

| Tier | Name | User Meaning |
|---|---|---|
| 1 | Manager Mode | Careful, approval-heavy, safest |
| 2 | Operator Mode | Hands-on execution with approvals for risky actions |
| 3 | Shopkeeper Mode | Hands-off daily operations within budgets and policies |
| 4 | Founder Mode | Mission-level continuous autonomy |

### Manager Mode

Best for first-time users and sensitive work.

Default behavior:

- Agent may plan, research, summarize, draft, and recommend.
- User approves external messages, payments, public actions, account changes, deploys, Docker, card use, and irreversible file changes.
- No always-on background loops unless explicitly enabled.
- No subagent spawning without approval.

### Operator Mode

Best for users who want help doing routine work while staying actively involved.

Default behavior:

- Agent may do routine local work and reversible prep.
- Agent may create drafts, branches, local files, pull requests for review, and provider test calls.
- User approves money movement, card use, outbound external communication, public posts, deploys, account changes, deleting data, and high-risk tool calls.
- Scheduled/background tasks require explicit confirmation.

### Shopkeeper Mode

Best for daily business operations.

Default behavior:

- Agent may run day-to-day tasks within approved budgets and policies.
- Agent may send approved categories of email/SMS, respond to leads/customers, manage tickets, open pull requests, run scheduled tasks, and use approved provider credentials.
- Approval is required for exceptions: unusual spend, new vendors, new public channels, new credential scopes, new accounts, legal/financial commitments, or trust-level violations.
- Strategy Skill runs periodic reviews and reroutes based on metrics and assumptions.

### Founder Mode

Best for broad long-running goals where the user wants maximum autonomy.

Default behavior:

- User gives a broad mission, budget, owner constraints, and forbidden zones.
- Agent may run continuously until manually stopped.
- Agent may choose subgoals, spawn subagents, select harnesses, use configured tools, contact people, buy services, run experiments, and reallocate budget inside preauthorized boundaries.
- No routine approval prompts.
- The system still preserves non-negotiable owner controls: global kill switch, audit log, local visibility, budget ceiling, legal/safety forbidden actions, credential revocation, and "never hide actions from owner."

Product copy should avoid saying "bypass mode" even if founder users understand the meme. The user-facing promise is continuous mission-level autonomy, not invisible or unaccountable behavior.

## Permission Matrix

| Capability Class | Manager | Operator | Shopkeeper | Founder |
|---|---|---|---|---|
| Read local public/project files | Allowed | Allowed | Allowed | Allowed |
| Web research | Allowed | Allowed | Allowed | Allowed |
| Draft private files | Approval for sensitive paths | Allowed | Allowed | Allowed |
| Edit project files | Approval | Allowed for configured workspaces | Allowed | Allowed |
| Run tests/builds | Approval | Allowed | Allowed | Allowed |
| Docker/container actions | Approval | Approval | Allowed if preapproved | Allowed |
| Send email/SMS | Approval | Approval | Allowed for approved categories | Allowed within policy |
| Public posts/submissions | Approval | Approval | Approval unless preapproved | Allowed within policy |
| Spend money | Approval | Approval | Allowed within caps | Allowed within mission budget |
| Virtual cards | Approval | Approval | Allowed if preapproved | Allowed within mission budget |
| Wallet signing/payments | Approval | Approval | Allowed within caps | Allowed within mission budget |
| Create accounts/vendors | Approval | Approval | Approval | Allowed unless forbidden |
| Spawn subagents | Approval | Approval | Allowed for approved roles | Allowed |
| Always-on operation | Off | Optional explicit | On for active missions | On until stopped |
| Strategy reroute | Suggest only | Suggest or request approval | Allowed within goal | Allowed |

All tiers keep emergency stop, audit logging, and credential revocation.

## User Experience

### First Run

The first screen asks:

> What do you want done?

Examples shown as templates:

- Find leads, email the best ones, and track replies.
- Set up a GitHub repo and make the first landing page PR.
- Research MCP servers for this workflow and connect safe ones.
- Watch this inbox and respond to qualified leads.
- Help me build and grow a payment company.

The app should not open with a wall of env vars.

### Mission Creation Flow

1. User enters objective.
2. Agent OS classifies the objective:
   - simple task: direct execution
   - big/risky/long-running: Strategy Skill first
3. User chooses autonomy mode.
4. User chooses harness or accepts recommendation.
5. Agent OS checks missing capabilities.
6. Missing capability setup appears inline.
7. Mission starts.
8. Timeline becomes the main view.

### Mission Dashboard

Primary panels:

- Timeline
- Active agents
- Current task
- Pending approvals
- Spend and budget
- Token usage
- Capability status
- Strategy assumptions and exit rules
- Safety controls

Global controls:

- Pause All
- Stop Mission
- Disable Payments
- Disable Public Actions
- Downgrade Autonomy
- Rotate/Revoke Credentials

### Capabilities Page

Users can configure capabilities anytime.

Capabilities:

- Email: AgentMail, Postmark, Resend, local SMTP
- Phone/SMS: Twilio, SignalWire, JMP/XMPP
- GitHub
- Wallets/payments
- Virtual cards
- Docker
- Tunnels/webhooks
- IPFS
- Physical mail

Each capability card shows:

- readiness
- provider
- risk class
- last test result
- configure/change provider
- test button
- delete/disable

### Env Import

The control panel supports:

- upload `.env` or `.txt`
- paste env text
- guided forms

Rules:

- parse locally
- redact values by default
- show detected providers before saving
- validate before marking ready
- never log secret values

### Loading And Empty States

Allowed internal promotion:

- Post a job on OpenTrust Marketplace.
- Browse trusted tools.
- List your MCP server.
- Get a passport for this tool.
- Review a tool you used.
- Find safer alternatives in the registry.

Rules:

- Suggestions are contextual.
- Suggestions are dismissible.
- Hosted cloud is mentioned only during initial setup and only once by default.
- Cloud is mentioned later only when the user asks, tries to share/team-sync, or uses a cloud-only feature.

## Local Architecture

```text
Browser UI
  -> Local Agent OS API
    -> Mission Store
    -> Strategy Store
    -> Event Log
    -> Harness Registry
    -> Capability Registry
    -> Permission Profiles
    -> HBF Runtime
      -> MCP tools
      -> secrets
      -> spend caps
      -> kill switch
      -> tool dispatch
```

The UI should be served by HBF local HTTP mode. The Agent OS API should be local-only by default and bind to loopback unless explicitly configured otherwise.

Recommended file/module layout:

```text
packages/hands-body-and-feet/src/control-panel/
  api/
  ui/
  stores/
  harnesses/
  strategy/
  permissions/
  telemetry/
  providers/
```

If the UI grows too large, move it to a separate workspace package later. For v1, co-locating it with HBF reduces setup friction.

## Data Model

### Mission

```json
{
  "mission_id": "string",
  "title": "string",
  "objective": "string",
  "mode": "manager | operator | shopkeeper | founder",
  "status": "draft | starting | running | waiting_approval | blocked | done | failed | stopped",
  "strategy_goal_id": "string",
  "budget": {
    "total_cap": 0,
    "daily_cap": 0,
    "currency": "USD"
  },
  "forbidden_actions": ["string"],
  "active_agent_ids": ["string"],
  "created_at": "ISO date",
  "updated_at": "ISO date"
}
```

### Agent Instance

```json
{
  "agent_id": "string",
  "mission_id": "string",
  "harness": "hermes | openclaw | codex | claude",
  "model": "string | unknown",
  "status": "available | starting | running | idle | blocked | failed | stopped",
  "current_task_id": "string | null",
  "process_id": "number | null",
  "session_ref": "string | null",
  "telemetry_quality": "exact | parsed | estimated | unavailable"
}
```

### Capability

```json
{
  "capability_id": "email",
  "provider": "agentmail",
  "status": "ready | missing_config | failed_test | disabled",
  "risk_class": "local | external_message | money | infrastructure | public_action",
  "last_test_at": "ISO date | null",
  "last_error": "string | null"
}
```

### Event

```json
{
  "event_id": "string",
  "mission_id": "string",
  "agent_id": "string | null",
  "type": "mission | strategy | task | tool_call | approval | spend | token_usage | capability | harness | error",
  "severity": "info | warning | critical",
  "summary": "string",
  "data": {},
  "created_at": "ISO date"
}
```

The event log is append-only. Corrections are new events, not mutation.

### Permission Profile

```json
{
  "mode": "manager",
  "requires_approval": ["send_external_message", "spend_money"],
  "allowed_without_approval": ["research_web", "draft_private_file"],
  "spend_caps": {
    "per_call": 0,
    "daily": 0,
    "mission_total": 0
  },
  "always_on": false,
  "subagents_allowed": false
}
```

## Token And Cost Tracking

Token tracking is best effort:

1. Exact: harness provides token/cost metadata.
2. Parsed: logs expose usable token/cost lines.
3. Estimated: Agent OS estimates from prompt/response text length.
4. Unavailable: harness does not expose enough data.

The UI must label the quality clearly. Do not pretend estimates are exact.

## Security Model

### Local-Only Defaults

- Bind control panel to `127.0.0.1`.
- Do not expose setup routes publicly.
- Require local session token or browser-bound setup secret for write operations.
- Store secrets server-side, not in browser storage.
- Redact secrets after entry.
- Never log raw secrets.
- Make delete/rotate controls visible.

### Secret Storage

V1 can use HBF's existing local configuration patterns with a wrapper that isolates provider secrets from UI state. If available, use OS keychain APIs later.

Provider setup should save only after validation or explicit "save without test."

### Kill Switch

The kill switch must be global and visible in every mission view.

Founder Mode still honors:

- pause all
- stop mission
- disable payments
- disable public actions
- revoke credentials

### Risk Classes

Tool and capability risk classes:

- Local/private
- External message
- Public action
- Money movement
- Infrastructure
- Irreversible/destructive

Autonomy mode maps directly to allowed risk classes.

## Cloud Boundary

No OpenTrust account is required for local v1.

Optional connect later:

- Marketplace sync
- Passport creation/claiming
- Job posting
- Reviews/reputation
- Hosted gateway
- Team/business controls
- Cloud backup

Sync must be explicit and explain what leaves the machine. The local control panel should support offline use indefinitely.

## Implementation Phases

### Phase 1: Local Shell

- Serve `/control` and `/setup` from HBF HTTP mode.
- Add local Agent OS API skeleton.
- Add mission store, event log, capability registry, permission profiles.
- Add static UI with first-run flow, capabilities page, mission dashboard, and safety controls.

### Phase 2: Provider Setup

- Add `.env`/text import.
- Add guided forms for AgentMail, Twilio, SignalWire, JMP, GitHub, Moon, IPFS, PostScan/Earth Class Mail.
- Add provider test endpoints.
- Add local redaction and validation.

### Phase 3: Harness Adapters

- Add detection and launch for Hermes Agent, OpenClaw, Codex, Claude.
- Add adapter status and telemetry quality.
- Add mission dispatch to selected harness.
- Add event capture for launch, stop, task sent, task result, and errors.

### Phase 4: Strategy Skill

- Vendor/pin Strategy Skill.
- Add strategy store.
- Add big-goal classification.
- Generate strategy goal records, assumptions, milestones, tasks, exit rules, and work packets.
- Link strategy events into mission timeline.

### Phase 5: Permissions And Approvals

- Enforce Manager, Operator, Shopkeeper, Founder profiles.
- Add approval queue and policy checks before HBF tool execution.
- Add budget and risk-class checks.
- Add mode downgrade/upgrade with explicit confirmation.

### Phase 6: Token/Cost Telemetry

- Add telemetry adapters per harness.
- Add exact/parsed/estimated/unavailable labels.
- Add mission-level token and cost summary.

### Phase 7: OpenTrust Optional Sync

- Add one-time cloud explanation during setup.
- Add connect flow.
- Add marketplace/passport/job/review sync actions.
- Keep cloud disabled unless user opts in.

## Testing Plan

### Unit Tests

- Permission profile decisions per mode.
- Env parser redaction and provider detection.
- Provider config validation.
- Event append-only behavior.
- Strategy store read/write.
- Harness adapter contract tests with mocks.

### Integration Tests

- Create mission -> classify -> create strategy record -> dispatch harness task.
- Missing provider -> inline setup -> provider test -> capability ready.
- Tool call -> permission check -> approval required/allowed -> event logged.
- Kill switch blocks tool execution in all modes.
- Founder Mode continues without routine approval but still respects hard blocks.

### UI Tests

- First-run mission creation.
- Capability setup from mission flow and from Capabilities page.
- Approval queue.
- Timeline event rendering.
- Loading/empty state suggestions are contextual and dismissible.

### Security Tests

- Setup write routes reject missing local session token.
- Secrets are not returned by API responses.
- Secrets are not written to event logs.
- Control panel binds to loopback by default.
- Cloud sync does not run unless explicitly enabled.

## Non-Goals For V1

- Full hosted cloud team product.
- Organization role-based access control.
- Perfect token accounting for every harness.
- Public remote access to the local control panel.
- Replacing all harnesses with an OpenTrust-built agent runner.
- Fully autonomous legal, medical, or regulated financial commitments.

## Open Questions For Implementation Planning

1. How should the local setup session token be generated and persisted?
2. Which Hermes and OpenClaw launch/status interfaces are available locally on Windows?
3. Should UI assets be plain static HTML/TS first, or a small bundled app inside HBF?
4. Should provider secrets move to OS keychain in v1 or after the local store wrapper exists?
5. How much Strategy Skill state should be visible in the casual UI by default?

## References

- Strategy Skill repository: https://github.com/Costder/strategy-skill
- Strategy Skill source: https://raw.githubusercontent.com/Costder/strategy-skill/main/SKILL.md

## Approved Decisions From Brainstorming

- Build Agent OS, not just setup dashboard.
- V1 target is solo casual users.
- B/C developer and business use cases move primarily to hosted cloud later.
- Local works fully without login.
- Optional OpenTrust login comes later for marketplace sync, passports, jobs, reviews, reputation, and hosted cloud.
- Day-one harnesses include OpenClaw and Hermes Agent.
- Use autonomy names: Manager, Operator, Shopkeeper, Founder.
- Founder Mode is a core meme/name and should stay.
- Strategy Skill ships day one for hands-off and founder-style missions.
- Loading states may promote OpenTrust registry, jobs, passports, reviews, marketplace, and tool listings.
- Cloud should not be repeatedly advertised inside local Agent OS.
