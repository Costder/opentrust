# Local Agent OS Control Panel Design

Date: 2026-06-14
Status: design approved for planning

## Summary

OpenTrust should ship a local-first Agent OS control panel inside Hands Body and Feet (HBF). HBF is an npm package and MCP server, not an agent harness. It gives agents real-world tools, and it gives humans a local control panel for configuring those tools, supervising agents, and managing credentials safely.

The first target user is a solo casual user who wants to give an AI a real-world objective and supervise the result without learning MCP, env files, or agent orchestration.

The product promise is:

> Tell an agent what real-world outcome you want. OpenTrust helps the agent use real-world tools through HBF, while the human sees setup, approvals, accounts, spend, activity, and safety controls in one local panel.

This is not only a setup dashboard. It is a local mission control layer for agent work. Configuration remains available anytime, but the primary flow starts with the user's objective.

The local version is fully usable without an OpenTrust login. OpenTrust account connection comes later for marketplace sync, passports, jobs, reviews, reputation, hosted gateway, and cloud/team governance.

## Correct Product Boundary

HBF is distributed as `@infinitestudios/hands-body-and-feet` on npm and runs as an MCP server. Users should not need a separate Agent OS install.

User-facing install/run path:

```bash
npx -y @infinitestudios/hands-body-and-feet serve
```

Local surfaces served by the HBF process:

- MCP endpoint: `http://localhost:3847/mcp`
- Control panel: `http://localhost:3847/control`
- Setup UI: `http://localhost:3847/setup`
- Local Agent OS API: `http://localhost:3847/api/local/*`

OpenTrust does not become an agent harness. Harnesses such as Hermes Agent, OpenClaw, Codex, Claude Code, Claude Desktop, and Cursor remain the agent runtimes. HBF is the tool/body layer those agents can call, plus the local human control surface for managing real-world access.

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

## Agent Harness Integrations

The local control panel should integrate with harnesses, but must not pretend to replace them. Day-one integrations:

- Hermes Agent
- OpenClaw
- Codex
- Claude Desktop / Claude Code

Later integrations:

- Cursor
- ChatGPT desktop or app integrations if practical
- Custom MCP runners
- Hosted OpenTrust cloud agents

Each harness integration exposes the same minimal local interface:

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

HBF's responsibility is to:

- expose MCP tools
- configure local credentials
- enforce HBF/OpenTrust permissions
- write local events
- show the human what agents are doing
- provide launch/deep-link/helpful handoff where a harness supports it

The harness's responsibility is to:

- run the agent loop
- choose model/provider
- reason over tasks
- call MCP tools
- return work output

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
- Agent accounts and distribution channels

Each capability card shows:

- readiness
- provider
- risk class
- last test result
- configure/change provider
- test button
- delete/disable

### Agent Accounts And Distribution Page

Marketing and distribution are core real-world agent workflows. Many users will bring their own custom setup, but casual users need a standard path that hides developer tooling.

Add an `Agent Accounts` or `Distribution` page for accounts the agent may use:

- Google: Gmail, Calendar, Drive, YouTube where supported
- GitHub
- LinkedIn
- Apple account/sign-in where supported
- X/Twitter if supported later
- Reddit, Discord, Slack, Telegram, WhatsApp, Signal, Matrix where supported by installed providers
- Custom email/password account
- Custom website login

The page should separate:

1. **Human owner account** - the user's personal account used to authorize access.
2. **Agent social account** - a dedicated account the agent may operate, such as `sales@company.com` or a LinkedIn profile/page the owner controls.
3. **Channel policy** - what the agent may do on that account.

The UX should prefer OAuth when possible:

- "Connect Google"
- "Connect GitHub"
- "Connect LinkedIn"
- "Connect Apple"

For users unfamiliar with developer tools, OAuth is the standard path. They should not need to create developer apps, copy callback URLs, or paste tokens unless the provider requires it.

When OAuth is unavailable or not enough, support manual account records:

- login URL
- username/email
- password reference
- 2FA method
- recovery notes
- allowed actions
- human approval requirements

Manual login records must be treated as high-risk secrets, not ordinary config.

### Channel Policy

Each connected account gets a policy:

