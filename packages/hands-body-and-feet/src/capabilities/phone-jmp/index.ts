import { enforceTrust } from '../../trust.js';
import { SecretsError } from '../../secrets.js';
import type { PassportClaims, ToolDefinition } from '../../types.js';
import { matchAndFire } from '../triggers/index.js';

// ────────────────────────────────────────────────────────────
// Tool definitions
// ────────────────────────────────────────────────────────────
const PROVISION_JMP_TOOL: ToolDefinition = { name: 'provision_phone_number_jmp', minTrustLevel: 3 };
const SEND_SMS_JMP_TOOL: ToolDefinition = { name: 'send_sms_jmp', minTrustLevel: 3 };
const READ_SMS_JMP_TOOL: ToolDefinition = { name: 'read_sms_jmp', minTrustLevel: 2 };
const RELEASE_JMP_TOOL: ToolDefinition = { name: 'release_phone_number_jmp', minTrustLevel: 3 };

export const PHONE_JMP_TOOLS = {
  provision_phone_number_jmp: PROVISION_JMP_TOOL,
  send_sms_jmp: SEND_SMS_JMP_TOOL,
  read_sms_jmp: READ_SMS_JMP_TOOL,
  release_phone_number_jmp: RELEASE_JMP_TOOL,
};

// ────────────────────────────────────────────────────────────
// XMPP client (process-scoped lazy connection)
// ────────────────────────────────────────────────────────────
interface XmppMessage {
  from: string;
  body: string;
  received_at: string;
}

// In-memory inbox for inbound JMP messages
const inboundMessages = new Map<string, XmppMessage[]>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let xmppConn: any | null = null;

function getXmppCredentials(): { jid: string; password: string } {
  const jid = process.env['XMPP_JID'];
  const password = process.env['XMPP_PASSWORD'];
  if (!jid || !password) {
    throw new SecretsError(
      'XMPP_JID and XMPP_PASSWORD environment variables are required for JMP phone. ' +
        'Run "hands-body-and-feet init" and configure JMP.',
    );
  }
  return { jid, password };
}

async function getXmppClient(): Promise<unknown> {
  if (xmppConn) return xmppConn;

  const { jid, password } = getXmppCredentials();

  // Dynamic import to avoid import-time side effects
  const { client: xmppClient, xml } = await import('@xmpp/client');

  const xmpp = xmppClient({
    service: 'xmpp://xmpp.jmp.chat',
    domain: 'jmp.chat',
    resource: 'hands-body-and-feet',
    username: jid.split('@')[0],
    password,
  });

  // Buffer inbound messages from jmp.chat domain
  xmpp.on('stanza', (stanza: unknown) => {
    const s = stanza as {
      is: (tag: string) => boolean;
      attrs: { from?: string };
      getChildText: (tag: string) => string | null;
    };
    if (!s.is('message')) return;
    const from: string = s.attrs.from ?? '';
    if (!from.includes('jmp.chat')) return;
    const body = s.getChildText('body');
    if (!body) return;

    // Key by the from number (strip resource)
    const bareFrom = from.split('/')[0];
    const msgs = inboundMessages.get(bareFrom) ?? [];
    msgs.push({ from: bareFrom, body, received_at: new Date().toISOString() });
    inboundMessages.set(bareFrom, msgs);

    matchAndFire('sms', {
      from_number: bareFrom,
      body,
    }).catch((e: unknown) => console.error('[triggers] sms matchAndFire error:', e instanceof Error ? e.message : String(e)));
  });

  await xmpp.start();
  xmppConn = xmpp;

  // Keep the xml helper available for sending
  (xmppConn as unknown as Record<string, unknown>)['_xml'] = xml;

  return xmpp;
}

