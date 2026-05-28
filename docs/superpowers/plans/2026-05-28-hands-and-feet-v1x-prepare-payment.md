# Hands and Feet v1.x — `prepare_payment` Composite Helper

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `prepare_payment` composite MCP tool that detects chain balances, bridges Polygon→Base if needed, polls bridge status until minted, then executes `pay_with_usdc` — all in one tool call. Bridge fees surface in the returned receipt so cost stays visible.

**Architecture:** `prepare_payment` calls existing internal functions (`getBalance`, `bridgeToBase`, `getBridgeStatus`, `payWithUsdc`) without duplicating their logic. It lives at `capabilities/payments/prepare-payment.ts`. The tool is registered in `server.ts` alongside the existing payment tools. Bridge polling uses a configurable timeout (default 30 min, matching the spec). All intermediate state (bridge ID, amounts) is returned in the receipt so the agent can audit what happened.

**Tech Stack:** TypeScript, Vitest, `@modelcontextprotocol/sdk`, ethers v6, existing capabilities

---

## Files

| Action | Path | Responsibility |
|---|---|---|
| Create | `packages/hands-and-feet/src/capabilities/payments/prepare-payment.ts` | Composite tool logic |
| Modify | `packages/hands-and-feet/src/server.ts` | Register `prepare_payment` tool |
| Create | `packages/hands-and-feet/src/__tests__/prepare-payment.test.ts` | Unit tests |

---

## Task 1: Create `prepare-payment.ts`

