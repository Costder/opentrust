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
      {
        name: NOTIFY_TOOL.name,
        description: NOTIFY_TOOL.description,
        inputSchema: NOTIFY_TOOL.inputSchema,
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'notify_human') {
      const result = await notifyHuman(
        args as unknown as Parameters<typeof notifyHuman>[0],
        claims,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
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
