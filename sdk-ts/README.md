# @infinitestudios/opentrust-client

TypeScript SDK for OpenTrust — the **MCP tool passport and trust registry** for AI agents.

OpenTrust answers three questions before your agent calls a tool:
- **What can this tool actually do?** (permissions, network scope, data access)
- **What is it trusted to do?** (signed passport, community-reviewed trust level)
- **What will it cost?** (fee caps, payment constraints)

## Install

```bash
npm install @infinitestudios/opentrust-client
```

## Usage

```ts
import { OpenTrust } from '@infinitestudios/opentrust-client';

const client = new OpenTrust({ baseUrl: 'https://opentrust.sh' });

// Fetch signed passport for any MCP server
const passport = await client.getPassport('github/file-search-mcp');

// Trust level: 0-7 (use >= 3 for production)
console.log(passport.trust_level);       // 'seller_confirmed'
console.log(passport.security_flags);    // ['SIF-001: missing write guard']
console.log(passport.fee.max_usd);       // 0.05

// Enforce minimum trust before calling the tool
if (passport.trust_level_numeric >= 3) {
  await callTool(passport.tool_id);
} else {
  throw new Error('Tool not trusted for production');
}
```

## Trust Levels

| Level | Label | Meaning |
|-------|-------|---------|
| 0 | auto_generated_draft | Unverified |
| 1 | schema_valid | Passes schema check |
| 2 | creator_claimed | Owner verified via GitHub OAuth |
| 3 | seller_confirmed | Commercial use approved |
| 4 | community_reviewed | Peer-reviewed |
| 5 | reviewer_signed | Cryptographically signed |
| 6 | security_checked | Full security audit |
| 7 | continuously_monitored | Active monitoring |

Agents should only call tools at level >= 3 in production.

## MCP Passport Service

Need a passport for your MCP server?

We deliver a signed passport JSON + trust badge + registry listing within 24h.
**$20 USDC** — [order here](https://costder.github.io/opentrust/passport-service.html)

## Live Examples

- [discord-mcp](https://github.com/Costder/opentrust/blob/main/passport-schema/examples/discord-mcp-passport.json)
- [stripe/agent-toolkit](https://github.com/Costder/opentrust/blob/main/passport-schema/examples/stripe-mcp-passport.json)
- [playwright/mcp](https://github.com/Costder/opentrust/blob/main/passport-schema/examples/playwright-mcp-passport.json)

## Repository

[github.com/Costder/opentrust](https://github.com/Costder/opentrust)

## License

MIT
