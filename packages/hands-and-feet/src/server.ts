import express, { type Request, type Response, type NextFunction } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { extractBearerToken, validatePassport, AuthError } from './auth.js';
import { isPaused } from './state.js';
import { notifyHuman, NOTIFY_TOOL } from './capabilities/notify/index.js';
import {
  createWallet,
  getAddress,
  getBalance,
  sendUsdc,
  signMessage,
  signTypedData,
  WALLET_TOOLS,
} from './capabilities/wallet/index.js';
import {
  bridgeToPolygon,
  bridgeToBase,
  getBridgeStatus,
  BRIDGE_TOOLS,
} from './capabilities/bridge/index.js';
import {
  payWithUsdc,
  getPaymentStatus,
  preparePayment,
  PAYMENT_TOOLS,
} from './capabilities/payments/index.js';
import type { PreparePaymentParams, PreparePaymentReceipt } from './capabilities/payments/index.js';
import {
  createVirtualCard,
  getCardDetails,
  addFundsToCard,
  topUpMoonCredit,
  freezeCard,
  deleteCard,
  getCardTransactions,
  CARD_TOOLS,
} from './capabilities/cards/index.js';
import {
  provisionPhoneNumber,
  sendSms,
  readSms,
  releasePhoneNumber,
  PHONE_TOOLS,
} from './capabilities/phone/index.js';
import {
  createMailbox,
  sendEmail,
  readInbox,
  waitForEmail,
  deleteMailbox,
  startLocalTransportIfConfigured,
  EMAIL_TOOLS,
} from './capabilities/email/index.js';
import {
  createTunnel,
  getTunnelUrl,
  closeTunnel,
  TUNNEL_TOOLS,
} from './capabilities/tunnel/index.js';
import {
  createWebhook,
  getWebhookUrl,
  readWebhookEvents,
  waitForWebhook,
  deleteWebhook,
  webhookReceiver,
  startPurgeJob,
  WEBHOOK_TOOLS,
} from './capabilities/webhook/index.js';
import {
  createTask,
  listTasks,
  deleteTask,
  pauseTask,
  loadActiveTasks,
  TASK_TOOLS,
} from './capabilities/tasks/index.js';
import type { PermissionSnapshot } from './capabilities/tasks/revocation.js';
import {
  runContainer,
  stopContainer,
  removeContainer,
  listContainers,
  containerLogs,
  execInContainer,
  DOCKER_TOOLS,
} from './capabilities/docker/index.js';
import {
  provisionPhoneNumberJmp,
  sendSmsJmp,
  readSmsJmp,
  releasePhoneNumberJmp,
  startXmppIfConfigured,
  PHONE_JMP_TOOLS,
} from './capabilities/phone-jmp/index.js';
import {
  createRepo,
  createFile,
  createPullRequest,
  listRepos,
  GITHUB_TOOLS,
} from './capabilities/github/index.js';
import {
  publishContent,
  getIpfsContent,
  pinContent,
  IPFS_TOOLS,
} from './capabilities/ipfs/index.js';
import {
  createFeed,
  addFeedItem,
  serveFeed,
  registerRssRoutes,
  RSS_TOOLS,
} from './capabilities/rss/index.js';
import {
  listMail,
  forwardMail,
  shredMail,
  scanMail,
  MAIL_TOOLS,
} from './capabilities/mail/index.js';
import type { PassportClaims } from './types.js';

export interface ServerOptions {
  registryUrl: string;
  port?: number;
}

interface AuthedRequest extends Request {
  passport?: PassportClaims;
}

