import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TrustError } from '../trust.js';
import type { PassportClaims } from '../types.js';

// ────────────────────────────────────────────────────────────
// Hoisted mocks
// ────────────────────────────────────────────────────────────
const { mockAdd, mockCat, mockPinAdd } = vi.hoisted(() => {
  const mockAdd = vi.fn();
  const mockCat = vi.fn();
  const mockPinAdd = vi.fn();
  return { mockAdd, mockCat, mockPinAdd };
});

vi.mock('kubo-rpc-client', () => ({
  create: vi.fn(() => ({
    add: mockAdd,
    cat: mockCat,
    pin: {
      add: mockPinAdd,
    },
  })),
}));

vi.mock('../config.js', () => ({
  readConfig: vi.fn(),
  CONFIG_DIR: '/tmp/test-haf-ipfs',
  ensureConfigDir: vi.fn(),
}));

import {
  publishContent,
  getIpfsContent,
  pinContent,
} from '../capabilities/ipfs/index.js';

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

function setIpfsUrl(url = 'http://localhost:5001') {
  process.env['IPFS_API_URL'] = url;
}

function clearIpfsUrl() {
  delete process.env['IPFS_API_URL'];
}

beforeEach(() => {
  vi.clearAllMocks();
  setIpfsUrl();
});

afterEach(() => {
  clearIpfsUrl();
});

// ────────────────────────────────────────────────────────────
// publish_content
// ────────────────────────────────────────────────────────────
describe('publish_content', () => {
  it('throws TrustError for L2 caller (needs L3)', async () => {
    await expect(
      publishContent({ content: 'hello world' }, makeL2Claims()),
    ).rejects.toThrow(TrustError);
  });

  it('publishes content and returns CID for L3 caller', async () => {
    mockAdd.mockResolvedValue({
      cid: { toString: () => 'QmTestCid123' },
      path: 'QmTestCid123',
      size: 11,
    });

    const result = await publishContent({ content: 'hello world' }, makeL3Claims());
    expect(result.cid).toBe('QmTestCid123');
    expect(mockAdd).toHaveBeenCalledWith(Buffer.from('hello world'));
  });

  it('uses default URL when IPFS_API_URL not set', async () => {
    clearIpfsUrl();
    mockAdd.mockResolvedValue({ cid: { toString: () => 'QmDefaultUrl' } });

    const result = await publishContent({ content: 'test' }, makeL3Claims());
    expect(result.cid).toBe('QmDefaultUrl');
  });
});

// ────────────────────────────────────────────────────────────
// get_ipfs_content
// ────────────────────────────────────────────────────────────
describe('get_ipfs_content', () => {
  it('throws TrustError for L1 caller (needs L2)', async () => {
    await expect(
      getIpfsContent({ cid: 'QmTest' }, makeL1Claims()),
    ).rejects.toThrow(TrustError);
  });

  it('fetches and returns content for L2 caller', async () => {
    async function* fakeChunks() {
      yield Buffer.from('Hello ');
      yield Buffer.from('IPFS!');
    }
    mockCat.mockReturnValue(fakeChunks());

    const result = await getIpfsContent({ cid: 'QmTestCid123' }, makeL2Claims());
    expect(result.content).toBe('Hello IPFS!');
    expect(result.cid).toBe('QmTestCid123');
    expect(mockCat).toHaveBeenCalledWith('QmTestCid123');
  });
});

// ────────────────────────────────────────────────────────────
// pin_content
// ────────────────────────────────────────────────────────────
describe('pin_content', () => {
  it('throws TrustError for L2 caller (needs L3)', async () => {
    await expect(
      pinContent({ cid: 'QmTest' }, makeL2Claims()),
    ).rejects.toThrow(TrustError);
  });

  it('pins content and returns success for L3 caller', async () => {
    mockPinAdd.mockResolvedValue(undefined);

    const result = await pinContent({ cid: 'QmTestCid456' }, makeL3Claims());
    expect(result.cid).toBe('QmTestCid456');
    expect(result.pinned).toBe(true);
    expect(mockPinAdd).toHaveBeenCalledWith('QmTestCid456');
  });
});
