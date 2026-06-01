"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExternalLink, Wallet } from "lucide-react";
import { useWallet, truncateAddress } from "@/lib/useWallet";

const NAV_LINKS = [
  { href: "/tools",       label: "Tools" },
  { href: "/jobs",        label: "Jobs" },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/register",    label: "Register" },
  { href: "/demo",        label: "Demo" },
];

export function Navigation() {
  const pathname = usePathname();
  const { wallet } = useWallet();

  return (
    <nav className="border-b border-stone-300 bg-paper/90 backdrop-blur-sm sticky top-0 z-50">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-bold text-stone-900 hover:text-moss transition-colors">
          OpenTrust
        </Link>

        <div className="flex items-center gap-1 text-sm">
          {NAV_LINKS.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                  active
                    ? "bg-stone-200 text-stone-900"
                    : "text-stone-500 hover:bg-stone-100 hover:text-stone-900"
                }`}
              >
                {label}
              </Link>
            );
          })}

          <a
            href={`${process.env.NEXT_PUBLIC_API_URL || ""}/docs`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-3 py-1.5 font-medium text-stone-500 transition hover:bg-stone-50 hover:text-stone-800"
            aria-label="OpenAPI docs (opens in new tab)"
          >
            API docs
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>

          {wallet && (
            <span
              className="ml-2 inline-flex items-center gap-1.5 rounded-md border border-moss/30 bg-green-50 px-3 py-1.5 font-mono text-xs font-medium text-green-800"
              title={`Connected: ${wallet.address}`}
            >
              <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
              {truncateAddress(wallet.address)}
            </span>
          )}
        </div>
      </div>
    </nav>
  );
}
