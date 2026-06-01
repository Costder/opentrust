"use client";

/**
 * Minimal EIP-1193 browser-wallet bridge (MetaMask, Coinbase Wallet, Rabby,
 * Brave — anything that injects window.ethereum). No external dependency.
 *
 * We use this for two things:
 *  - reading the connected account address (so the user doesn't type it)
 *  - signing the OpenTrust verification challenge via personal_sign, which the
 *    backend recovers with eth_account.recover_message (EIP-191 / defunct hash).
 */

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function hasBrowserWallet(): boolean {
  return typeof window !== "undefined" && !!window.ethereum;
}

/** Prompt the wallet to connect and return the selected account address. */
export async function requestBrowserAccount(): Promise<string> {
  if (!window.ethereum) throw new Error("No browser wallet detected. Install MetaMask or use bring-your-own.");
  const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts || accounts.length === 0) throw new Error("No account authorized.");
  return accounts[0];
}

/**
 * Sign an arbitrary UTF-8 message with personal_sign.
 *
 * personal_sign produces an EIP-191 ("\x19Ethereum Signed Message:\n") signature
 * — exactly what eth_account's encode_defunct + recover_message expect on the
 * backend, so the signature verifies without any extra encoding.
 */
export async function personalSign(message: string, address: string): Promise<string> {
  if (!window.ethereum) throw new Error("No browser wallet detected.");
  const signature = (await window.ethereum.request({
    method: "personal_sign",
    params: [message, address],
  })) as string;
  return signature;
}

const USDC_DECIMALS = 6;

/** Left-pad a hex string (no 0x) to 64 chars for ABI encoding. */
function pad32(hex: string): string {
  return hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

/** Encode an erc-20 transfer(address,uint256) call as 0x-prefixed calldata. */
export function encodeUsdcTransfer(to: string, amountUsdc: string): string {
  // function selector for transfer(address,uint256) = 0xa9059cbb
  const selector = "a9059cbb";
  // amount in base units (USDC has 6 decimals) — parse decimal string safely
  const [whole, frac = ""] = amountUsdc.split(".");
  const fracPadded = (frac + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  const baseUnits = BigInt(whole + fracPadded);
  return "0x" + selector + pad32(to) + pad32(baseUnits.toString(16));
}

/** Ensure the wallet is on the given chainId; request a switch if not. */
export async function ensureChain(chainId: number): Promise<void> {
  if (!window.ethereum) throw new Error("No browser wallet detected.");
  const hexChain = "0x" + chainId.toString(16);
  const current = (await window.ethereum.request({ method: "eth_chainId" })) as string;
  if (current?.toLowerCase() === hexChain) return;
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChain }] });
  } catch (err) {
    throw new Error(`Please switch your wallet to chain ${chainId} (Base) and try again.`);
  }
}

/**
 * Send a USDC transfer on Base from `from` to `to`. Returns the tx hash.
 * The wallet prompts the user to confirm; we never hold the key.
 */
export async function sendUsdc(params: {
  from: string;
  to: string;
  amountUsdc: string;
  usdcContract: string;
  chainId: number;
}): Promise<string> {
  if (!window.ethereum) throw new Error("No browser wallet detected.");
  await ensureChain(params.chainId);
  const data = encodeUsdcTransfer(params.to, params.amountUsdc);
  const txHash = (await window.ethereum.request({
    method: "eth_sendTransaction",
    params: [{ from: params.from, to: params.usdcContract, data, value: "0x0" }],
  })) as string;
  return txHash;
}
