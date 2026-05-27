import { Octokit } from '@octokit/rest';
import { SecretsError } from '../../secrets.js';
import { enforceTrust } from '../../trust.js';
import { readConfig } from '../../config.js';
import type { PassportClaims, ToolDefinition } from '../../types.js';

// ────────────────────────────────────────────────────────────
// Tool definitions
// ────────────────────────────────────────────────────────────
const CREATE_REPO_TOOL: ToolDefinition = { name: 'create_repo', minTrustLevel: 3 };
const CREATE_FILE_TOOL: ToolDefinition = { name: 'create_file', minTrustLevel: 3 };
const CREATE_PULL_REQUEST_TOOL: ToolDefinition = { name: 'create_pull_request', minTrustLevel: 3 };
const LIST_REPOS_TOOL: ToolDefinition = { name: 'list_repos', minTrustLevel: 2 };

export const GITHUB_TOOLS = {
  create_repo: CREATE_REPO_TOOL,
  create_file: CREATE_FILE_TOOL,
  create_pull_request: CREATE_PULL_REQUEST_TOOL,
  list_repos: LIST_REPOS_TOOL,
};

// ────────────────────────────────────────────────────────────
// Client factory
// ────────────────────────────────────────────────────────────
export function getOctokit(): Octokit {
  const token = process.env['GITHUB_TOKEN'];
  if (!token) {
    throw new SecretsError('GITHUB_TOKEN env var not set. Run: hands-and-feet init');
  }
  return new Octokit({ auth: token });
}

function getDefaultOwner(): string | undefined {
  try {
    const cfg = readConfig();
    return (cfg.capabilities as Record<string, unknown> & { github?: { defaultOwner?: string } })
      .github?.defaultOwner;
  } catch {
    return undefined;
  }
}

// ────────────────────────────────────────────────────────────
// create_repo
// ────────────────────────────────────────────────────────────
export async function createRepo(
  params: { name: string; private?: boolean; description?: string },
  claims: PassportClaims,
): Promise<{ id: number; name: string; full_name: string; url: string; private: boolean }> {
  enforceTrust(claims, CREATE_REPO_TOOL);
  const octokit = getOctokit();
  const { data } = await octokit.rest.repos.createForAuthenticatedUser({
    name: params.name,
    private: params.private ?? false,
    description: params.description,
  });
  return {
    id: data.id,
    name: data.name,
    full_name: data.full_name,
    url: data.html_url,
    private: data.private,
  };
}

// ────────────────────────────────────────────────────────────
// create_file
// ────────────────────────────────────────────────────────────
export async function createFile(
  params: {
    owner?: string;
    repo: string;
    path: string;
    content: string;
    message: string;
    branch?: string;
  },
  claims: PassportClaims,
): Promise<{ sha: string; url: string }> {
  enforceTrust(claims, CREATE_FILE_TOOL);
  const octokit = getOctokit();
  const owner = params.owner ?? getDefaultOwner();
  if (!owner) {
    throw new Error('owner is required — set via params or configure capabilities.github.defaultOwner');
  }
  const { data } = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo: params.repo,
    path: params.path,
    message: params.message,
    content: Buffer.from(params.content).toString('base64'),
    branch: params.branch,
  });
  return {
    sha: data.content?.sha ?? '',
    url: data.content?.html_url ?? '',
  };
}

// ────────────────────────────────────────────────────────────
// create_pull_request
// ────────────────────────────────────────────────────────────
export async function createPullRequest(
  params: {
    owner?: string;
    repo: string;
    title: string;
    body?: string;
    head: string;
    base: string;
  },
  claims: PassportClaims,
): Promise<{ number: number; url: string; state: string }> {
  enforceTrust(claims, CREATE_PULL_REQUEST_TOOL);
  const octokit = getOctokit();
  const owner = params.owner ?? getDefaultOwner();
  if (!owner) {
    throw new Error('owner is required — set via params or configure capabilities.github.defaultOwner');
  }
  const { data } = await octokit.rest.pulls.create({
    owner,
    repo: params.repo,
    title: params.title,
    body: params.body,
    head: params.head,
    base: params.base,
  });
  return {
    number: data.number,
    url: data.html_url,
    state: data.state,
  };
}

// ────────────────────────────────────────────────────────────
// list_repos
// ────────────────────────────────────────────────────────────
export async function listRepos(
  params: {
    type?: 'all' | 'owner' | 'public' | 'private';
    per_page?: number;
  },
  claims: PassportClaims,
): Promise<{ repos: Array<{ id: number; name: string; full_name: string; private: boolean; url: string }> }> {
  enforceTrust(claims, LIST_REPOS_TOOL);
  const octokit = getOctokit();
  const { data } = await octokit.rest.repos.listForAuthenticatedUser({
    type: params.type ?? 'all',
    per_page: params.per_page ?? 30,
  });
  return {
    repos: data.map((r) => ({
      id: r.id,
      name: r.name,
      full_name: r.full_name,
      private: r.private,
      url: r.html_url,
    })),
  };
}
