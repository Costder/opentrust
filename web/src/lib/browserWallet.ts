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
