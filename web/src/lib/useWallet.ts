"use client";

import { useCallback, useEffect, useState } from "react";

export type WalletAccount = {
  wallet_id: string;
  owner: string;
  address: string;
  kind: "byo" | "embedded";
  custody?: string;
};

const STORAGE_KEY = "opentrust.wallet";
const EVENT = "opentrust-wallet-change";

function read(): WalletAccount | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WalletAccount) : null;
  } catch {
    return null;
  }
}

/**
 * Shared wallet state, persisted to localStorage so the connected wallet
 * survives navigation and is visible across the register, jobs, and nav.
 * A custom window event keeps multiple hook instances in sync within a tab.
 */
export function useWallet() {
  const [wallet, setWalletState] = useState<WalletAccount | null>(null);

  useEffect(() => {
    setWalletState(read());
    const sync = () => setWalletState(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setWallet = useCallback((w: WalletAccount) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
    window.dispatchEvent(new Event(EVENT));
    setWalletState(w);
  }, []);

  const clearWallet = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event(EVENT));
    setWalletState(null);
  }, []);

  return { wallet, setWallet, clearWallet };
}

export async function connectWallet(owner: string, address: string): Promise<WalletAccount> {
  const res = await fetch("/api/v1/wallets/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, address, kind: "byo" }),
  });
  if (!res.ok) throw new Error((await res.text()) || "Wallet connection failed");
  return res.json();
}

export function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