```json
{
  "account_id": "string",
  "provider": "google | github | linkedin | apple | custom",
  "account_type": "owner | agent | business_page | inbox | custom",
  "allowed_actions": ["read", "draft", "send", "reply", "post", "delete"],
  "requires_approval": ["send", "post", "delete"],
  "daily_action_cap": 25,
  "daily_spend_cap": 0,
  "mode_floor": "operator",
  "mode_ceiling": "founder"
}
```

Examples:

- Gmail in Manager Mode: read and draft only; approval before send.
- Gmail in Shopkeeper Mode: send replies for approved lead/customer categories.
- LinkedIn in Operator Mode: draft posts and messages; approval before publish/send.
- LinkedIn in Founder Mode: can run approved distribution experiments inside daily action caps.
- GitHub in Shopkeeper Mode: create branches and PRs; approval before risky repo setting changes.

### Distribution Workflows

Standard workflows for casual users:

- Find leads and draft outreach.
- Send approved outreach from a connected inbox.
- Track replies and classify leads.
- Draft social posts from mission progress.
- Publish approved posts.
- Create marketplace/job posts on OpenTrust.
- List MCP servers or tools in the registry.
- Request or update passports.
- Ask for reviews after successful tool/job interactions.

These workflows should appear as templates in mission creation and loading states.

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

### Agent Account

```json
{
  "account_id": "string",
  "provider": "google | github | linkedin | apple | custom",
  "display_name": "string",
  "account_type": "owner | agent | business_page | inbox | custom",
  "auth_type": "oauth | api_key | password | browser_session | manual",
  "secret_ref": "secret://local/account_id",
  "scopes": ["string"],
  "requires_2fa": true,
  "two_factor_policy": "ask_human | totp_seed_opt_in | passkey_external | not_supported",
  "status": "ready | needs_reauth | missing_2fa | disabled | revoked",
  "channel_policy_id": "string",
  "created_at": "ISO date",
  "updated_at": "ISO date"
}
```

The account record stores metadata and a secret reference only. Raw tokens, passwords, cookies, wallet keys, and TOTP seeds must not be returned by the local API.

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

### Agent Credential Vault

Agent social logins and distribution accounts need stronger handling than basic env vars. The goal is that compromise of an HBF server, browser UI, or cloud service should not automatically give an attacker enough material to log into social accounts, drain wallets, or move bank/card money.

Principles:

- Prefer OAuth over passwords.
- Prefer provider-scoped tokens over broad account access.
- Prefer short-lived access tokens with refresh tokens stored in the vault.
- Prefer dedicated agent/business accounts over the user's primary personal accounts.
- Never sync raw local secrets to OpenTrust cloud without explicit user action.
- Do not store secrets in browser localStorage.
- Do not write secrets into logs, events, strategy state, or exported bundles.

Local storage requirements:

- Encrypt every secret at rest.
- Use OS-backed protection where possible: Windows DPAPI/Credential Manager, macOS Keychain, Linux Secret Service/libsecret.
- Use envelope encryption for portable local vault files: a vault data key encrypts records; the data key is protected by the OS keychain or a user passphrase.
- Store OAuth access tokens, refresh tokens, API keys, passwords, cookies, TOTP seeds, and wallet keys under separate secret references.
- Support per-provider revocation and deletion.
- Support "lock vault" and "unlock vault" states for sensitive actions.

Two-factor and passkey handling:

- Default policy is `ask_human` for 2FA.
- TOTP seed storage is opt-in, labeled high risk, and encrypted separately.
- Passkeys/WebAuthn should remain outside HBF when possible; HBF should request human approval or browser interaction instead of exporting passkey secrets.
- Backup codes should not be stored by default.

Wallet and money handling:

- Wallet private keys are never treated like ordinary account secrets.
- Payment/card/bank-capable credentials require separate risk class, spend caps, and emergency disable controls.
- Founder Mode can use money only inside explicit mission budgets and provider limits.
- Bank account credentials should be avoided in local v1 unless a provider offers safe OAuth/limited-scope access.

Hosted/cloud safety requirements for later:

