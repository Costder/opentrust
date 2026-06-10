// packages/hands-body-and-feet/src/catalog.ts
// Shared tool catalog imported by server.ts (for ListTools) and the help capability.
// Kept separate to avoid circular imports.
import type { ToolDefinition, SpendPolicy } from './types.js';

export interface CatalogEntry extends ToolDefinition {
  description: string;
  domain: string;
  spendPolicy?: SpendPolicy;
}

export const CATALOG: CatalogEntry[] = [
  // notify
  { domain: 'notify',      name: 'notify_human',            minTrustLevel: 2, description: 'Send a push notification to the human operator via ntfy.sh.' },

  // wallet
  { domain: 'wallet',      name: 'create_wallet',           minTrustLevel: 2, description: 'Generate a new EVM wallet (Base or Polygon) and store it encrypted.' },
  { domain: 'wallet',      name: 'get_address',             minTrustLevel: 2, description: 'Return the public address for a stored wallet.' },
  { domain: 'wallet',      name: 'get_balance',             minTrustLevel: 2, description: 'Return native token (ETH/MATIC) and USDC balance for a wallet.' },
  { domain: 'wallet',      name: 'send_usdc',               minTrustLevel: 2, description: 'Transfer USDC on Base or Polygon (subject to spend caps).', spendPolicy: { maxPerCallUsdc: 100 } },
  { domain: 'wallet',      name: 'sign_message',            minTrustLevel: 2, description: 'Sign a plain text message with the wallet private key.' },
  { domain: 'wallet',      name: 'sign_typed_data',         minTrustLevel: 2, description: 'Sign EIP-712 typed data (first-use of any new domain is rejected).' },

  // bridge
  { domain: 'bridge',      name: 'bridge_to_polygon',       minTrustLevel: 2, description: 'Initiate a USDC bridge from Base to Polygon via Across Protocol.' },
  { domain: 'bridge',      name: 'bridge_to_base',          minTrustLevel: 2, description: 'Initiate a USDC bridge from Polygon to Base via Across Protocol.' },
  { domain: 'bridge',      name: 'get_bridge_status',       minTrustLevel: 2, description: 'Return status of a bridge operation (pending/locked/in-flight/minted/stuck/failed).' },

  // payments
  { domain: 'payments',    name: 'pay_with_usdc',           minTrustLevel: 2, description: 'Execute a USDC payment on Base (OpenTrust payments are always on Base).', spendPolicy: { maxPerCallUsdc: 100 } },
  { domain: 'payments',    name: 'get_payment_status',      minTrustLevel: 2, description: 'Return confirmation status of a Base transaction by hash.' },
  { domain: 'payments',    name: 'prepare_payment',         minTrustLevel: 2, description: 'Check balance, bridge from Polygon if needed, then execute a USDC payment in one step.', spendPolicy: { maxPerCallUsdc: 100 } },

  // cards
  { domain: 'cards',       name: 'create_virtual_card',     minTrustLevel: 4, description: 'Issue a Moon X or Moon 1X virtual Visa card.' },
  { domain: 'cards',       name: 'get_card_details',        minTrustLevel: 2, description: 'Return card number, CVV, and expiry for a Moon virtual card.' },
  { domain: 'cards',       name: 'add_funds_to_card',       minTrustLevel: 4, description: 'Load USD funds from Moon Credit balance onto a Moon X card.' },
  { domain: 'cards',       name: 'top_up_moon_credit',      minTrustLevel: 4, description: 'Return Moon\'s USDC-Polygon deposit address to top up Moon Credit.' },
  { domain: 'cards',       name: 'freeze_card',             minTrustLevel: 2, description: 'Freeze a Moon virtual card, blocking new transactions.' },
  { domain: 'cards',       name: 'delete_card',             minTrustLevel: 2, description: 'Permanently delete a Moon virtual card.' },
  { domain: 'cards',       name: 'get_card_transactions',   minTrustLevel: 2, description: 'Return transaction history for a Moon virtual card.' },

  // phone
  { domain: 'phone',       name: 'provision_phone_number',  minTrustLevel: 3, description: 'Provision a phone number via Twilio or SignalWire.' },
  { domain: 'phone',       name: 'send_sms',                minTrustLevel: 3, description: 'Send an SMS from a provisioned number.' },
  { domain: 'phone',       name: 'read_sms',                minTrustLevel: 2, description: 'Fetch inbound SMS messages for a provisioned number.' },
  { domain: 'phone',       name: 'release_phone_number',    minTrustLevel: 3, description: 'Release a provisioned phone number back to the provider.' },

  // phone-jmp
  { domain: 'phone-jmp',   name: 'provision_phone_number_jmp', minTrustLevel: 3, description: 'Provision a phone number via JMP XMPP (no KYC).' },
  { domain: 'phone-jmp',   name: 'send_sms_jmp',            minTrustLevel: 3, description: 'Send an SMS via JMP XMPP.' },
  { domain: 'phone-jmp',   name: 'read_sms_jmp',            minTrustLevel: 2, description: 'Return inbound SMS messages buffered from JMP XMPP.' },
  { domain: 'phone-jmp',   name: 'release_phone_number_jmp', minTrustLevel: 3, description: 'Release a JMP phone number.' },

  // email
  { domain: 'email',       name: 'create_mailbox',          minTrustLevel: 2, description: 'Create a new mailbox for receiving email.' },
  { domain: 'email',       name: 'send_email',              minTrustLevel: 2, description: 'Send an email via the configured transport (local, Postmark, Resend, or AgentMail).' },
  { domain: 'email',       name: 'read_inbox',              minTrustLevel: 2, description: 'Return messages in a mailbox.' },
  { domain: 'email',       name: 'wait_for_email',          minTrustLevel: 2, description: 'Long-poll until a matching email arrives or timeout elapses.' },
  { domain: 'email',       name: 'delete_mailbox',          minTrustLevel: 3, description: 'Delete a mailbox and all its messages (CASCADE).' },

  // tunnel
  { domain: 'tunnel',      name: 'create_tunnel',           minTrustLevel: 3, description: 'Create a public tunnel (cloudflared or ngrok) for a local port.' },
  { domain: 'tunnel',      name: 'get_tunnel_url',          minTrustLevel: 2, description: 'Return the public URL for an active tunnel.' },
  { domain: 'tunnel',      name: 'close_tunnel',            minTrustLevel: 3, description: 'Close an active tunnel.' },

  // webhook
  { domain: 'webhook',     name: 'create_webhook',          minTrustLevel: 3, description: 'Create a webhook endpoint for receiving POST callbacks.' },
  { domain: 'webhook',     name: 'get_webhook_url',         minTrustLevel: 2, description: 'Return the public URL for a webhook (requires active tunnel).' },
  { domain: 'webhook',     name: 'read_webhook_events',     minTrustLevel: 2, description: 'Return received webhook events.' },
  { domain: 'webhook',     name: 'wait_for_webhook',        minTrustLevel: 2, description: 'Long-poll until a webhook event matching the filter arrives.' },
  { domain: 'webhook',     name: 'delete_webhook',          minTrustLevel: 3, description: 'Delete a webhook and all its events.' },

  // tasks
  { domain: 'tasks',       name: 'create_task',             minTrustLevel: 3, description: 'Create a scheduled task using a cron expression.' },
  { domain: 'tasks',       name: 'list_tasks',              minTrustLevel: 2, description: 'List all scheduled tasks.' },
  { domain: 'tasks',       name: 'delete_task',             minTrustLevel: 3, description: 'Delete a scheduled task.' },
  { domain: 'tasks',       name: 'pause_task',              minTrustLevel: 3, description: 'Pause a scheduled task without deleting it.' },

  // docker
  { domain: 'docker',      name: 'run_container',           minTrustLevel: 4, description: 'Run a Docker container.' },
  { domain: 'docker',      name: 'stop_container',          minTrustLevel: 4, description: 'Stop a running container.' },
  { domain: 'docker',      name: 'remove_container',        minTrustLevel: 4, description: 'Remove a container.' },
  { domain: 'docker',      name: 'list_containers',         minTrustLevel: 2, description: 'List Docker containers.' },
  { domain: 'docker',      name: 'container_logs',          minTrustLevel: 2, description: 'Return container stdout/stderr logs.' },
  { domain: 'docker',      name: 'exec_in_container',       minTrustLevel: 4, description: 'Execute a command inside a running container.' },

  // github
  { domain: 'github',      name: 'create_repo',             minTrustLevel: 3, description: 'Create a new GitHub repository for the authenticated user.' },
  { domain: 'github',      name: 'create_file',             minTrustLevel: 3, description: 'Create or update a file in a GitHub repository.' },
  { domain: 'github',      name: 'create_pull_request',     minTrustLevel: 3, description: 'Create a pull request in a GitHub repository.' },
  { domain: 'github',      name: 'list_repos',              minTrustLevel: 2, description: 'List repositories for the authenticated GitHub user.' },

  // ipfs
  { domain: 'ipfs',        name: 'publish_content',         minTrustLevel: 3, description: 'Publish content to IPFS via Kubo daemon (or web3.storage fallback). Returns CID.' },
  { domain: 'ipfs',        name: 'get_ipfs_content',        minTrustLevel: 2, description: 'Retrieve content from IPFS by CID.' },
  { domain: 'ipfs',        name: 'pin_content',             minTrustLevel: 3, description: 'Pin content on the local IPFS node to prevent garbage collection.' },

  // rss
  { domain: 'rss',         name: 'create_feed',             minTrustLevel: 3, description: 'Create an RSS feed served at /feeds/{label}.' },
  { domain: 'rss',         name: 'add_feed_item',           minTrustLevel: 3, description: 'Add an item to an RSS feed.' },
  { domain: 'rss',         name: 'serve_feed',              minTrustLevel: 3, description: 'Return the public URL for an RSS feed (uses active tunnel if available).' },

  // mail
  { domain: 'mail',        name: 'list_mail',               minTrustLevel: 2, description: 'List physical mail items from PostScan Mail.' },
  { domain: 'mail',        name: 'forward_mail',            minTrustLevel: 3, description: 'Forward a physical mail item to a shipping address.' },
  { domain: 'mail',        name: 'shred_mail',              minTrustLevel: 3, description: 'Shred (destroy) a physical mail item.' },
  { domain: 'mail',        name: 'scan_mail',               minTrustLevel: 3, description: 'Request a high-resolution scan of a physical mail item.' },

  // delegations
  { domain: 'delegations', name: 'create_delegation',       minTrustLevel: 3, description: 'Create a bounded delegation grant for unattended execution.' },
  { domain: 'delegations', name: 'list_delegations',        minTrustLevel: 2, description: 'List all delegations.' },
  { domain: 'delegations', name: 'revoke_delegation',       minTrustLevel: 3, description: 'Revoke an active delegation.' },

  // triggers
  { domain: 'triggers',    name: 'create_trigger',          minTrustLevel: 3, description: 'Create an event trigger (cron/webhook/email/sms/rss) that fires a tool under a delegation.' },
  { domain: 'triggers',    name: 'list_triggers',           minTrustLevel: 2, description: 'List all triggers.' },
  { domain: 'triggers',    name: 'delete_trigger',          minTrustLevel: 3, description: 'Delete a trigger.' },
  { domain: 'triggers',    name: 'pause_trigger',           minTrustLevel: 3, description: 'Pause a trigger without deleting it.' },

  // body
  { domain: 'body',        name: 'get_identity',            minTrustLevel: 2, description: 'Return the agent\'s stored identity bindings (wallet, email, phone).' },
  { domain: 'body',        name: 'set_identity_binding',    minTrustLevel: 3, description: 'Set one field of the agent\'s identity (primary_wallet, email, or phone).' },
  { domain: 'body',        name: 'get_memory',              minTrustLevel: 2, description: 'Read a durable memory value by key. Survives restarts.' },
  { domain: 'body',        name: 'set_memory',              minTrustLevel: 2, description: 'Write a durable memory value. Survives restarts.' },
  { domain: 'body',        name: 'list_memory',             minTrustLevel: 2, description: 'List all memory keys, newest first.' },
  { domain: 'body',        name: 'delete_memory',           minTrustLevel: 3, description: 'Delete a memory key.' },

  // bus
  { domain: 'bus',         name: 'bus_send',                minTrustLevel: 2, description: 'Send a message to another agent\'s queue on this HBF instance.' },
  { domain: 'bus',         name: 'bus_poll',                minTrustLevel: 2, description: 'Atomically claim and return oldest unclaimed messages addressed to agent_id.' },
  { domain: 'bus',         name: 'bus_wait',                minTrustLevel: 2, description: 'Long-poll until a message arrives for agent_id or timeout elapses.' },

  // help
  { domain: 'help',        name: 'hbf_help',                minTrustLevel: 1, description: 'Return the full tool catalog grouped by domain, with optional domain filter.' },
];

export const RECIPES = [
  'Receive a payment: create_wallet → share address → get_balance / read_webhook_events',
  'Wake another agent: bus_send → (their) bus_wait or bus_poll',
  'Heartbeat that survives machine sleep: create_trigger(source:cron) → action send_email',
];
