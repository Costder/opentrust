import type { CommandModule } from 'yargs';
import { readConfig, readState } from '../config.js';

function check(configured: boolean): string {
  return configured ? '✅' : '❌';
}

const status: CommandModule = {
  command: 'status',
  describe: 'Print current system status',
  handler: async () => {
    const cfg = readConfig();
    const state = readState();
    const caps = cfg.capabilities;

    console.log('\n── Hands and Feet Status ─────────────────────────────');
    console.log(`  Kill switch:  ${state.paused ? '🔴 PAUSED' : '🟢 active'}`);
    if (state.paused) {
      console.log(`  Paused at:    ${state.pausedAt ?? 'unknown'}`);
      console.log(`  Paused by:    ${state.pausedBy ?? 'unknown'}`);
    }
    if (state.resumedAt && !state.paused) {
      console.log(`  Last resume:  ${state.resumedAt}`);
    }
    console.log(`  Instance ID:  ${cfg.instanceId}`);
    console.log(`  Registry:     ${cfg.registryUrl}`);

    console.log('\n  Capabilities:');
    console.log(`    ${check(!!caps.notify)}   notify      ${caps.notify ? `topic="${caps.notify.topic}"` : '(not configured)'}`);
    console.log(`    ${check(!!caps.cards)}   cards       ${caps.cards ? `sandbox=${caps.cards.sandbox}` : '(not configured)'}`);
    console.log(`    ${check(false)}   bridge      (placeholder)`);
    console.log(`    ${check(!!caps.phone)}   phone       ${caps.phone ? `provider=${caps.phone.provider}` : '(not configured)'}`);
    console.log(`    ${check(!!caps.email)}   email       ${caps.email ? `transport=${caps.email.transport}` : '(not configured)'}`);
    console.log(`    ${check(false)}   tunnel      (runtime — check serve logs)`);
    console.log(`    ${check(false)}   webhook     (runtime — check serve logs)`);
    console.log(`    ${check(false)}   tasks       (runtime — check serve logs)`);
    console.log(`    ${check(false)}   docker      (runtime — check serve logs)`);
    console.log(`    ${check(false)}   phone-jmp   ${process.env['XMPP_JID'] ? `jid=${process.env['XMPP_JID']}` : '(XMPP_JID not set)'}`);
    console.log(`    ${check(!!(caps as Record<string, unknown> & { github?: unknown }).github)}   github      ${(caps as Record<string, unknown> & { github?: { defaultOwner?: string } }).github ? `defaultOwner=${(caps as { github?: { defaultOwner?: string } }).github?.defaultOwner ?? '(none)'}` : '(not configured)'}`);
    console.log(`    ${check(false)}   ipfs        ${process.env['IPFS_API_URL'] ? `url=${process.env['IPFS_API_URL']}` : '(IPFS_API_URL not set — default: http://localhost:5001)'}`);
    console.log(`    ${check(false)}   rss         (runtime — feeds served at /feeds/:label)`);
    console.log(`    ${check(!!(process.env['POSTSCAN_API_KEY'] || process.env['EARTH_CLASS_MAIL_API_KEY']))}   mail        ${process.env['POSTSCAN_API_KEY'] ? 'PostScan Mail' : process.env['EARTH_CLASS_MAIL_API_KEY'] ? 'Earth Class Mail' : '(not configured)'}`);

    console.log('\n  Outsourced deps:');
    console.log('    ntfy.sh             github.com/binwiederhier/ntfy             L2 (low risk)');
    console.log('    @octokit/rest       github.com/octokit/octokit.js             L3 (moderate)');
    console.log('    kubo-rpc-client     github.com/ipfs/js-kubo-rpc-client        L3 (moderate)');
    console.log('    rss                 github.com/dylang/node-rss                L2 (low risk)');
    console.log('    ethers              github.com/ethers-io/ethers.js            L4 (financial)');
    console.log('    twilio              github.com/twilio/twilio-node             L3 (moderate)');
    console.log('    postmark            github.com/wildbit/postmark-node          L2 (low risk)');
    console.log('    resend              github.com/resend/resend-node             L2 (low risk)');
    console.log('    dockerode           github.com/apocas/dockerode               L4 (system)');
    console.log('    @ngrok/ngrok        github.com/ngrok/ngrok-javascript         L3 (network)');
    console.log('    cloudflared         github.com/nicholasgasior/cloudflared-npm L3 (network)');
    console.log('    better-sqlite3      github.com/JoshuaWise/better-sqlite3      L2 (low risk)');
    console.log('    @xmpp/client        github.com/xmppjs/xmpp.js                L2 (low risk)');
    console.log('──────────────────────────────────────────────────────\n');
  },
};

export default status;