- Hosted OpenTrust must not use the same trust assumptions as local HBF.
- Use tenant-isolated vaults, KMS/HSM-backed envelope encryption, short-lived worker leases, scoped tokens, and audit logs.
- Keep wallet signing local or hardware-backed when possible.
- For highly sensitive providers, use bring-your-own-vault or local connector patterns instead of storing secrets in OpenTrust cloud.
- If a hosted HBF worker is compromised, the attacker should see only short-lived scoped credentials for the current authorized action, not reusable master credentials.

Compromise response:

- One-click revoke all connected accounts.
- One-click disable payments/cards/wallet signing.
- Show provider revocation links.
- Rotate local vault key.
- Export audit timeline for incident review without secrets.

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
- Add Agent Accounts / Distribution page.
- Add standard OAuth-first account connection flows for Google, GitHub, LinkedIn, Apple, and future providers where possible.
- Add manual high-risk account records for providers without OAuth.
- Add channel policy controls for read, draft, send, reply, post, delete, spend, and approval behavior.
- Add local credential-vault abstraction with secret references instead of raw values in API responses.

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
- Agent account metadata never returns raw secret values.
- Channel policy decisions for read/draft/send/post/delete by mode.
- Vault record encryption/decryption and secret reference lookup.
- Event append-only behavior.
- Strategy store read/write.
- Harness adapter contract tests with mocks.

### Integration Tests

- Create mission -> classify -> create strategy record -> dispatch harness task.
- Missing provider -> inline setup -> provider test -> capability ready.
- Connect OAuth provider -> create agent account -> apply channel policy -> event logged.
- Manual login record -> save encrypted secret refs -> 2FA policy required for use.
- Tool call -> permission check -> approval required/allowed -> event logged.
- Kill switch blocks tool execution in all modes.
- Founder Mode continues without routine approval but still respects hard blocks.

### UI Tests

- First-run mission creation.
- Capability setup from mission flow and from Capabilities page.
- Agent Accounts page for OAuth and manual account setup.
- Distribution workflow templates.
- Approval queue.
- Timeline event rendering.
- Loading/empty state suggestions are contextual and dismissible.

### Security Tests

- Setup write routes reject missing local session token.
- Secrets are not returned by API responses.
- Secrets are not written to event logs.
- OAuth tokens, passwords, cookies, TOTP seeds, and wallet keys are stored only behind secret references.
- Exported bundles redact or omit secrets by default.
- Compromise-response controls disable accounts, payments, cards, and wallet signing.
- Control panel binds to loopback by default.
- Cloud sync does not run unless explicitly enabled.

## Non-Goals For V1

- Full hosted cloud team product.
- Organization role-based access control.
- Perfect token accounting for every harness.
- Public remote access to the local control panel.
- Replacing all harnesses with an OpenTrust-built agent runner.
- Becoming a social network management SaaS in local v1.
- Storing unrestricted banking credentials.
- Fully autonomous legal, medical, or regulated financial commitments.

## Open Questions For Implementation Planning

1. How should the local setup session token be generated and persisted?
2. Which Hermes and OpenClaw launch/status interfaces are available locally on Windows?
3. Should UI assets be plain static HTML/TS first, or a small bundled app inside HBF?
4. Should provider secrets move to OS keychain in v1 or after the local store wrapper exists?
5. How much Strategy Skill state should be visible in the casual UI by default?
6. Which providers can support first-party OAuth without users creating developer apps?
7. Should TOTP seed storage be allowed at all in v1, or should 2FA always require human interaction?
8. Which social providers should be treated as distribution templates on day one versus later?

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
- HBF is not the harness; it is the npm MCP server/tool layer plus local control panel.
- Use autonomy names: Manager, Operator, Shopkeeper, Founder.
- Founder Mode is a core meme/name and should stay.
- Strategy Skill ships day one for hands-off and founder-style missions.
- Add agent social login/account management for distribution workflows.
- Prefer OAuth for Google, GitHub, LinkedIn, Apple, and future social/account providers.
- Store account credentials locally through a compromise-aware vault model.
- Loading states may promote OpenTrust registry, jobs, passports, reviews, marketplace, and tool listings.
- Cloud should not be repeatedly advertised inside local Agent OS.
