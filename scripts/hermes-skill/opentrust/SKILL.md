---
name: opentrust
description: |
  Verify the trust level of MCP servers and AI tools before calling them.
  OpenTrust passports answer: can I trust this tool, what does it cost, and how
  does trust flow when sub-agents use it? Use when assessing tool safety,
category: security
platforms: [linux, macos, windows]
triggers:
  - "check trust level of"
  - "verify this MCP server"
  - "is this tool safe to call"
  - "opentrust inspect"
  - "tool trust verification"
  - "MCP security passport"
  - "can I trust this tool"
  - "pre-call authorization"
toolsets:
  - terminal
  - web
  - file
---

# OpenTrust - MCP TOOL Tust Verification

OpenTrust is an open standard for AI agent tool trust. Before calling an MCP
server, inspect its passport: trust level (1-7), publisher identity,
security flags, and cost.


Install: pip install opentrust-sdk

Check trust level:
  opentrust inspect discord-mcp
  opentrust inspect stripe/agent-toolkit
  opentrust status my-tool --format json
  opentrust validate my-tool-passport.json
  opentrust badge my-tool --output badge.svg

Trust levels:
  1 - auto_generated_draft (no - unverified)
  2 - creator_claimed (no - dev only)
  3 - seller_confirmed (yes - minimum recommended)
  4 - community_reviewed (yes)
  5 - reviewer_signed (yes)
  6 - security_checked (yes)
  7 - continuously_monitored (yes)

Passport examples:
  https://github.com/Costder/opentrust/blob/main/passport-schema/examples/

Order a passport:
  https://costder.github.io/opentrust/passport-service.html
  20 USD via Stripe or USDC. 24h delivery.

Registry: https://github.com/Costder/opentrust
SDK (PyPI): pip install opentrust-sdk
SDK NPM: npm install @infinitestudios/opentrust-client