**Files:**
- Create: `packages/hands-and-feet/src/capabilities/payments/prepare-payment.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/hands-and-feet/src/__tests__/prepare-payment.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { preparePayment, PreparePaymentResult } from '../capabilities/payments/prepare-payment.js';
import type { HandsAndFeetConfig } from '../types.js';

// Mock the dependencies
vi.mock('../capabilities/wallet/index.js', () => ({
  getBalance: vi.fn(),
}));
vi.mock('../capabilities/bridge/index.js', () => ({
  bridgeToBase: vi.fn(),
  getBridgeStatus: vi.fn(),
}));
vi.mock('../capabilities/payments/index.js', () => ({
  payWithUsdc: vi.fn(),
}));

import { getBalance } from '../capabilities/wallet/index.js';
import { bridgeToBase, getBridgeStatus } from '../capabilities/bridge/index.js';
import { payWithUsdc } from '../capabilities/payments/index.js';

const mockConfig: HandsAndFeetConfig = {
  registryUrl: 'http://localhost:4000',
  instanceId: 'test-instance',
  capabilities: {},
};

describe('preparePayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pays directly when Base balance is sufficient', async () => {
    vi.mocked(getBalance).mockResolvedValueOnce({ balance: '100.00', token: 'USDC', chain: 'base' });
    vi.mocked(payWithUsdc).mockResolvedValueOnce({ txHash: '0xabc', status: 'broadcast' });

    const result = await preparePayment({
      fromLabel: 'my-wallet',
      toAddress: '0x' + 'b'.repeat(40),
      amount: '25.00',
      config: mockConfig,
    });

    expect(result.bridged).toBe(false);
    expect(result.paymentTxHash).toBe('0xabc');
    expect(result.bridgeFeeUsdc).toBeUndefined();
    expect(getBalance).toHaveBeenCalledWith(expect.objectContaining({ chain: 'base' }));
    expect(bridgeToBase).not.toHaveBeenCalled();
  });

  it('bridges Polygon→Base when Base balance is insufficient', async () => {
    // Base has 5 USDC — not enough for 25
    vi.mocked(getBalance)
      .mockResolvedValueOnce({ balance: '5.00', token: 'USDC', chain: 'base' })
      // Polygon has 50 USDC — enough to bridge
      .mockResolvedValueOnce({ balance: '50.00', token: 'USDC', chain: 'polygon' });

    vi.mocked(bridgeToBase).mockResolvedValueOnce({
      bridgeId: 'bridge-123',
      status: 'locked',
      amountBridged: '25.00',
      feePaidUsdc: '0.15',
    });

    vi.mocked(getBridgeStatus)
      .mockResolvedValueOnce({ status: 'in-flight' })
      .mockResolvedValueOnce({ status: 'minted' });

    vi.mocked(payWithUsdc).mockResolvedValueOnce({ txHash: '0xdef', status: 'broadcast' });

    const result = await preparePayment({
      fromLabel: 'my-wallet',
      toAddress: '0x' + 'b'.repeat(40),
      amount: '25.00',
      config: mockConfig,
    });

    expect(result.bridged).toBe(true);
    expect(result.bridgeId).toBe('bridge-123');
    expect(result.bridgeFeeUsdc).toBe('0.15');
    expect(result.paymentTxHash).toBe('0xdef');
    expect(bridgeToBase).toHaveBeenCalledOnce();
    expect(getBridgeStatus).toHaveBeenCalledTimes(2);
  });

  it('throws if Polygon balance is also insufficient', async () => {
    vi.mocked(getBalance)
      .mockResolvedValueOnce({ balance: '5.00', token: 'USDC', chain: 'base' })
      .mockResolvedValueOnce({ balance: '10.00', token: 'USDC', chain: 'polygon' });

    await expect(
      preparePayment({
        fromLabel: 'my-wallet',
        toAddress: '0x' + 'b'.repeat(40),
        amount: '25.00',
        config: mockConfig,
      })
    ).rejects.toThrow(/insufficient/i);
  });

  it('throws if bridge times out (stuck status)', async () => {
    vi.mocked(getBalance)
      .mockResolvedValueOnce({ balance: '5.00', token: 'USDC', chain: 'base' })
      .mockResolvedValueOnce({ balance: '50.00', token: 'USDC', chain: 'polygon' });

    vi.mocked(bridgeToBase).mockResolvedValueOnce({
      bridgeId: 'bridge-timeout',
      status: 'locked',
      amountBridged: '25.00',
      feePaidUsdc: '0.15',
    });

    vi.mocked(getBridgeStatus).mockResolvedValue({ status: 'stuck' });

    await expect(
      preparePayment({
        fromLabel: 'my-wallet',
        toAddress: '0x' + 'b'.repeat(40),
        amount: '25.00',
        config: mockConfig,
        bridgePollIntervalMs: 1,
        bridgeTimeoutMs: 5,
      })
    ).rejects.toThrow(/stuck|timeout/i);
  });

  it('returns memo in receipt when provided', async () => {
    vi.mocked(getBalance).mockResolvedValueOnce({ balance: '100.00', token: 'USDC', chain: 'base' });
    vi.mocked(payWithUsdc).mockResolvedValueOnce({ txHash: '0xabc', status: 'broadcast' });

    const result = await preparePayment({
      fromLabel: 'my-wallet',
      toAddress: '0x' + 'b'.repeat(40),
      amount: '10.00',
      memo: 'invoice-42',
      config: mockConfig,
    });

    expect(result.memo).toBe('invoice-42');
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd packages/hands-and-feet && npm test -- --reporter=verbose src/__tests__/prepare-payment.test.ts
```
Expected: `Cannot find module '../capabilities/payments/prepare-payment.js'`

- [ ] **Step 3: Create `prepare-payment.ts`**

