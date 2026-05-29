// packages/hands-and-feet/src/dispatch.ts
// Single execution seam for all tool calls.
// Called by the /mcp handler, fireTask, and executeUnderDelegation.
import { notifyHuman } from './capabilities/notify/index.js';
import { createWallet, getAddress, getBalance, sendUsdc, signMessage, signTypedData } from './capabilities/wallet/index.js';
import { bridgeToPolygon, bridgeToBase, getBridgeStatus } from './capabilities/bridge/index.js';
import { payWithUsdc, getPaymentStatus, preparePayment } from './capabilities/payments/index.js';
import type { PreparePaymentParams, PreparePaymentReceipt } from './capabilities/payments/index.js';
import { createVirtualCard, getCardDetails, addFundsToCard, topUpMoonCredit, freezeCard, deleteCard, getCardTransactions } from './capabilities/cards/index.js';
import { provisionPhoneNumber, sendSms, readSms, releasePhoneNumber } from './capabilities/phone/index.js';
import { createMailbox, sendEmail, readInbox, waitForEmail, deleteMailbox } from './capabilities/email/index.js';
import { createTunnel, getTunnelUrl, closeTunnel } from './capabilities/tunnel/index.js';
import { createWebhook, getWebhookUrl, readWebhookEvents, waitForWebhook, deleteWebhook } from './capabilities/webhook/index.js';
import { createTask, listTasks, deleteTask, pauseTask } from './capabilities/tasks/index.js';
import type { PermissionSnapshot } from './capabilities/tasks/revocation.js';
import { runContainer, stopContainer, removeContainer, listContainers, containerLogs, execInContainer } from './capabilities/docker/index.js';
import { provisionPhoneNumberJmp, sendSmsJmp, readSmsJmp, releasePhoneNumberJmp } from './capabilities/phone-jmp/index.js';
import { createRepo, createFile, createPullRequest, listRepos } from './capabilities/github/index.js';
import { publishContent, getIpfsContent, pinContent } from './capabilities/ipfs/index.js';
import { createFeed, addFeedItem, serveFeed } from './capabilities/rss/index.js';
import { listMail, forwardMail, shredMail, scanMail } from './capabilities/mail/index.js';
import { createDelegation, listDelegations, revokeDelegation } from './capabilities/delegations/index.js';
import type { PassportClaims } from './types.js';

