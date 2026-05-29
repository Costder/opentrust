// packages/hands-and-feet/src/__tests__/dispatch.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PassportClaims } from '../types.js';

// Mock all capabilities so we don't need real providers
vi.mock('../capabilities/notify/index.js', () => ({
  notifyHuman: vi.fn().mockResolvedValue({ sent: true }),
  NOTIFY_TOOL: { name: 'notify_human', description: '', inputSchema: { type: 'object', properties: {} } },
}));
vi.mock('../capabilities/wallet/index.js', () => ({
  createWallet: vi.fn().mockResolvedValue({ label: 'w1', address: '0x1' }),
  getAddress: vi.fn(), getBalance: vi.fn(), sendUsdc: vi.fn(), signMessage: vi.fn(), signTypedData: vi.fn(),
  WALLET_TOOLS: { create_wallet: { name: 'create_wallet', minTrustLevel: 2 }, get_address: { name: 'get_address', minTrustLevel: 2 }, get_balance: { name: 'get_balance', minTrustLevel: 2 }, send_usdc: { name: 'send_usdc', minTrustLevel: 4 }, sign_message: { name: 'sign_message', minTrustLevel: 3 }, sign_typed_data: { name: 'sign_typed_data', minTrustLevel: 4 } },
}));
vi.mock('../capabilities/bridge/index.js', () => ({
  bridgeToPolygon: vi.fn().mockResolvedValue({}), bridgeToBase: vi.fn().mockResolvedValue({}), getBridgeStatus: vi.fn().mockResolvedValue({}),
}));
vi.mock('../capabilities/payments/index.js', () => ({
  payWithUsdc: vi.fn().mockResolvedValue({}), getPaymentStatus: vi.fn().mockResolvedValue({}), preparePayment: vi.fn().mockResolvedValue({}),
}));
vi.mock('../capabilities/cards/index.js', () => ({
  createVirtualCard: vi.fn().mockResolvedValue({}), getCardDetails: vi.fn().mockResolvedValue({}), addFundsToCard: vi.fn().mockResolvedValue({}), topUpMoonCredit: vi.fn().mockResolvedValue({}), freezeCard: vi.fn().mockResolvedValue({}), deleteCard: vi.fn().mockResolvedValue({}), getCardTransactions: vi.fn().mockResolvedValue({}),
}));
vi.mock('../capabilities/phone/index.js', () => ({
  provisionPhoneNumber: vi.fn().mockResolvedValue({}), sendSms: vi.fn().mockResolvedValue({}), readSms: vi.fn().mockResolvedValue({}), releasePhoneNumber: vi.fn().mockResolvedValue({}),
}));
vi.mock('../capabilities/email/index.js', () => ({
  createMailbox: vi.fn().mockResolvedValue({}), sendEmail: vi.fn().mockResolvedValue({}), readInbox: vi.fn().mockResolvedValue({}), waitForEmail: vi.fn().mockResolvedValue({}), deleteMailbox: vi.fn().mockResolvedValue({}),
}));
vi.mock('../capabilities/tunnel/index.js', () => ({
  createTunnel: vi.fn().mockResolvedValue({}), getTunnelUrl: vi.fn().mockResolvedValue({}), closeTunnel: vi.fn().mockResolvedValue({}),
}));
vi.mock('../capabilities/webhook/index.js', () => ({
  createWebhook: vi.fn().mockResolvedValue({}), getWebhookUrl: vi.fn().mockResolvedValue({}), readWebhookEvents: vi.fn().mockResolvedValue({}), waitForWebhook: vi.fn().mockResolvedValue({}), deleteWebhook: vi.fn().mockResolvedValue({}),
  registerWebhookRoutes: vi.fn(), webhookReceiver: vi.fn(),
}));
vi.mock('../capabilities/tasks/index.js', () => ({
  createTask: vi.fn().mockResolvedValue({}), listTasks: vi.fn().mockResolvedValue({}), deleteTask: vi.fn().mockResolvedValue({}), pauseTask: vi.fn().mockResolvedValue({}),
  loadActiveTasks: vi.fn(), startPurgeJob: vi.fn(),
}));
vi.mock('../capabilities/docker/index.js', () => ({
  runContainer: vi.fn().mockResolvedValue({}), stopContainer: vi.fn().mockResolvedValue({}), removeContainer: vi.fn().mockResolvedValue({}), listContainers: vi.fn().mockResolvedValue({}), containerLogs: vi.fn().mockResolvedValue({}), execInContainer: vi.fn().mockResolvedValue({}),
}));
vi.mock('../capabilities/phone-jmp/index.js', () => ({
  provisionPhoneNumberJmp: vi.fn().mockResolvedValue({}), sendSmsJmp: vi.fn().mockResolvedValue({}), readSmsJmp: vi.fn().mockResolvedValue({}), releasePhoneNumberJmp: vi.fn().mockResolvedValue({}),
  startXmppIfConfigured: vi.fn(),
}));
vi.mock('../capabilities/github/index.js', () => ({
  createRepo: vi.fn().mockResolvedValue({}), createFile: vi.fn().mockResolvedValue({}), createPullRequest: vi.fn().mockResolvedValue({}), listRepos: vi.fn().mockResolvedValue({}),
}));
vi.mock('../capabilities/ipfs/index.js', () => ({
  publishContent: vi.fn().mockResolvedValue({}), getIpfsContent: vi.fn().mockResolvedValue({}), pinContent: vi.fn().mockResolvedValue({}),
}));
vi.mock('../capabilities/rss/index.js', () => ({
  createFeed: vi.fn().mockResolvedValue({}), addFeedItem: vi.fn().mockResolvedValue({}), serveFeed: vi.fn().mockResolvedValue({}),
  registerRssRoutes: vi.fn(),
}));
vi.mock('../capabilities/mail/index.js', () => ({
  listMail: vi.fn().mockResolvedValue({}), forwardMail: vi.fn().mockResolvedValue({}), shredMail: vi.fn().mockResolvedValue({}), scanMail: vi.fn().mockResolvedValue({}),
}));

import { notifyHuman } from '../capabilities/notify/index.js';
import { createWallet } from '../capabilities/wallet/index.js';

function makeL3Claims(): PassportClaims {
  return { passportId: 'p1', agentId: 'a1', trustLevel: 3, trustStatus: 'seller_confirmed', flags: [], isDisputed: false, version: '1' };
}

describe('dispatchTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes notify_human', async () => {
    const { dispatchTool } = await import('../dispatch.js');
    await dispatchTool('notify_human', { message: 'hi' }, makeL3Claims());
    expect(notifyHuman).toHaveBeenCalledWith({ message: 'hi' }, makeL3Claims());
  });

  it('routes create_wallet', async () => {
    const { dispatchTool } = await import('../dispatch.js');
    const result = await dispatchTool('create_wallet', { label: 'w1' }, makeL3Claims());
    expect(createWallet).toHaveBeenCalled();
    expect(result.content[0].text).toContain('w1');
  });

  it('returns isError for unknown tool', async () => {
    const { dispatchTool } = await import('../dispatch.js');
    const result = await dispatchTool('nonexistent_tool', {}, makeL3Claims());
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });

  it('returns isError when capability throws', async () => {
    vi.mocked(notifyHuman).mockRejectedValueOnce(new Error('boom'));
    const { dispatchTool } = await import('../dispatch.js');
    const result = await dispatchTool('notify_human', { message: 'hi' }, makeL3Claims());
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('boom');
  });
});
