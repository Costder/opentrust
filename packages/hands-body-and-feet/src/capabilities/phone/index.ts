import twilio from 'twilio';
import { openDb } from '../../spend-tracker.js';
import { enforceTrust } from '../../trust.js';
import { TrustError } from '../../trust.js';
import type { PassportClaims } from '../../types.js';
import { readConfig } from '../../config.js';
import { SecretsError } from '../../secrets.js';

export interface SmsMessage {
  sid: string;
  from: string;
  to: string;
  body: string;
  direction: string;
  status: string;
  dateSent: string;
}

interface PhoneProvider {
  name: 'twilio' | 'signalwire';
  provisionNumber(areaCode?: string): Promise<{ number: string; sid: string }>;
  sendSms(from: string, to: string, message: string): Promise<{ sid: string }>;
  listMessages(number: string, limit: number): Promise<SmsMessage[]>;
  releaseNumber(number: string, sid: string): Promise<void>;
}

class TwilioProvider implements PhoneProvider {
  name = 'twilio' as const;
  private client: ReturnType<typeof twilio>;

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      throw new SecretsError('Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN env vars');
    }
    this.client = twilio(accountSid, authToken);
  }

  async provisionNumber(areaCode?: string): Promise<{ number: string; sid: string }> {
    const available = await this.client.availablePhoneNumbers('US').local.list({
      areaCode: areaCode ? parseInt(areaCode) : undefined,
      limit: 1,
    });
    if (!available.length) throw new Error('No phone numbers available for that area code');
    const purchased = await this.client.incomingPhoneNumbers.create({
      phoneNumber: available[0].phoneNumber,
    });
    return { number: purchased.phoneNumber, sid: purchased.sid };
  }

  async sendSms(from: string, to: string, body: string): Promise<{ sid: string }> {
    const msg = await this.client.messages.create({ from, to, body });
    return { sid: msg.sid };
  }

  async listMessages(number: string, limit: number): Promise<SmsMessage[]> {
    const messages = await this.client.messages.list({ to: number, limit });
    return messages.map((m) => ({
      sid: m.sid, from: m.from, to: m.to, body: m.body,
      direction: m.direction, status: m.status,
      dateSent: m.dateSent?.toISOString() ?? new Date().toISOString(),
    }));
  }

  async releaseNumber(_number: string, sid: string): Promise<void> {
    await this.client.incomingPhoneNumbers(sid).remove();
  }
}

class SignalWireProvider implements PhoneProvider {
  name = 'signalwire' as const;

  constructor() {
    const projectId = process.env.SIGNALWIRE_PROJECT_ID;
    const authToken = process.env.SIGNALWIRE_AUTH_TOKEN;
    const spaceUrl = process.env.SIGNALWIRE_SPACE_URL;
    if (!projectId || !authToken || !spaceUrl) {
      throw new SecretsError(
        'Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_AUTH_TOKEN, and SIGNALWIRE_SPACE_URL env vars',
      );
    }
  }