function createMcpServer(claims: PassportClaims): Server {
  const server = new Server(
    { name: 'hands-and-feet', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      // Notify
      {
        name: NOTIFY_TOOL.name,
        description: NOTIFY_TOOL.description,
        inputSchema: NOTIFY_TOOL.inputSchema,
      },
      // Wallet tools
      {
        name: WALLET_TOOLS.create_wallet.name,
        description: 'Generates a new EVM wallet (Base default, or Polygon) and stores it in the encrypted keystore.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string', description: 'Human-readable wallet label (auto-generated if omitted)' },
            chain: { type: 'string', enum: ['base', 'polygon'], description: 'Chain to use (default: base)' },
          },
        },
      },
      {
        name: WALLET_TOOLS.get_address.name,
        description: 'Returns the public address for a stored wallet.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string', description: 'Wallet label' },
          },
          required: ['label'],
        },
      },
      {
        name: WALLET_TOOLS.get_balance.name,
        description: 'Returns native token (ETH/MATIC) and USDC balance for a wallet.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string', description: 'Wallet label' },
            token: { type: 'string', enum: ['ETH', 'MATIC', 'USDC'], description: 'Token to query' },
            chain: { type: 'string', enum: ['base', 'polygon'], description: 'Chain to query' },
          },
          required: ['label'],
        },
      },
      {
        name: WALLET_TOOLS.send_usdc.name,
        description: 'Transfers USDC on Base or Polygon. Subject to per-call and daily spend caps.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            from_label: { type: 'string', description: 'Source wallet label' },
            to_address: { type: 'string', description: 'Destination address (0x-prefixed)' },
            amount: { type: 'number', description: 'Amount in USDC (e.g. 10.5 = $10.50)' },
            chain: { type: 'string', enum: ['base', 'polygon'], description: 'Chain to use (default: base)' },
          },
          required: ['from_label', 'to_address', 'amount'],
        },
      },
      {
        name: WALLET_TOOLS.sign_message.name,
        description: 'Signs a plain text message with the wallet private key.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string', description: 'Wallet label' },
            text: { type: 'string', description: 'Plain UTF-8 text to sign' },
          },
          required: ['label', 'text'],
        },
      },
      {
        name: WALLET_TOOLS.sign_typed_data.name,
        description: 'Signs EIP-712 typed data. First-use of any new domain/primaryType pair is always rejected.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string', description: 'Wallet label' },
            domain: { type: 'object', description: 'EIP-712 domain object' },
            types: { type: 'object', description: 'EIP-712 types object' },
            value: { type: 'object', description: 'EIP-712 value object' },
          },
          required: ['label', 'domain', 'types', 'value'],
        },
      },
      // Bridge tools
      {
        name: BRIDGE_TOOLS.bridge_to_polygon.name,
        description: 'Initiates a USDC bridge from Base to Polygon (Across Protocol — integration pending). Returns bridge_id for polling.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            from_label: { type: 'string', description: 'Source wallet label (Base)' },
            amount: { type: 'number', description: 'Amount in USDC to bridge' },
          },
          required: ['from_label', 'amount'],
        },
      },
      {
        name: BRIDGE_TOOLS.bridge_to_base.name,
        description: 'Initiates a USDC bridge from Polygon to Base (Across Protocol — integration pending). Returns bridge_id for polling.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            from_label: { type: 'string', description: 'Source wallet label (Polygon)' },
            amount: { type: 'number', description: 'Amount in USDC to bridge' },
          },
          required: ['from_label', 'amount'],
        },
      },
      {
        name: BRIDGE_TOOLS.get_bridge_status.name,
        description: 'Returns status of a bridge operation: pending | locked | in-flight | minted | stuck | failed.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            bridge_id: { type: 'string', description: 'Bridge ID returned by bridge_to_polygon or bridge_to_base' },
          },
          required: ['bridge_id'],
        },
      },
      // Payment tools
      {
        name: PAYMENT_TOOLS.pay_with_usdc.name,
        description: 'Executes a USDC payment on Base (OpenTrust payments are always on Base).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            from_label: { type: 'string', description: 'Source wallet label' },
            to_address: { type: 'string', description: 'Destination address (0x-prefixed)' },
            amount: { type: 'number', description: 'Amount in USDC' },
            memo: { type: 'string', description: 'Optional payment memo' },
          },
          required: ['from_label', 'to_address', 'amount'],
        },
      },
      {
        name: PAYMENT_TOOLS.get_payment_status.name,
        description: 'Returns confirmation status of a Base transaction by hash.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            tx_hash: { type: 'string', description: 'Transaction hash (0x-prefixed)' },
          },
          required: ['tx_hash'],
        },
      },
      {
        name: 'prepare_payment',
        description: 'Checks Base balance, bridges from Polygon if needed, then executes a USDC payment on Base in one step.',
        inputSchema: {
          type: 'object' as const,
          required: ['from_label', 'to_address', 'amount_usdc'],
          properties: {
            from_label: { type: 'string', description: 'Wallet label to send from' },
            to_address: { type: 'string', description: 'Recipient wallet address (0x...)' },
            amount_usdc: { type: 'number', description: 'Amount of USDC to send' },
            memo: { type: 'string', description: 'Optional payment memo' },
            bridge_if_needed: { type: 'boolean', description: 'Bridge from Polygon if balance insufficient (default true)' },
            bridge_timeout_ms: { type: 'number', description: 'Bridge polling timeout in milliseconds (default 120000)' },
            bridge_poll_interval_ms: { type: 'number', description: 'Bridge polling interval in milliseconds (default 5000)' },
          },
        },
      },
      // Card tools
      {
        name: CARD_TOOLS.create_virtual_card.name,
        description: 'Issues a Moon X (reloadable) or Moon 1X (single-fund) virtual Visa card. Requires L4 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string', description: 'Human-readable label for the card (defaults to card ID)' },
            product: { type: 'string', enum: ['moon_x', 'moon_1x'], description: 'Card product: moon_x (reloadable) or moon_1x (single-fund)' },
            amount: { type: 'number', description: 'Initial funding amount in USD (optional)' },
          },
        },
      },
      {
        name: CARD_TOOLS.get_card_details.name,
        description: 'Returns card number, CVV, and expiry for a Moon virtual card.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string', description: 'Card label or card ID' },
          },
          required: ['label'],
        },
      },
      {
        name: CARD_TOOLS.add_funds_to_card.name,
        description: 'Loads funds from Moon Credit balance onto a Moon X reloadable card. Requires L4 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string', description: 'Card label or card ID' },
            amount: { type: 'number', description: 'Amount in USD to add' },
          },
          required: ['label', 'amount'],
        },
      },
      {
        name: CARD_TOOLS.top_up_moon_credit.name,
        description: 'Returns Moon\'s USDC-Polygon deposit address so you can send USDC to top up Moon Credit. Use send_usdc with chain:"polygon" to the returned address. Requires L4 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            amount: { type: 'number', description: 'Amount in USDC to top up' },
          },
          required: ['amount'],
        },
      },
      {
        name: CARD_TOOLS.freeze_card.name,
        description: 'Freezes a Moon virtual card, blocking new transactions.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string', description: 'Card label or card ID' },
          },
          required: ['label'],
        },
      },
      {
        name: CARD_TOOLS.delete_card.name,
        description: 'Permanently deletes a Moon virtual card.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string', description: 'Card label or card ID' },
          },
          required: ['label'],
        },
      },
      {
        name: CARD_TOOLS.get_card_transactions.name,
        description: 'Returns transaction history for a Moon virtual card.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string', description: 'Card label or card ID' },
            limit: { type: 'number', description: 'Maximum number of transactions to return (default: 10)' },
          },
          required: ['label'],
        },
      },
      // Phone tools
      {
        name: PHONE_TOOLS.provision_phone_number.name,
        description: 'Provisions a phone number via the configured provider (Twilio or SignalWire). Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            area_code: { type: 'string', description: 'US area code to request (optional)' },
          },
        },
      },
      {
        name: PHONE_TOOLS.send_sms.name,
        description: 'Sends an SMS from a provisioned number. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            from_number: { type: 'string', description: 'Provisioned phone number to send from' },
            to: { type: 'string', description: 'Destination phone number (E.164 format, e.g. +12025551234)' },
            message: { type: 'string', description: 'SMS message body' },
          },
          required: ['from_number', 'to', 'message'],
        },
      },
      {
        name: PHONE_TOOLS.read_sms.name,
        description: 'Fetches inbound SMS messages for a provisioned number and upserts them to local DB. Requires L2 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            number: { type: 'string', description: 'Provisioned phone number to read messages for' },
            limit: { type: 'number', description: 'Maximum number of messages to return (default: 20)' },
          },
          required: ['number'],
        },
      },
      {
        name: PHONE_TOOLS.release_phone_number.name,
        description: 'Releases a provisioned phone number back to the provider. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            number: { type: 'string', description: 'Phone number to release' },
          },
          required: ['number'],
        },
      },
      // Email tools
      {
        name: EMAIL_TOOLS.create_mailbox.name,
        description: 'Creates a new mailbox for receiving email. Requires L2 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            address: { type: 'string', description: 'Email address for the mailbox' },
          },
          required: ['address'],
        },
      },
      {
        name: EMAIL_TOOLS.send_email.name,
        description: 'Sends an email via the configured transport (local, Postmark, or Resend). Requires L2 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            from: { type: 'string', description: 'Sender email address' },
            to: { type: 'string', description: 'Recipient email address' },
            subject: { type: 'string', description: 'Email subject' },
            body: { type: 'string', description: 'Plain-text body' },
            html: { type: 'string', description: 'Optional HTML body' },
          },
          required: ['from', 'to', 'subject', 'body'],
        },
      },
      {
        name: EMAIL_TOOLS.read_inbox.name,
        description: 'Returns messages in a mailbox. Requires L2 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            address: { type: 'string', description: 'Mailbox address' },
            limit: { type: 'number', description: 'Maximum number of messages to return (default: 20)' },
          },
          required: ['address'],
        },
      },
      {
        name: EMAIL_TOOLS.wait_for_email.name,
        description: 'Polls until a matching email arrives or timeout_ms elapses. Requires L2 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            address: { type: 'string', description: 'Mailbox address to watch' },
            filter: {
              type: 'object',
              description: 'Optional filter: subject_contains, from_contains, body_contains',
              properties: {
                subject_contains: { type: 'string' },
                from_contains: { type: 'string' },
                body_contains: { type: 'string' },
              },
            },
            timeout_ms: { type: 'number', description: 'Maximum wait time in milliseconds' },
          },
          required: ['address', 'timeout_ms'],
        },
      },
      {
        name: EMAIL_TOOLS.delete_mailbox.name,
        description: 'Deletes a mailbox and all its messages (CASCADE). Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            address: { type: 'string', description: 'Mailbox address to delete' },
          },
          required: ['address'],
        },
      },
      // Tunnel tools
      {
        name: TUNNEL_TOOLS.create_tunnel.name,
        description: 'Creates a public tunnel (cloudflared or ngrok) for a local port. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            port: { type: 'number', description: 'Local port to tunnel' },
            label: { type: 'string', description: 'Human-readable label (auto-generated if omitted)' },
            provider: { type: 'string', enum: ['cloudflared', 'ngrok'], description: 'Tunnel provider (default: cloudflared)' },
          },
          required: ['port'],
        },
      },
      {
        name: TUNNEL_TOOLS.get_tunnel_url.name,
        description: 'Returns the public URL for an active tunnel. Requires L2 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string', description: 'Tunnel label' },
          },
          required: ['label'],
        },
      },
      {
        name: TUNNEL_TOOLS.close_tunnel.name,
        description: 'Closes an active tunnel. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string', description: 'Tunnel label to close' },
          },
          required: ['label'],
        },
      },
      // Webhook tools
      {
        name: WEBHOOK_TOOLS.create_webhook.name,
        description: 'Creates a webhook endpoint for receiving POST callbacks. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string', description: 'Webhook label' },
            max_payload_bytes: { type: 'number', description: 'Max payload size in bytes (default: 1MB)' },
            retention_days: { type: 'number', description: 'Event retention in days (default: 30)' },
          },
          required: ['label'],
        },
      },
      {
        name: WEBHOOK_TOOLS.get_webhook_url.name,
        description: 'Returns the public URL for a webhook (requires active tunnel). Requires L2 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string', description: 'Webhook label' },
          },
          required: ['label'],
        },
      },
      {
        name: WEBHOOK_TOOLS.read_webhook_events.name,
        description: 'Returns received webhook events. Requires L2 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string', description: 'Webhook label' },
            since: { type: 'string', description: 'ISO timestamp to filter events after' },
            limit: { type: 'number', description: 'Max events to return (default: 50)' },
          },
          required: ['label'],
        },
      },
      {
        name: WEBHOOK_TOOLS.wait_for_webhook.name,
        description: 'Polls until a webhook event matching the filter arrives. Requires L2 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string', description: 'Webhook label' },
            filter: {
              type: 'object',
              properties: {
                body_contains: { type: 'string' },
              },
            },
            timeout_ms: { type: 'number', description: 'Max wait time in milliseconds' },
          },
          required: ['label'],
        },
      },
      {
        name: WEBHOOK_TOOLS.delete_webhook.name,
        description: 'Deletes a webhook and all its events. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string', description: 'Webhook label to delete' },
          },
          required: ['label'],
        },
      },
      // Task tools
      {
        name: TASK_TOOLS.create_task.name,
        description: 'Creates a scheduled task using a cron expression. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string' },
            cron_expression: { type: 'string', description: 'Cron expression (e.g. "0 * * * *")' },
            tool_name: { type: 'string' },
            tool_args: { type: 'object' },
            passport_id: { type: 'string' },
            passport_version: { type: 'string' },
            permission_snapshot: { type: 'object' },
          },
          required: ['cron_expression', 'tool_name', 'passport_id', 'passport_version', 'permission_snapshot'],
        },
      },
      {
        name: TASK_TOOLS.list_tasks.name,
        description: 'Lists all scheduled tasks. Requires L2 trust.',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: TASK_TOOLS.delete_task.name,
        description: 'Deletes a scheduled task. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string' },
          },
          required: ['label'],
        },
      },
      {
        name: TASK_TOOLS.pause_task.name,
        description: 'Pauses a scheduled task without deleting it. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string' },
          },
          required: ['label'],
        },
      },
      // Docker tools
      {
        name: DOCKER_TOOLS.run_container.name,
        description: 'Runs a Docker container. Requires L4 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            image: { type: 'string' },
            name: { type: 'string' },
            env: { type: 'array', items: { type: 'string' } },
            ports: { type: 'object' },
          },
          required: ['image'],
        },
      },
      {
        name: DOCKER_TOOLS.stop_container.name,
        description: 'Stops a running container. Requires L4 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
      },
      {
        name: DOCKER_TOOLS.remove_container.name,
        description: 'Removes a container. Requires L4 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            id: { type: 'string' },
            force: { type: 'boolean' },
          },
          required: ['id'],
        },
      },
      {
        name: DOCKER_TOOLS.list_containers.name,
        description: 'Lists Docker containers. Requires L2 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            all: { type: 'boolean', description: 'Include stopped containers' },
          },
        },
      },
      {
        name: DOCKER_TOOLS.container_logs.name,
        description: 'Returns container stdout/stderr logs. Requires L2 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            id: { type: 'string' },
            tail: { type: 'number' },
          },
          required: ['id'],
        },
      },
      {
        name: DOCKER_TOOLS.exec_in_container.name,
        description: 'Executes a command inside a running container. Requires L4 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            id: { type: 'string' },
            command: { type: 'array', items: { type: 'string' } },
          },
          required: ['id', 'command'],
        },
      },
      // JMP phone tools
      {
        name: PHONE_JMP_TOOLS.provision_phone_number_jmp.name,
        description: 'Provisions a phone number via JMP XMPP (no KYC). Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            area_code: { type: 'string', description: 'US area code to request' },
          },
        },
      },
      {
        name: PHONE_JMP_TOOLS.send_sms_jmp.name,
        description: 'Sends an SMS via JMP XMPP. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            to: { type: 'string', description: 'Destination phone number (E.164)' },
            message: { type: 'string' },
            from_number: { type: 'string', description: 'Source JMP number (optional)' },
          },
          required: ['to', 'message'],
        },
      },
      {
        name: PHONE_JMP_TOOLS.read_sms_jmp.name,
        description: 'Returns inbound SMS messages buffered from JMP XMPP. Requires L2 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            number: { type: 'string', description: 'Filter by source number' },
            limit: { type: 'number' },
          },
        },
      },
      {
        name: PHONE_JMP_TOOLS.release_phone_number_jmp.name,
        description: 'Releases a JMP phone number. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            number: { type: 'string', description: 'Phone number to release' },
          },
          required: ['number'],
        },
      },
      // GitHub tools
      {
        name: GITHUB_TOOLS.create_repo.name,
        description: 'Creates a new GitHub repository for the authenticated user. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            name: { type: 'string', description: 'Repository name' },
            private: { type: 'boolean', description: 'Make repository private (default: false)' },
            description: { type: 'string', description: 'Repository description' },
          },
          required: ['name'],
        },
      },
      {
        name: GITHUB_TOOLS.create_file.name,
        description: 'Creates or updates a file in a GitHub repository. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            owner: { type: 'string', description: 'Repository owner (defaults to configured defaultOwner)' },
            repo: { type: 'string', description: 'Repository name' },
            path: { type: 'string', description: 'File path in the repository' },
            content: { type: 'string', description: 'File content (UTF-8 text)' },
            message: { type: 'string', description: 'Commit message' },
            branch: { type: 'string', description: 'Branch name (defaults to default branch)' },
          },
          required: ['repo', 'path', 'content', 'message'],
        },
      },
      {
        name: GITHUB_TOOLS.create_pull_request.name,
        description: 'Creates a pull request in a GitHub repository. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            owner: { type: 'string', description: 'Repository owner (defaults to configured defaultOwner)' },
            repo: { type: 'string', description: 'Repository name' },
            title: { type: 'string', description: 'Pull request title' },
            body: { type: 'string', description: 'Pull request body' },
            head: { type: 'string', description: 'Head branch name' },
            base: { type: 'string', description: 'Base branch name' },
          },
          required: ['repo', 'title', 'head', 'base'],
        },
      },
      {
        name: GITHUB_TOOLS.list_repos.name,
        description: 'Lists repositories for the authenticated GitHub user. Requires L2 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            type: { type: 'string', enum: ['all', 'owner', 'public', 'private'], description: 'Filter type (default: all)' },
            per_page: { type: 'number', description: 'Results per page (default: 30)' },
          },
        },
      },
      // IPFS tools
      {
        name: IPFS_TOOLS.publish_content.name,
        description: 'Publishes content to IPFS via Kubo daemon (or web3.storage fallback). Returns CID. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            content: { type: 'string', description: 'Content to publish (UTF-8 text)' },
            filename: { type: 'string', description: 'Optional filename hint' },
          },
          required: ['content'],
        },
      },
      {
        name: IPFS_TOOLS.get_ipfs_content.name,
        description: 'Retrieves content from IPFS by CID. Requires L2 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            cid: { type: 'string', description: 'IPFS CID to fetch' },
          },
          required: ['cid'],
        },
      },
      {
        name: IPFS_TOOLS.pin_content.name,
        description: 'Pins content on the local IPFS node to prevent garbage collection. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            cid: { type: 'string', description: 'IPFS CID to pin' },
          },
          required: ['cid'],
        },
      },
      // RSS tools
      {
        name: RSS_TOOLS.create_feed.name,
        description: 'Creates an RSS feed served at /feeds/{label}. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string', description: 'URL-safe feed label (e.g. "my-feed")' },
            title: { type: 'string', description: 'Feed title' },
            description: { type: 'string', description: 'Feed description' },
            link: { type: 'string', description: 'Feed website link' },
          },
          required: ['label', 'title', 'description', 'link'],
        },
      },
      {
        name: RSS_TOOLS.add_feed_item.name,
        description: 'Adds an item to an RSS feed. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            feed_label: { type: 'string', description: 'Feed label' },
            title: { type: 'string', description: 'Item title' },
            description: { type: 'string', description: 'Item description/content' },
            url: { type: 'string', description: 'Item URL (optional)' },
            guid: { type: 'string', description: 'Item GUID (optional, auto-generated)' },
          },
          required: ['feed_label', 'title', 'description'],
        },
      },
      {
        name: RSS_TOOLS.serve_feed.name,
        description: 'Returns the public URL for an RSS feed (uses active tunnel if available). Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string', description: 'Feed label' },
          },
          required: ['label'],
        },
      },
      // PostScan Mail tools
      {
        name: MAIL_TOOLS.list_mail.name,
        description: 'Lists physical mail items from PostScan Mail (or Earth Class Mail). Requires L2 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            limit: { type: 'number', description: 'Maximum number of items to return (default: 20)' },
            status: { type: 'string', description: 'Filter by status (e.g. "new", "scanned")' },
          },
        },
      },
      {
        name: MAIL_TOOLS.forward_mail.name,
        description: 'Forwards a physical mail item to a shipping address. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            mail_id: { type: 'string', description: 'Mail item ID' },
            address: { type: 'string', description: 'Forwarding address' },
          },
          required: ['mail_id', 'address'],
        },
      },
      {
        name: MAIL_TOOLS.shred_mail.name,
        description: 'Shreds (destroys) a physical mail item. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            mail_id: { type: 'string', description: 'Mail item ID to shred' },
          },
          required: ['mail_id'],
        },
      },
      {
        name: MAIL_TOOLS.scan_mail.name,
        description: 'Requests a high-resolution scan of a physical mail item. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            mail_id: { type: 'string', description: 'Mail item ID to scan' },
          },
          required: ['mail_id'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === 'notify_human') {
        const result = await notifyHuman(
          args as unknown as Parameters<typeof notifyHuman>[0],
          claims,
        );
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }

      // Wallet tools
      if (name === 'create_wallet') {
        const result = await createWallet(args as { label?: string; chain?: 'base' | 'polygon' }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'get_address') {
        const result = await getAddress(args as { label: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'get_balance') {
        const result = await getBalance(args as { label: string; token?: 'ETH' | 'MATIC' | 'USDC'; chain?: 'base' | 'polygon' }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'send_usdc') {
        const result = await sendUsdc(args as { from_label: string; to_address: string; amount: number; chain?: 'base' | 'polygon' }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'sign_message') {
        const result = await signMessage(args as { label: string; text: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'sign_typed_data') {
        const result = await signTypedData(args as { label: string; domain: Record<string, unknown>; types: Record<string, unknown>; value: Record<string, unknown> }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }

      // Bridge tools
      if (name === 'bridge_to_polygon') {
        const result = await bridgeToPolygon(args as { from_label: string; amount: number }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'bridge_to_base') {
        const result = await bridgeToBase(args as { from_label: string; amount: number }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'get_bridge_status') {
        const result = await getBridgeStatus(args as { bridge_id: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }

      // Payment tools
      if (name === 'pay_with_usdc') {
        const result = await payWithUsdc(args as { from_label: string; to_address: string; amount: number; memo?: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'get_payment_status') {
        const result = await getPaymentStatus(args as { tx_hash: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'prepare_payment') {
        const params = args as unknown as PreparePaymentParams;
        const receipt: PreparePaymentReceipt = await preparePayment(params, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(receipt) }] };
      }

      // Card tools
      if (name === 'create_virtual_card') {
        const result = await createVirtualCard(args as { label?: string; product?: 'moon_x' | 'moon_1x'; amount?: number }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'get_card_details') {
        const result = await getCardDetails(args as { label: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'add_funds_to_card') {
        const result = await addFundsToCard(args as { label: string; amount: number }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'top_up_moon_credit') {
        const result = await topUpMoonCredit(args as { amount: number }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'freeze_card') {
        const result = await freezeCard(args as { label: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'delete_card') {
        const result = await deleteCard(args as { label: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'get_card_transactions') {
        const result = await getCardTransactions(args as { label: string; limit?: number }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }

      // Phone tools
      if (name === 'provision_phone_number') {
        const result = await provisionPhoneNumber(args as { area_code?: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'send_sms') {
        const result = await sendSms(
          args as { from_number: string; to: string; message: string },
          claims,
        );
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'read_sms') {
        const result = await readSms(args as { number: string; limit?: number }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'release_phone_number') {
        const result = await releasePhoneNumber(args as { number: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }

      // Email tools
      if (name === 'create_mailbox') {
        const result = await createMailbox(args as { address: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'send_email') {
        const result = await sendEmail(
          args as { from: string; to: string; subject: string; body: string; html?: string },
          claims,
        );
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'read_inbox') {
        const result = await readInbox(args as { address: string; limit?: number }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'wait_for_email') {
        const result = await waitForEmail(
          args as {
            address: string;
            filter?: { subject_contains?: string; from_contains?: string; body_contains?: string };
            timeout_ms: number;
          },
          claims,
        );
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'delete_mailbox') {
        const result = await deleteMailbox(args as { address: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }

      // Tunnel tools
      if (name === 'create_tunnel') {
        const result = await createTunnel(args as { port: number; label?: string; provider?: 'cloudflared' | 'ngrok' }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'get_tunnel_url') {
        const result = await getTunnelUrl(args as { label: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'close_tunnel') {
        const result = await closeTunnel(args as { label: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }

      // Webhook tools
      if (name === 'create_webhook') {
        const result = await createWebhook(args as { label: string; max_payload_bytes?: number; retention_days?: number }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'get_webhook_url') {
        const result = await getWebhookUrl(args as { label: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'read_webhook_events') {
        const result = await readWebhookEvents(args as { label: string; since?: string; limit?: number }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'wait_for_webhook') {
        const result = await waitForWebhook(args as { label: string; filter?: { body_contains?: string }; timeout_ms?: number }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'delete_webhook') {
        const result = await deleteWebhook(args as { label: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }

      // Task tools
      if (name === 'create_task') {
        const result = await createTask(args as {
          label?: string;
          cron_expression: string;
          tool_name: string;
          tool_args?: Record<string, unknown>;
          passport_id: string;
          passport_version: string;
          permission_snapshot: PermissionSnapshot;
        }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'list_tasks') {
        const result = await listTasks({} as Record<string, never>, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'delete_task') {
        const result = await deleteTask(args as { label: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'pause_task') {
        const result = await pauseTask(args as { label: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }

      // Docker tools
      if (name === 'run_container') {
        const result = await runContainer(args as { image: string; name?: string; env?: string[]; ports?: Record<string, string> }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'stop_container') {
        const result = await stopContainer(args as { id: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'remove_container') {
        const result = await removeContainer(args as { id: string; force?: boolean }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'list_containers') {
        const result = await listContainers(args as { all?: boolean }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'container_logs') {
        const result = await containerLogs(args as { id: string; tail?: number }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'exec_in_container') {
        const result = await execInContainer(args as { id: string; command: string[] }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }

      // JMP phone tools
      if (name === 'provision_phone_number_jmp') {
        const result = await provisionPhoneNumberJmp(args as { area_code?: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'send_sms_jmp') {
        const result = await sendSmsJmp(args as { to: string; message: string; from_number?: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'read_sms_jmp') {
        const result = await readSmsJmp(args as { number?: string; limit?: number }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'release_phone_number_jmp') {
        const result = await releasePhoneNumberJmp(args as { number: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }

      // GitHub tools
      if (name === 'create_repo') {
        const result = await createRepo(args as { name: string; private?: boolean; description?: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'create_file') {
        const result = await createFile(args as { owner?: string; repo: string; path: string; content: string; message: string; branch?: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'create_pull_request') {
        const result = await createPullRequest(args as { owner?: string; repo: string; title: string; body?: string; head: string; base: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'list_repos') {
        const result = await listRepos(args as { type?: 'all' | 'owner' | 'public' | 'private'; per_page?: number }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }

      // IPFS tools
      if (name === 'publish_content') {
        const result = await publishContent(args as { content: string; filename?: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'get_ipfs_content') {
        const result = await getIpfsContent(args as { cid: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'pin_content') {
        const result = await pinContent(args as { cid: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }

      // RSS tools
      if (name === 'create_feed') {
        const result = await createFeed(args as { label: string; title: string; description: string; link: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'add_feed_item') {
        const result = await addFeedItem(args as { feed_label: string; title: string; description: string; url?: string; guid?: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'serve_feed') {
        const result = await serveFeed(args as { label: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }

      // PostScan Mail tools
      if (name === 'list_mail') {
        const result = await listMail(args as { limit?: number; status?: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'forward_mail') {
        const result = await forwardMail(args as { mail_id: string; address: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'shred_mail') {
        const result = await shredMail(args as { mail_id: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
      if (name === 'scan_mail') {
        const result = await scanMail(args as { mail_id: string }, claims);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: message }],
        isError: true,
      };
    }

    return {
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
      isError: true,
    };
  });

  return server;
}

export function createApp(options: ServerOptions): express.Application {
  const app = express();
  app.use(express.json());

  // Webhook receiver route — must be BEFORE auth middleware (public callback endpoint)
  app.post(
    '/webhooks/:label/:token',
    express.json({ limit: '1mb' }),
    (req: Request, res: Response) => {
      webhookReceiver(req, res).catch((err: unknown) => {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      });
    },
  );

  // RSS feed routes — public, no auth required
  registerRssRoutes(app);

  // Auth middleware
  app.use(async (req: AuthedRequest, res: Response, next: NextFunction) => {
    // Health check bypasses auth
    if (req.path === '/health') { next(); return; }

    try {
      const token = extractBearerToken(req.headers.authorization);
      const claims = await validatePassport(token, options.registryUrl);
      req.passport = claims;
      next();
    } catch (e) {
      if (e instanceof AuthError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      next(e);
    }
  });

  // Kill switch check (after auth, before tool dispatch)
  app.use('/mcp', (_req: AuthedRequest, res: Response, next: NextFunction) => {
    if (isPaused()) {
      res.status(503).json({
        error: 'PAUSED',
        message: 'Hands and Feet is paused. Run "hands-and-feet resume" to re-enable.',
      });
      return;
    }
    next();
  });

  // MCP endpoint
  app.post('/mcp', async (req: AuthedRequest, res: Response) => {
    const claims = req.passport!;
    const mcpServer = createMcpServer(claims);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
      enableJsonResponse: true,      // return JSON instead of SSE for simple req/res
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('finish', () => mcpServer.close().catch(() => undefined));
  });

  // Health check (no auth required)
  app.get('/health', (_req, res) => {
    res.json({ ok: true, paused: isPaused() });
  });

  return app;
}

export function startServer(options: ServerOptions): Promise<import('http').Server> {
  const app = createApp(options);
  const port = options.port ?? 3847;
  return new Promise((resolve) => {
    const httpServer = app.listen(port, () => {
      console.log(`Hands and Feet MCP server listening on http://localhost:${port}/mcp`);
      startLocalTransportIfConfigured().catch((err) => {
        console.error('Failed to start local SMTP transport:', err);
      });
      // Plan F: load scheduled tasks, start webhook purge job, optionally start XMPP
      try {
        loadActiveTasks();
      } catch (err: unknown) {
        console.error('Failed to load active tasks:', err instanceof Error ? err.message : String(err));
      }
      startPurgeJob();
      startXmppIfConfigured().catch((err: unknown) => {
        console.error('Failed to start XMPP client:', err instanceof Error ? err.message : String(err));
      });
      resolve(httpServer);
    });
  });
}