```typescript
/**
 * prepare_payment — composite MCP tool.
 *
 * Detects Base USDC balance. If insufficient, bridges from Polygon, polls
 * until minted, then executes pay_with_usdc. Returns a full receipt so the
 * agent (and the human) can audit every step and cost.
 *
 * Explicit-bridging rule is preserved: this is a convenience wrapper, NOT
 * automatic routing. The agent opted in by calling prepare_payment.
 */

import { getBalance } from '../wallet/index.js';
import { bridgeToBase, getBridgeStatus } from '../bridge/index.js';
import { payWithUsdc } from './index.js';
import type { HandsAndFeetConfig } from '../../types.js';

export interface PreparePaymentParams {
  fromLabel: string;
  toAddress: string;
  amount: string;          // USDC amount as decimal string, e.g. "25.00"
  memo?: string;
  config: HandsAndFeetConfig;
  bridgePollIntervalMs?: number;  // default 15_000 (15s)
  bridgeTimeoutMs?: number;       // default 1_800_000 (30min)
}

export interface PreparePaymentResult {
  bridged: boolean;
  bridgeId?: string;
  bridgeFeeUsdc?: string;
  amountBridged?: string;
  paymentTxHash: string;
  paymentStatus: string;
  totalCostUsdc: string;  // amount + bridgeFee (if bridged)
  memo?: string;
}

export async function preparePayment(params: PreparePaymentParams): Promise<PreparePaymentResult> {
  const {
    fromLabel,
    toAddress,
    amount,
    memo,
    config,
    bridgePollIntervalMs = 15_000,
    bridgeTimeoutMs = 1_800_000,
  } = params;

  const amountNum = parseFloat(amount);

  // 1. Check Base balance
  const baseBalance = await getBalance({ label: fromLabel, token: 'USDC', chain: 'base', config });
  const baseNum = parseFloat(baseBalance.balance);

  let bridgeId: string | undefined;
  let bridgeFeeUsdc: string | undefined;
  let amountBridged: string | undefined;
  let bridged = false;

  if (baseNum >= amountNum) {
    // Sufficient on Base — pay directly
  } else {
    // 2. Check Polygon balance
    const polygonBalance = await getBalance({ label: fromLabel, token: 'USDC', chain: 'polygon', config });
    const polygonNum = parseFloat(polygonBalance.balance);

    if (polygonNum < amountNum) {
      throw new Error(
        `Insufficient USDC balance: Base has ${baseBalance.balance} USDC, ` +
        `Polygon has ${polygonBalance.balance} USDC — need ${amount} USDC to proceed. ` +
        `Top up either wallet and retry.`
      );
    }

    // 3. Bridge Polygon → Base
    const bridgeResult = await bridgeToBase({ fromLabel, amount, config });
    bridgeId = bridgeResult.bridgeId;
    bridgeFeeUsdc = bridgeResult.feePaidUsdc;
    amountBridged = bridgeResult.amountBridged;
    bridged = true;

    // 4. Poll bridge until minted or timeout
    const deadline = Date.now() + bridgeTimeoutMs;
    while (Date.now() < deadline) {
      const statusResult = await getBridgeStatus({ bridgeId, config });
      if (statusResult.status === 'minted') break;
      if (statusResult.status === 'stuck' || statusResult.status === 'failed') {
        throw new Error(
          `Bridge ${bridgeId} is ${statusResult.status}. ` +
          `Funds are safe — check https://across.to for recovery. ` +
          `bridge_id: ${bridgeId}`
        );
      }
      await new Promise(resolve => setTimeout(resolve, bridgePollIntervalMs));
    }

    // Check if we actually minted (could have exited loop via timeout)
    const finalStatus = await getBridgeStatus({ bridgeId, config });
    if (finalStatus.status !== 'minted') {
      throw new Error(
        `Bridge ${bridgeId} timed out after ${bridgeTimeoutMs}ms (status: ${finalStatus.status}). ` +
        `Funds are safe — check https://across.to. bridge_id: ${bridgeId}`
      );
    }
  }

  // 5. Execute payment on Base
  const payResult = await payWithUsdc({ fromLabel, toAddress, amount, memo, config });

  const fee = parseFloat(bridgeFeeUsdc ?? '0');
  const totalCost = (amountNum + fee).toFixed(6).replace(/\.?0+$/, '');

  return {
    bridged,
    bridgeId,
    bridgeFeeUsdc,
    amountBridged,
    paymentTxHash: payResult.txHash,
    paymentStatus: payResult.status,
    totalCostUsdc: totalCost,
    memo,
  };
}

export const PREPARE_PAYMENT_TOOL = {
  name: 'prepare_payment',
  description:
    'Composite payment helper. Checks Base USDC balance; if insufficient, bridges from Polygon ' +
    '(using Across Protocol), polls until minted, then executes pay_with_usdc. Returns a full ' +
    'receipt including bridge fee so total cost is visible. Bridge fees are non-zero when bridging ' +
    'occurs (~0.1–0.5 USDC). Use this instead of manually chaining bridge_to_base + pay_with_usdc.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      from_label:  { type: 'string', description: 'Wallet label to pay from' },
      to_address:  { type: 'string', description: 'Recipient EVM address (0x...)' },
      amount:      { type: 'string', description: 'USDC amount as decimal string, e.g. "25.00"' },
      memo:        { type: 'string', description: 'Optional memo / invoice reference' },
    },
    required: ['from_label', 'to_address', 'amount'],
  },
} as const;
```

- [ ] **Step 4: Run tests**

```bash
cd packages/hands-and-feet && npm test -- src/__tests__/prepare-payment.test.ts
```
Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/hands-and-feet/src/capabilities/payments/prepare-payment.ts \
        packages/hands-and-feet/src/__tests__/prepare-payment.test.ts
git commit -m "feat(hands-and-feet v1.x): add prepare_payment composite tool with bridge-then-pay logic"
```

