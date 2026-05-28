import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TrustError } from '../trust.js';
import type { PassportClaims } from '../types.js';

// ────────────────────────────────────────────────────────────
// Hoisted mocks
// ────────────────────────────────────────────────────────────
const {
  mockCreateContainer,
  mockGetContainer,
  mockListContainers,
} = vi.hoisted(() => ({
  mockCreateContainer: vi.fn(),
  mockGetContainer: vi.fn(),
  mockListContainers: vi.fn(),
}));

// Mock dockerode default export
vi.mock('dockerode', () => {
  const MockDocker = vi.fn(() => ({
    createContainer: mockCreateContainer,
    getContainer: mockGetContainer,
    listContainers: mockListContainers,
  }));
  return { default: MockDocker };
});

vi.mock('../config.js', () => ({
  readConfig: vi.fn(),
  CONFIG_DIR: '/tmp/test-haf-docker',
  ensureConfigDir: vi.fn(),
}));

import {
  runContainer,
  stopContainer,
  removeContainer,
  listContainers,
  containerLogs,
  execInContainer,
} from '../capabilities/docker/index.js';

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
function makeL4Claims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return {
    passportId: 'p1',
    agentId: 'a1',
    trustLevel: 4,
    trustStatus: 'community_reviewed',
    flags: [],
    isDisputed: false,
    version: '1',
    ...overrides,
  };
}

function makeL3Claims(): PassportClaims {
  return { ...makeL4Claims(), trustLevel: 3, trustStatus: 'seller_confirmed' };
}

function makeL2Claims(): PassportClaims {
  return { ...makeL4Claims(), trustLevel: 2, trustStatus: 'creator_claimed' };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────
// run_container
// ────────────────────────────────────────────────────────────
describe('run_container', () => {
  it('throws TrustError for L3 caller', async () => {
    await expect(runContainer({ image: 'nginx' }, makeL3Claims())).rejects.toThrow(TrustError);
  });

  it('creates and starts container for L4 caller', async () => {
    const fakeContainer = {
      id: 'abc123',
      start: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({
        Name: '/my-container',
        State: { Status: 'running' },
      }),
    };
    mockCreateContainer.mockResolvedValue(fakeContainer);

    const result = await runContainer(
      { image: 'nginx:latest', name: 'my-container' },
      makeL4Claims(),
    );
    expect(result.id).toBe('abc123');
    expect(result.name).toBe('my-container');
    expect(result.status).toBe('running');
    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({ Image: 'nginx:latest', name: 'my-container' }),
    );
    expect(fakeContainer.start).toHaveBeenCalled();
  });

  it('passes env and port bindings to createContainer', async () => {
    const fakeContainer = {
      id: 'def456',
      start: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({ Name: '/test', State: { Status: 'running' } }),
    };
    mockCreateContainer.mockResolvedValue(fakeContainer);

    await runContainer(
      { image: 'redis', env: ['REDIS_PASSWORD=secret'], ports: { '6379': '6379' } },
      makeL4Claims(),
    );
    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Env: ['REDIS_PASSWORD=secret'],
        ExposedPorts: { '6379/tcp': {} },
        HostConfig: { PortBindings: { '6379/tcp': [{ HostPort: '6379' }] } },
      }),
    );
  });
});

// ────────────────────────────────────────────────────────────
// stop_container
// ────────────────────────────────────────────────────────────
describe('stop_container', () => {
  it('throws TrustError for L3 caller', async () => {
    await expect(stopContainer({ id: 'abc' }, makeL3Claims())).rejects.toThrow(TrustError);
  });

  it('stops container for L4 caller', async () => {
    const fakeContainer = { stop: vi.fn().mockResolvedValue(undefined) };
    mockGetContainer.mockReturnValue(fakeContainer);

    const result = await stopContainer({ id: 'abc123' }, makeL4Claims());
    expect(result.stopped).toBe(true);
    expect(fakeContainer.stop).toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────
// remove_container
// ────────────────────────────────────────────────────────────
describe('remove_container', () => {
  it('throws TrustError for L3 caller', async () => {
    await expect(removeContainer({ id: 'abc' }, makeL3Claims())).rejects.toThrow(TrustError);
  });

  it('removes container for L4 caller', async () => {
    const fakeContainer = { remove: vi.fn().mockResolvedValue(undefined) };
    mockGetContainer.mockReturnValue(fakeContainer);

    const result = await removeContainer({ id: 'abc123', force: true }, makeL4Claims());
    expect(result.removed).toBe(true);
    expect(fakeContainer.remove).toHaveBeenCalledWith({ force: true });
  });
});

// ────────────────────────────────────────────────────────────
// list_containers
// ────────────────────────────────────────────────────────────
describe('list_containers', () => {
  it('succeeds for L2 caller', async () => {
    mockListContainers.mockResolvedValue([
      { Id: 'c1', Names: ['/app'], Image: 'nginx', Status: 'running' },
    ]);

    const result = await listContainers({}, makeL2Claims());
    expect(result.containers).toHaveLength(1);
    expect(result.containers[0].Id).toBe('c1');
  });

  it('passes all:true when requested', async () => {
    mockListContainers.mockResolvedValue([]);
    await listContainers({ all: true }, makeL2Claims());
    expect(mockListContainers).toHaveBeenCalledWith({ all: true });
  });
});

// ────────────────────────────────────────────────────────────
// container_logs
// ────────────────────────────────────────────────────────────
describe('container_logs', () => {
  it('succeeds for L2 caller', async () => {
    const fakeContainer = {
      logs: vi.fn().mockResolvedValue(Buffer.from('Hello from container\n')),
    };
    mockGetContainer.mockReturnValue(fakeContainer);

    const result = await containerLogs({ id: 'abc123', tail: 50 }, makeL2Claims());
    expect(result.logs).toContain('Hello from container');
    expect(fakeContainer.logs).toHaveBeenCalledWith({ stdout: true, stderr: true, tail: 50 });
  });
});

// ────────────────────────────────────────────────────────────
// exec_in_container
// ────────────────────────────────────────────────────────────
describe('exec_in_container', () => {
  it('throws TrustError for L3 caller', async () => {
    await expect(
      execInContainer({ id: 'abc', command: ['ls'] }, makeL3Claims()),
    ).rejects.toThrow(TrustError);
  });

  it('executes command for L4 caller', async () => {
    const mockStream = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'data') cb(Buffer.from('output text\n'));
        if (event === 'end') cb();
        return mockStream;
      }),
    };
    const fakeExec = {
      start: vi.fn().mockResolvedValue(mockStream),
      inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }),
    };
    const fakeContainer = {
      exec: vi.fn().mockResolvedValue(fakeExec),
    };
    mockGetContainer.mockReturnValue(fakeContainer);

    const result = await execInContainer(
      { id: 'abc123', command: ['ls', '-la'] },
      makeL4Claims(),
    );
    expect(result.output).toContain('output text');
    expect(result.exit_code).toBe(0);
    expect(fakeContainer.exec).toHaveBeenCalledWith({
      Cmd: ['ls', '-la'],
      AttachStdout: true,
      AttachStderr: true,
    });
  });
});
