import { existsSync } from 'node:fs';

export interface CapabilityStatus {
  ready: boolean;
  provider?: string;
  availableProviders: string[];
  note?: string;
}

export interface CapabilityStatuses {
  email: CapabilityStatus;
  phone: CapabilityStatus;
  github: CapabilityStatus;
  wallet: CapabilityStatus;
  virtualCards: CapabilityStatus;
  docker: CapabilityStatus;
  tunnel: CapabilityStatus;
  ipfs: CapabilityStatus;
  physicalMail: CapabilityStatus;
  distribution: CapabilityStatus;
}

function hasKey(env: NodeJS.ProcessEnv, key: string): boolean {
  return typeof env[key] === 'string' && (env[key] as string).length > 0;
}

function detectEmail(env: NodeJS.ProcessEnv): CapabilityStatus {
  const available: string[] = ['local-smtp'];
  let provider: string | undefined;

  if (hasKey(env, 'AGENTMAIL_API_KEY')) { available.push('agentmail'); provider = 'agentmail'; }
  if (hasKey(env, 'POSTMARK_SERVER_TOKEN') || hasKey(env, 'POSTMARK_API_KEY')) { available.push('postmark'); provider = provider ?? 'postmark'; }
  if (hasKey(env, 'RESEND_API_KEY')) { available.push('resend'); provider = provider ?? 'resend'; }

  return {
    ready: true,
    provider: provider ?? 'local-smtp',
    availableProviders: available,
    note: provider ? `Configured via ${provider}` : 'Local SMTP only — add API key to enable cloud provider',
  };
}

function detectPhone(env: NodeJS.ProcessEnv): CapabilityStatus {
  const available: string[] = [];

  if (hasKey(env, 'TWILIO_ACCOUNT_SID') && hasKey(env, 'TWILIO_AUTH_TOKEN')) {
    available.push('twilio');
  }
  if (hasKey(env, 'SIGNALWIRE_SPACE_URL') && hasKey(env, 'SIGNALWIRE_PROJECT_ID') && hasKey(env, 'SIGNALWIRE_API_KEY')) {
    available.push('signalwire');
  }
  if (hasKey(env, 'JMP_PASSWORD') || (hasKey(env, 'XMPP_JID') && hasKey(env, 'XMPP_PASSWORD'))) {
    available.push('jmp');
  }

  return {
    ready: available.length > 0,
    provider: available[0],
    availableProviders: available,
    note: available.length > 0
      ? `Phone/SMS via ${available.join(', ')}`
      : 'No provider configured — set TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN, SIGNALWIRE_*, or JMP_PASSWORD',
  };
}

function detectGitHub(env: NodeJS.ProcessEnv): CapabilityStatus {
  const ready = hasKey(env, 'GITHUB_TOKEN');
  return {
    ready,
    provider: ready ? 'github-token' : undefined,
    availableProviders: ready ? ['github-token'] : [],
    note: ready ? 'GitHub token present' : 'Set GITHUB_TOKEN to enable GitHub operations',
  };
}

function detectWallet(env: NodeJS.ProcessEnv): CapabilityStatus {
  const available: string[] = [];

  if (hasKey(env, 'WALLET_PRIVATE_KEY') || hasKey(env, 'ETH_PRIVATE_KEY')) {
    available.push('ethereum-wallet');
  }
  if (hasKey(env, 'COINBASE_BUSINESS_API_KEY_ID') && hasKey(env, 'COINBASE_BUSINESS_API_KEY_SECRET')) {
    available.push('coinbase-commerce');
  }
  if (hasKey(env, 'COINBASE_COMMERCE_API_KEY')) {
    available.push('coinbase-commerce');
  }

  const deduped = [...new Set(available)];
  return {
    ready: deduped.length > 0,
    provider: deduped[0],
    availableProviders: deduped,
    note: deduped.length > 0
      ? `Payments via ${deduped.join(', ')}`
      : 'No wallet configured — set WALLET_PRIVATE_KEY or COINBASE_* credentials',
  };
}

function detectVirtualCards(env: NodeJS.ProcessEnv): CapabilityStatus {
  const ready = hasKey(env, 'MOON_API_KEY') || hasKey(env, 'MOON_SECRET_KEY');
  return {
    ready,
    provider: ready ? 'moon' : undefined,
    availableProviders: ready ? ['moon'] : [],
    note: ready ? 'Moon virtual card credentials present' : 'Set MOON_API_KEY to enable virtual card issuance',
  };
}