---

## Task 2: Register `prepare_payment` in `server.ts`

**Files:**
- Modify: `packages/hands-and-feet/src/server.ts`

- [ ] **Step 1: Write the integration test**

Add to `packages/hands-and-feet/src/__tests__/server.test.ts` (find the `ListTools` test class):

```typescript
it('includes prepare_payment in tool list', async () => {
  const response = await request(app)
    .post('/mcp')
    .set('Authorization', 'Bearer valid-token')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

  const tools: { name: string }[] = response.body?.result?.tools ?? [];
  const names = tools.map((t) => t.name);
  expect(names).toContain('prepare_payment');
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/hands-and-feet && npm test -- src/__tests__/server.test.ts
```
Expected: the new test fails (`prepare_payment` not found)

- [ ] **Step 3: Add import and registration in `server.ts`**

In `packages/hands-and-feet/src/server.ts`, add the import alongside the other payment imports:

```typescript
import { preparePayment, PREPARE_PAYMENT_TOOL } from './capabilities/payments/prepare-payment.js';
```

In the `ListToolsRequestSchema` handler where tools are built, add `PREPARE_PAYMENT_TOOL`:

```typescript
// Payments
{
  name: PREPARE_PAYMENT_TOOL.name,
  description: PREPARE_PAYMENT_TOOL.description,
  inputSchema: PREPARE_PAYMENT_TOOL.inputSchema,
},
```

In the `CallToolRequestSchema` handler, add a case for `prepare_payment`:

```typescript
case 'prepare_payment': {
  const r = await preparePayment({
    fromLabel: String(args.from_label),
    toAddress: String(args.to_address),
    amount: String(args.amount),
    memo: args.memo ? String(args.memo) : undefined,
    config,
  });
  return {
    content: [{ type: 'text', text: JSON.stringify(r, null, 2) }],
  };
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/hands-and-feet && npm test -- src/__tests__/server.test.ts
```
Expected: all PASS including new test

- [ ] **Step 5: Run full test suite**

```bash
cd packages/hands-and-feet && npm test
```
Expected: all 328+ tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/hands-and-feet/src/server.ts
git commit -m "feat(hands-and-feet v1.x): register prepare_payment in MCP server"
```

---

## Task 3: Typecheck and build

- [ ] **Step 1: Typecheck**

```bash
cd packages/hands-and-feet && npm run typecheck
```
Expected: 0 errors

- [ ] **Step 2: Build**

```bash
npm run build
```
Expected: `dist/` populated

- [ ] **Step 3: Bump package version to `0.2.0`**

In `packages/hands-and-feet/package.json`, update `"version": "0.1.0"` → `"version": "0.2.0"`.

- [ ] **Step 4: Commit and tag**

```bash
git add packages/hands-and-feet/package.json
git commit -m "chore(hands-and-feet): bump to v0.2.0 — prepare_payment composite tool"
git tag hands-and-feet-v0.2.0
```

---

## Self-review checklist

- [x] `prepare_payment` uses existing `getBalance`, `bridgeToBase`, `getBridgeStatus`, `payWithUsdc` — no duplication → Task 1
- [x] No bridge if Base balance is sufficient — bridge skipped → Task 1 test
- [x] Bridge fires when Base is short, Polygon is enough → Task 1 test
- [x] Both wallets insufficient → `InsufficientError` with clear message → Task 1 test
- [x] Bridge stuck/failed → throws with bridge_id and recovery URL → Task 1 test
- [x] Bridge timeout → throws with status → Task 1 test
- [x] `totalCostUsdc` = amount + bridge fee → Task 1 (receipt)
- [x] `memo` in receipt when provided → Task 1 test
- [x] Tool registered and visible in `tools/list` → Task 2
- [x] TypeScript compiles clean → Task 3