export type DispatchResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function ok(result: unknown): DispatchResult {
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

function err(message: string): DispatchResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export async function dispatchTool(
  name: string,
  args: unknown,
  claims: PassportClaims,
): Promise<DispatchResult> {
  try {
    if (name === 'notify_human') return ok(await notifyHuman(args as Parameters<typeof notifyHuman>[0], claims));
    if (name === 'create_wallet') return ok(await createWallet(args as { label?: string; chain?: 'base' | 'polygon' }, claims));
    if (name === 'get_address') return ok(await getAddress(args as { label: string }, claims));
    if (name === 'get_balance') return ok(await getBalance(args as { label: string; token?: 'ETH' | 'MATIC' | 'USDC'; chain?: 'base' | 'polygon' }, claims));
    if (name === 'send_usdc') return ok(await sendUsdc(args as { from_label: string; to_address: string; amount: number; chain?: 'base' | 'polygon' }, claims));
    if (name === 'sign_message') return ok(await signMessage(args as { label: string; text: string }, claims));
    if (name === 'sign_typed_data') return ok(await signTypedData(args as { label: string; domain: Record<string, unknown>; types: Record<string, unknown>; value: Record<string, unknown> }, claims));
    if (name === 'bridge_to_polygon') return ok(await bridgeToPolygon(args as { from_label: string; amount: number }, claims));
    if (name === 'bridge_to_base') return ok(await bridgeToBase(args as { from_label: string; amount: number }, claims));
    if (name === 'get_bridge_status') return ok(await getBridgeStatus(args as { bridge_id: string }, claims));
    if (name === 'pay_with_usdc') return ok(await payWithUsdc(args as { from_label: string; to_address: string; amount: number; memo?: string }, claims));
    if (name === 'get_payment_status') return ok(await getPaymentStatus(args as { tx_hash: string }, claims));
    if (name === 'prepare_payment') return ok(await preparePayment(args as unknown as PreparePaymentParams, claims) as PreparePaymentReceipt);
    if (name === 'create_virtual_card') return ok(await createVirtualCard(args as { label?: string; product?: 'moon_x' | 'moon_1x'; amount?: number }, claims));
    if (name === 'get_card_details') return ok(await getCardDetails(args as { label: string }, claims));
    if (name === 'add_funds_to_card') return ok(await addFundsToCard(args as { label: string; amount: number }, claims));
    if (name === 'top_up_moon_credit') return ok(await topUpMoonCredit(args as { amount: number }, claims));
    if (name === 'freeze_card') return ok(await freezeCard(args as { label: string }, claims));
    if (name === 'delete_card') return ok(await deleteCard(args as { label: string }, claims));
    if (name === 'get_card_transactions') return ok(await getCardTransactions(args as { label: string; limit?: number }, claims));
    if (name === 'provision_phone_number') return ok(await provisionPhoneNumber(args as { area_code?: string }, claims));
    if (name === 'send_sms') return ok(await sendSms(args as { from_number: string; to: string; message: string }, claims));
    if (name === 'read_sms') return ok(await readSms(args as { number: string; limit?: number }, claims));
    if (name === 'release_phone_number') return ok(await releasePhoneNumber(args as { number: string }, claims));
    if (name === 'create_mailbox') return ok(await createMailbox(args as { address: string }, claims));
    if (name === 'send_email') return ok(await sendEmail(args as { from: string; to: string; subject: string; body: string; html?: string }, claims));
    if (name === 'read_inbox') return ok(await readInbox(args as { address: string; limit?: number }, claims));
    if (name === 'wait_for_email') return ok(await waitForEmail(args as { address: string; filter?: { subject_contains?: string; from_contains?: string; body_contains?: string }; timeout_ms: number }, claims));
    if (name === 'delete_mailbox') return ok(await deleteMailbox(args as { address: string }, claims));
    if (name === 'create_tunnel') return ok(await createTunnel(args as { port: number; label?: string; provider?: 'cloudflared' | 'ngrok' }, claims));
    if (name === 'get_tunnel_url') return ok(await getTunnelUrl(args as { label: string }, claims));
    if (name === 'close_tunnel') return ok(await closeTunnel(args as { label: string }, claims));
    if (name === 'create_webhook') return ok(await createWebhook(args as { label: string; max_payload_bytes?: number; retention_days?: number }, claims));
    if (name === 'get_webhook_url') return ok(await getWebhookUrl(args as { label: string }, claims));
    if (name === 'read_webhook_events') return ok(await readWebhookEvents(args as { label: string; since?: string; limit?: number }, claims));
    if (name === 'wait_for_webhook') return ok(await waitForWebhook(args as { label: string; filter?: { body_contains?: string }; timeout_ms?: number }, claims));
    if (name === 'delete_webhook') return ok(await deleteWebhook(args as { label: string }, claims));
    if (name === 'create_task') return ok(await createTask(args as { label?: string; cron_expression: string; tool_name: string; tool_args?: Record<string, unknown>; passport_id: string; passport_version: string; permission_snapshot: PermissionSnapshot }, claims));
    if (name === 'list_tasks') return ok(await listTasks({} as Record<string, never>, claims));
    if (name === 'delete_task') return ok(await deleteTask(args as { label: string }, claims));
    if (name === 'pause_task') return ok(await pauseTask(args as { label: string }, claims));
    if (name === 'run_container') return ok(await runContainer(args as { image: string; name?: string; env?: string[]; ports?: Record<string, string> }, claims));
    if (name === 'stop_container') return ok(await stopContainer(args as { id: string }, claims));
    if (name === 'remove_container') return ok(await removeContainer(args as { id: string; force?: boolean }, claims));
    if (name === 'list_containers') return ok(await listContainers(args as { all?: boolean }, claims));
    if (name === 'container_logs') return ok(await containerLogs(args as { id: string; tail?: number }, claims));
    if (name === 'exec_in_container') return ok(await execInContainer(args as { id: string; command: string[] }, claims));
    if (name === 'provision_phone_number_jmp') return ok(await provisionPhoneNumberJmp(args as { area_code?: string }, claims));
    if (name === 'send_sms_jmp') return ok(await sendSmsJmp(args as { to: string; message: string; from_number?: string }, claims));
    if (name === 'read_sms_jmp') return ok(await readSmsJmp(args as { number?: string; limit?: number }, claims));
    if (name === 'release_phone_number_jmp') return ok(await releasePhoneNumberJmp(args as { number: string }, claims));
    if (name === 'create_repo') return ok(await createRepo(args as { name: string; private?: boolean; description?: string }, claims));
    if (name === 'create_file') return ok(await createFile(args as { owner?: string; repo: string; path: string; content: string; message: string; branch?: string }, claims));
    if (name === 'create_pull_request') return ok(await createPullRequest(args as { owner?: string; repo: string; title: string; body?: string; head: string; base: string }, claims));
    if (name === 'list_repos') return ok(await listRepos(args as { type?: 'all' | 'owner' | 'public' | 'private'; per_page?: number }, claims));
    if (name === 'publish_content') return ok(await publishContent(args as { content: string; filename?: string }, claims));
    if (name === 'get_ipfs_content') return ok(await getIpfsContent(args as { cid: string }, claims));
    if (name === 'pin_content') return ok(await pinContent(args as { cid: string }, claims));
    if (name === 'create_feed') return ok(await createFeed(args as { label: string; title: string; description: string; link: string }, claims));
    if (name === 'add_feed_item') return ok(await addFeedItem(args as { feed_label: string; title: string; description: string; url?: string; guid?: string }, claims));
    if (name === 'serve_feed') return ok(await serveFeed(args as { label: string }, claims));
    if (name === 'list_mail') return ok(await listMail(args as { limit?: number; status?: string }, claims));
    if (name === 'forward_mail') return ok(await forwardMail(args as { mail_id: string; address: string }, claims));
    if (name === 'shred_mail') return ok(await shredMail(args as { mail_id: string }, claims));
    if (name === 'scan_mail') return ok(await scanMail(args as { mail_id: string }, claims));
    if (name === 'create_delegation') return ok(await createDelegation(args as { label?: string; tool_allowlist: string[]; spend_caps: { maxPerCallUsdc?: number; dailyCapUsdc?: number }; action_budgets: Record<string, number> }, claims));
    if (name === 'list_delegations')  return ok(await listDelegations({}, claims));
    if (name === 'revoke_delegation') return ok(await revokeDelegation(args as { label: string }, claims));

    return err(`Unknown tool: ${name}`);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