function detectDocker(env: NodeJS.ProcessEnv): CapabilityStatus {
  const hasDockerHost = hasKey(env, 'DOCKER_HOST');
  const hasSocket = existsSync('/var/run/docker.sock');
  const ready = hasDockerHost || hasSocket;

  return {
    ready,
    provider: ready ? 'docker' : undefined,
    availableProviders: ready ? ['docker'] : [],
    note: ready
      ? hasDockerHost ? 'Docker via DOCKER_HOST' : 'Docker via /var/run/docker.sock'
      : 'Docker socket not found — install Docker or set DOCKER_HOST',
  };
}

function detectTunnel(env: NodeJS.ProcessEnv): CapabilityStatus {
  const available: string[] = ['cloudflared'];

  if (hasKey(env, 'NGROK_AUTHTOKEN')) {
    available.push('ngrok');
  }

  return {
    ready: true,
    provider: available.includes('ngrok') ? 'ngrok' : 'cloudflared',
    availableProviders: available,
    note: available.includes('ngrok')
      ? 'Tunnels via ngrok (authenticated) and cloudflared'
      : 'Tunnels via cloudflared (unauthenticated) — set NGROK_AUTHTOKEN for ngrok',
  };
}

function detectIpfs(env: NodeJS.ProcessEnv): CapabilityStatus {
  const available: string[] = [];
  const ipfsApiUrl = env['IPFS_API_URL'] ?? 'http://localhost:5001';

  if (hasKey(env, 'IPFS_API_URL') || ipfsApiUrl === 'http://localhost:5001') {
    available.push('local-kubo');
  }
  if (hasKey(env, 'WEB3_STORAGE_TOKEN') || hasKey(env, 'W3_PRINCIPAL')) {
    available.push('web3.storage');
  }

  return {
    ready: available.length > 0,
    provider: available[0],
    availableProviders: available,
    note: available.includes('web3.storage')
      ? 'IPFS via web3.storage (pinning service) and local Kubo'
      : 'IPFS via local Kubo node — set WEB3_STORAGE_TOKEN for pinning',
  };
}

function detectPhysicalMail(env: NodeJS.ProcessEnv): CapabilityStatus {
  const available: string[] = [];

  if (hasKey(env, 'POSTSCAN_API_KEY') || hasKey(env, 'POSTSCANMAIL_API_KEY')) {
    available.push('postscan');
  }
  if (hasKey(env, 'EARTH_CLASS_MAIL_API_KEY') || hasKey(env, 'ECM_API_KEY')) {
    available.push('earth-class-mail');
  }

  return {
    ready: available.length > 0,
    provider: available[0],
    availableProviders: available,
    note: available.length > 0
      ? `Physical mail via ${available.join(', ')}`
      : 'No physical mail provider — set POSTSCAN_API_KEY or EARTH_CLASS_MAIL_API_KEY',
  };
}

function detectDistribution(env: NodeJS.ProcessEnv): CapabilityStatus {
  const available: string[] = [];

  if (hasKey(env, 'GITHUB_TOKEN')) available.push('github-releases');
  if (hasKey(env, 'RESEND_API_KEY') || hasKey(env, 'POSTMARK_SERVER_TOKEN') || hasKey(env, 'POSTMARK_API_KEY')) {
    available.push('email-broadcast');
  }
  if (hasKey(env, 'IPFS_API_URL') || hasKey(env, 'WEB3_STORAGE_TOKEN')) {
    available.push('ipfs-publish');
  }

  available.push('rss-feed');

  return {
    ready: true,
    provider: available[0],
    availableProviders: available,
    note: `Distribution channels: ${available.join(', ')}`,
  };
}

export function getCapabilityStatuses(env: NodeJS.ProcessEnv = process.env): CapabilityStatuses {
  return {
    email: detectEmail(env),
    phone: detectPhone(env),
    github: detectGitHub(env),
    wallet: detectWallet(env),
    virtualCards: detectVirtualCards(env),
    docker: detectDocker(env),
    tunnel: detectTunnel(env),
    ipfs: detectIpfs(env),
    physicalMail: detectPhysicalMail(env),
    distribution: detectDistribution(env),
  };
}