  // SignalWire uses Twilio-compatible REST API directly via fetch
  private async swRequest<T>(method: string, path: string, body?: URLSearchParams): Promise<T> {
    const projectId = process.env.SIGNALWIRE_PROJECT_ID!;
    const authToken = process.env.SIGNALWIRE_AUTH_TOKEN!;
    const spaceUrl = process.env.SIGNALWIRE_SPACE_URL!;
    const url = `${spaceUrl}/api/laml/2010-04-01/Accounts/${projectId}${path}`;
    const credentials = Buffer.from(`${projectId}:${authToken}`).toString('base64');

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body?.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SignalWire API ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async provisionNumber(areaCode?: string): Promise<{ number: string; sid: string }> {
    const available = await this.swRequest<{
      available_phone_numbers: Array<{ phone_number: string }>;
    }>('GET', `/AvailablePhoneNumbers/US/Local.json?AreaCode=${areaCode ?? ''}&PageSize=1`);
    const phoneNumber = available.available_phone_numbers[0]?.phone_number;
    if (!phoneNumber) throw new Error('No numbers available');
    const purchaseBody = new URLSearchParams({ PhoneNumber: phoneNumber });
    const purchased = await this.swRequest<{ phone_number: string; sid: string }>(
      'POST',
      '/IncomingPhoneNumbers.json',
      purchaseBody,
    );
    return { number: purchased.phone_number, sid: purchased.sid };
  }

  async sendSms(from: string, to: string, message: string): Promise<{ sid: string }> {
    const body = new URLSearchParams({ From: from, To: to, Body: message });
    const result = await this.swRequest<{ sid: string }>('POST', '/Messages.json', body);
    return { sid: result.sid };
  }

  async listMessages(number: string, limit: number): Promise<SmsMessage[]> {
    const result = await this.swRequest<{
      messages: Array<{
        sid: string;
        from: string;
        to: string;
        body: string;
        direction: string;
        status: string;
        date_sent: string;
      }>;
    }>('GET', `/Messages.json?To=${encodeURIComponent(number)}&PageSize=${limit}`);
    return result.messages.map((m) => ({
      sid: m.sid,
      from: m.from,
      to: m.to,
      body: m.body,
      direction: m.direction,
      status: m.status,
      dateSent: m.date_sent,
    }));
  }

  async releaseNumber(_number: string, sid: string): Promise<void> {
    await this.swRequest('DELETE', `/IncomingPhoneNumbers/${sid}.json`);
  }
}

function getProvider(): PhoneProvider {
  const cfg = readConfig();
  const provider = cfg.capabilities.phone?.provider;
  if (!provider) {
    throw new SecretsError('Phone capability not configured. Run "hands-body-and-feet init" first.');
  }
  return provider === 'twilio' ? new TwilioProvider() : new SignalWireProvider();
}

export const PHONE_TOOLS = {
  provision_phone_number: {
    name: 'provision_phone_number',
    minTrustLevel: 3 as const,
    spendPolicy: { maxPerCallUsdc: 5, dailyCapUsdc: 50 },
  },
  send_sms: {
    name: 'send_sms',
    minTrustLevel: 3 as const,
    spendPolicy: { maxPerCallUsdc: 0.01, dailyCapUsdc: 1 },
  },
  read_sms: { name: 'read_sms', minTrustLevel: 2 as const },
  release_phone_number: { name: 'release_phone_number', minTrustLevel: 3 as const },
} as const;

export async function provisionPhoneNumber(
  params: { area_code?: string },
  claims: PassportClaims,
): Promise<{ number: string; provider: string }> {
  enforceTrust(claims, PHONE_TOOLS.provision_phone_number);
  const provider = getProvider();
  const { number, sid } = await provider.provisionNumber(params.area_code);
  const db = openDb();
  db.prepare(`
    INSERT OR REPLACE INTO phone_numbers (number, provider, sid, area_code, provisioned_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(number, provider.name, sid, params.area_code ?? null, new Date().toISOString());
  return { number, provider: provider.name };
}

export async function sendSms(
  params: { from_number: string; to: string; message: string },
  claims: PassportClaims,
): Promise<{ sid: string }> {
  enforceTrust(claims, PHONE_TOOLS.send_sms);
  const provider = getProvider();
  return provider.sendSms(params.from_number, params.to, params.message);
}

export async function readSms(
  params: { number: string; limit?: number },
  claims: PassportClaims,
): Promise<{ messages: SmsMessage[] }> {
  enforceTrust(claims, PHONE_TOOLS.read_sms);
  const provider = getProvider();
  const limit = params.limit ?? 20;
  const messages = await provider.listMessages(params.number, limit);
  // Upsert to DB
  const db = openDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO sms_inbox
      (number, sid, from_number, to_number, body, direction, status, date_sent, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const msg of messages) {
    insert.run(
      params.number,
      msg.sid,
      msg.from,
      msg.to,
      msg.body,
      msg.direction,
      msg.status,
      msg.dateSent,
      new Date().toISOString(),
    );
  }
  return { messages };
}

export async function releasePhoneNumber(
  params: { number: string },
  claims: PassportClaims,
): Promise<{ released: boolean }> {
  enforceTrust(claims, PHONE_TOOLS.release_phone_number);
  const db = openDb();
  const row = db.prepare('SELECT sid FROM phone_numbers WHERE number = ?').get(params.number) as
    | { sid: string }
    | undefined;
  if (!row) throw new Error(`Phone number ${params.number} not found`);
  const provider = getProvider();
  await provider.releaseNumber(params.number, row.sid);
  db.prepare('UPDATE phone_numbers SET released_at = ? WHERE number = ?').run(
    new Date().toISOString(),
    params.number,
  );
  return { released: true };
}