// ────────────────────────────────────────────────────────────
// Tools
// ────────────────────────────────────────────────────────────
export async function provisionPhoneNumberJmp(
  params: { area_code?: string },
  claims: PassportClaims,
): Promise<{ message: string; gateway: string }> {
  enforceTrust(claims, PROVISION_JMP_TOOL);

  const xmpp = await getXmppClient() as {
    send: (stanza: unknown) => Promise<void>;
    _xml: (...args: unknown[]) => unknown;
  };
  const { xml } = await import('@xmpp/client');

  const areaCode = params.area_code ?? '555';
  const gateway = `+1${areaCode}0000000@inum.net`;

  // Send provisioning request to JMP gateway
  await xmpp.send(
    xml('message', { to: gateway, type: 'chat' }, xml('body', {}, `PROVISION ${areaCode}`)),
  );

  return {
    message: `Provisioning request sent to JMP gateway for area code ${areaCode}. Check read_sms_jmp for confirmation.`,
    gateway,
  };
}

export async function sendSmsJmp(
  params: { to: string; message: string; from_number?: string },
  claims: PassportClaims,
): Promise<{ sent: boolean; to: string }> {
  enforceTrust(claims, SEND_SMS_JMP_TOOL);

  const xmpp = await getXmppClient() as {
    send: (stanza: unknown) => Promise<void>;
  };
  const { xml } = await import('@xmpp/client');

  // Format: number@jmp.chat
  const to = params.to.includes('@') ? params.to : `${params.to}@jmp.chat`;

  await xmpp.send(
    xml('message', { to, type: 'chat' }, xml('body', {}, params.message)),
  );

  return { sent: true, to };
}

export async function readSmsJmp(
  params: { number?: string; limit?: number },
  claims: PassportClaims,
): Promise<{ messages: XmppMessage[]; count: number }> {
  enforceTrust(claims, READ_SMS_JMP_TOOL);

  // Ensure the XMPP client is initialised (will throw SecretsError if not configured)
  await getXmppClient();

  const limit = params.limit ?? 20;
  let messages: XmppMessage[];

  if (params.number) {
    const bareNumber = params.number.includes('@')
      ? params.number.split('/')[0]
      : `${params.number}@jmp.chat`;
    messages = (inboundMessages.get(bareNumber) ?? []).slice(-limit);
  } else {
    // Return all messages across all numbers
    const all: XmppMessage[] = [];
    for (const msgs of inboundMessages.values()) {
      all.push(...msgs);
    }
    messages = all
      .sort((a, b) => a.received_at.localeCompare(b.received_at))
      .slice(-limit);
  }

  return { messages, count: messages.length };
}

export async function releasePhoneNumberJmp(
  params: { number: string },
  claims: PassportClaims,
): Promise<{ released: boolean; number: string }> {
  enforceTrust(claims, RELEASE_JMP_TOOL);

  const xmpp = await getXmppClient() as {
    send: (stanza: unknown) => Promise<void>;
  };
  const { xml } = await import('@xmpp/client');

  const gateway = `${params.number}@inum.net`;
  await xmpp.send(
    xml('message', { to: gateway, type: 'chat' }, xml('body', {}, `RELEASE ${params.number}`)),
  );

  // Clear local inbox for the number
  const bareNumber = params.number.includes('@')
    ? params.number.split('/')[0]
    : `${params.number}@jmp.chat`;
  inboundMessages.delete(bareNumber);

  return { released: true, number: params.number };
}

/** Reset XMPP connection (for testing) */
export function _resetXmppConn(): void {
  xmppConn = null;
  inboundMessages.clear();
}

/** Expose inbound messages map for testing */
export function _getInboundMessages(): Map<string, XmppMessage[]> {
  return inboundMessages;
}

/** Start XMPP if configured (no-op if env vars missing) */
export async function startXmppIfConfigured(): Promise<void> {
  if (!process.env['XMPP_JID'] || !process.env['XMPP_PASSWORD']) return;
  try {
    await getXmppClient();
  } catch (err: unknown) {
    console.error('JMP XMPP connection failed:', err instanceof Error ? err.message : String(err));
  }
}
