import type { PassportClaims } from '../../types.js';
import { enforceTrust } from '../../trust.js';
import { getNotifyTopic } from '../../secrets.js';

export const NOTIFY_TOOL = {
  name: 'notify_human',
  description:
    'Sends a push notification via ntfy.sh. Use to alert the human operator of important events, errors, or actions requiring attention.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      message: {
        type: 'string',
        description: 'The notification message body',
      },
      title: {
        type: 'string',
        description: 'Optional notification title (default: "Hands and Feet")',
      },
      priority: {
        type: 'string',
        enum: ['min', 'low', 'default', 'high', 'urgent'],
        description: 'ntfy.sh priority level (default: "default")',
      },
    },
    required: ['message'],
  },
  minTrustLevel: 2 as const,
  spendPolicy: undefined,
} as const;

export interface NotifyParams {
  message: string;
  title?: string;
  priority?: 'min' | 'low' | 'default' | 'high' | 'urgent';
}

export async function notifyHuman(
  params: NotifyParams,
  claims: PassportClaims,
): Promise<{ sent: boolean; topic: string }> {
  // Trust enforcement
  enforceTrust(claims, NOTIFY_TOOL);

  const { topic, serverUrl } = getNotifyTopic();
  const url = `${serverUrl.replace(/\/$/, '')}/${encodeURIComponent(topic)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      Title: params.title ?? 'Hands and Feet',
      Priority: params.priority ?? 'default',
    },
    body: params.message,
  });

  if (!response.ok) {
    throw new Error(`ntfy.sh returned ${response.status}: ${await response.text()}`);
  }

  return { sent: true, topic };
}
