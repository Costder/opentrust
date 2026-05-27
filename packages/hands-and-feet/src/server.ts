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
  PAYMENT_TOOLS,
} from './capabilities/payments/index.js';
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
      resolve(httpServer);
    });
  });
}
