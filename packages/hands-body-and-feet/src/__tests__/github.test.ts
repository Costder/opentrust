import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TrustError } from '../trust.js';
import { SecretsError } from '../secrets.js';
import type { PassportClaims } from '../types.js';

// ────────────────────────────────────────────────────────────
// Hoisted mocks
// ────────────────────────────────────────────────────────────
const {
  mockCreateForAuthenticatedUser,
  mockCreateOrUpdateFileContents,
  mockPullsCreate,
  mockListForAuthenticatedUser,
} = vi.hoisted(() => ({
  mockCreateForAuthenticatedUser: vi.fn(),
  mockCreateOrUpdateFileContents: vi.fn(),
  mockPullsCreate: vi.fn(),
  mockListForAuthenticatedUser: vi.fn(),
}));

vi.mock('@octokit/rest', () => {
  const MockOctokit = vi.fn().mockImplementation(function () {
    return {
      rest: {
        repos: {
          createForAuthenticatedUser: mockCreateForAuthenticatedUser,
          createOrUpdateFileContents: mockCreateOrUpdateFileContents,
          listForAuthenticatedUser: mockListForAuthenticatedUser,
        },
        pulls: {
          create: mockPullsCreate,
        },
      },
    };
  });
  return { Octokit: MockOctokit };
});

vi.mock('../config.js', () => ({
  readConfig: vi.fn(() => ({
    version: 1,
    instanceId: 'test',
    registryUrl: 'http://localhost:8000',
    passphraseHash: 'hash',
    capabilities: {
      github: { defaultOwner: 'test-owner' },
    },
  })),
  CONFIG_DIR: '/tmp/test-haf-github',
  ensureConfigDir: vi.fn(),
}));

import {
  createRepo,
  createFile,
  createPullRequest,
  listRepos,
} from '../capabilities/github/index.js';

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
function makeL3Claims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return {
    passportId: 'p1',
    agentId: 'a1',
    trustLevel: 3,
    trustStatus: 'seller_confirmed',
    flags: [],
    isDisputed: false,
    version: '1',
    ...overrides,
  };
}

function makeL2Claims(): PassportClaims {
  return { ...makeL3Claims(), trustLevel: 2, trustStatus: 'creator_claimed' };
}

function makeL1Claims(): PassportClaims {
  return { ...makeL3Claims(), trustLevel: 1, trustStatus: 'auto_generated_draft' };
}

function setGithubToken() {
  process.env['GITHUB_TOKEN'] = 'ghp_test_token';
}

function clearGithubToken() {
  delete process.env['GITHUB_TOKEN'];
}

beforeEach(() => {
  vi.clearAllMocks();
  setGithubToken();
});

afterEach(() => {
  clearGithubToken();
});

// ────────────────────────────────────────────────────────────
// list_repos
// ────────────────────────────────────────────────────────────
describe('list_repos', () => {
  it('throws TrustError for L1 caller (needs L2)', async () => {
    await expect(listRepos({}, makeL1Claims())).rejects.toThrow(TrustError);
  });

  it('succeeds for L2 caller', async () => {
    mockListForAuthenticatedUser.mockResolvedValue({
      data: [
        { id: 1, name: 'my-repo', full_name: 'test-owner/my-repo', private: false, html_url: 'https://github.com/test-owner/my-repo' },
      ],
    });

    const result = await listRepos({ type: 'all', per_page: 10 }, makeL2Claims());
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].name).toBe('my-repo');
    expect(mockListForAuthenticatedUser).toHaveBeenCalledWith({ type: 'all', per_page: 10 });
  });
});

// ────────────────────────────────────────────────────────────
// create_repo
// ────────────────────────────────────────────────────────────
describe('create_repo', () => {
  it('throws TrustError for L2 caller (needs L3)', async () => {
    await expect(createRepo({ name: 'new-repo' }, makeL2Claims())).rejects.toThrow(TrustError);
  });

  it('creates repository for L3 caller', async () => {
    mockCreateForAuthenticatedUser.mockResolvedValue({
      data: {
        id: 42,
        name: 'new-repo',
        full_name: 'test-owner/new-repo',
        html_url: 'https://github.com/test-owner/new-repo',
        private: false,
      },
    });

    const result = await createRepo({ name: 'new-repo', private: false, description: 'Test repo' }, makeL3Claims());
    expect(result.id).toBe(42);
    expect(result.name).toBe('new-repo');
    expect(result.full_name).toBe('test-owner/new-repo');
    expect(mockCreateForAuthenticatedUser).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'new-repo', private: false, description: 'Test repo' }),
    );
  });
});

// ────────────────────────────────────────────────────────────
// create_file
// ────────────────────────────────────────────────────────────
describe('create_file', () => {
  it('throws TrustError for L2 caller (needs L3)', async () => {
    await expect(
      createFile({ repo: 'my-repo', path: 'README.md', content: 'hello', message: 'add readme' }, makeL2Claims()),
    ).rejects.toThrow(TrustError);
  });

  it('creates file with base64-encoded content for L3 caller', async () => {
    mockCreateOrUpdateFileContents.mockResolvedValue({
      data: {
        content: {
          sha: 'abc123sha',
          html_url: 'https://github.com/test-owner/my-repo/blob/main/README.md',
        },
      },
    });

    const result = await createFile(
      { repo: 'my-repo', path: 'README.md', content: 'Hello world', message: 'Add README' },
      makeL3Claims(),
    );
    expect(result.sha).toBe('abc123sha');
    expect(mockCreateOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'my-repo',
        path: 'README.md',
        message: 'Add README',
        content: Buffer.from('Hello world').toString('base64'),
      }),
    );
  });
});

// ────────────────────────────────────────────────────────────
// create_pull_request
// ────────────────────────────────────────────────────────────
describe('create_pull_request', () => {
  it('throws TrustError for L2 caller (needs L3)', async () => {
    await expect(
      createPullRequest({ repo: 'my-repo', title: 'My PR', head: 'feature', base: 'main' }, makeL2Claims()),
    ).rejects.toThrow(TrustError);
  });

  it('creates pull request for L3 caller', async () => {
    mockPullsCreate.mockResolvedValue({
      data: {
        number: 7,
        html_url: 'https://github.com/test-owner/my-repo/pull/7',
        state: 'open',
      },
    });

    const result = await createPullRequest(
      { repo: 'my-repo', title: 'My PR', body: 'Description', head: 'feature', base: 'main' },
      makeL3Claims(),
    );
    expect(result.number).toBe(7);
    expect(result.state).toBe('open');
    expect(mockPullsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'my-repo',
        title: 'My PR',
        head: 'feature',
        base: 'main',
      }),
    );
  });
});

// ────────────────────────────────────────────────────────────
// Missing GITHUB_TOKEN
// ────────────────────────────────────────────────────────────
describe('missing GITHUB_TOKEN', () => {
  it('throws SecretsError when GITHUB_TOKEN is not set', async () => {
    clearGithubToken();
    await expect(listRepos({}, makeL2Claims())).rejects.toThrow(SecretsError);
  });
});
