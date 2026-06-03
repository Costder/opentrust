import Link from "next/link";
import type { Passport } from "@/types/passport";
import { TrustBadge } from "./TrustBadge";
import { ShieldCheck, AlertTriangle, Globe, FileText, Terminal, Wallet, ArrowRight, Server, Sparkles, Wrench, Bot, User } from "lucide-react";

const COMMERCIAL_LABEL: Record<string, { label: string; cls: string }> = {
  free:       { label: "Free",       cls: "bg-green-100 text-green-800" },
  freemium:   { label: "Freemium",   cls: "bg-blue-100 text-blue-800" },
  paid:       { label: "Paid",       cls: "bg-amber-100 text-amber-800" },
  enterprise: { label: "Enterprise", cls: "bg-purple-100 text-purple-800" },
};

// Item-type badge config, keyed off agent_access.kind / source_formats.
const KIND_BADGE: Record<string, { label: string; cls: string; Icon: typeof Server }> = {
  mcp_server:    { label: "MCP Server",    cls: "bg-violet-100 text-violet-800", Icon: Server },
  skill:         { label: "Skill",         cls: "bg-sky-100 text-sky-800",       Icon: Sparkles },
  tool:          { label: "Tool",          cls: "bg-teal-100 text-teal-800",     Icon: Wrench },
  agent_service: { label: "Agent",         cls: "bg-indigo-100 text-indigo-800", Icon: Bot },
  human_service: { label: "Human Service", cls: "bg-rose-100 text-rose-800",     Icon: User },
};

function itemKind(passport: Passport): { label: string; cls: string; Icon: typeof Server } {
  const access = passport.agent_access as { kind?: string } | undefined;
  if (access?.kind && KIND_BADGE[access.kind]) return KIND_BADGE[access.kind];
  const fmts = (passport as { source_formats?: string[] }).source_formats ?? [];
  if (fmts.includes("mcp")) return KIND_BADGE.mcp_server;
  if (fmts.includes("agent")) return KIND_BADGE.agent_service;
  return KIND_BADGE.tool;
}

function commercialOf(passport: Passport) {
  const cs = (passport.commercial_status ?? {}) as { status?: string; model?: string };
  const key = cs.status ?? cs.model ?? "";
  return COMMERCIAL_LABEL[key] ?? { label: key || "—", cls: "bg-stone-100 text-stone-600" };
}

function riskLevel(manifest: Record<string, unknown>): "low" | "medium" | "high" {
  const dangerous = ["wallet", "terminal", "private_data", "browser"];
  const isEnabled = (key: string) => {
    const v = manifest[key];
    if (v === true) return true;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.values(v as Record<string, unknown>).some(
        (sv) => sv === true || (Array.isArray(sv) && sv.length > 0)
      );
    }
    return false;
  };
  const n = dangerous.filter(isEnabled).length;
  if (n === 0) return "low";
  if (n <= 1) return "medium";
  return "high";
}

const PERM_ICONS = [
  { key: "network",  Icon: Globe,     label: "Network" },
  { key: "file",     Icon: FileText,  label: "File" },
  { key: "terminal", Icon: Terminal,  label: "Terminal" },
  { key: "wallet",   Icon: Wallet,    label: "Wallet" },
];

export function PassportCard({ passport }: { passport: Passport }) {
  const commercial = commercialOf(passport);
  const kind = itemKind(passport);
  const risk = riskLevel(passport.permission_manifest ?? {});
  const pricing = (passport.commercial_status as { pricing?: { amount: number; currency: string } })?.pricing;
  const KindIcon = kind.Icon;

  return (
    /* The whole card is a single <Link>. Everything inside is non-interactive
       (plain spans/icons), so clicks anywhere on the card navigate. */
    <Link
      href={`/tools/${passport.slug}`}
      aria-label={`View passport for ${passport.name}`}
      className="panel group flex flex-col gap-3 p-4 transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-2"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-stone-900 group-hover:text-moss">
            {passport.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-stone-400">{passport.slug}</p>
        </div>
        <TrustBadge status={passport.trust_status} />
      </div>

      {/* Type + pricing tags */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${kind.cls}`}>
          <KindIcon className="h-3 w-3" aria-hidden="true" />
          {kind.label}
        </span>
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${commercial.cls}`}>
          {pricing ? `$${pricing.amount} ${pricing.currency}` : commercial.label}
        </span>
      </div>

      {/* Description */}
      {passport.description && (
        <p className="line-clamp-2 text-sm text-stone-600">
          {passport.description}
        </p>
      )}

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-stone-100 pt-2">
        {/* Active permission icons */}
        <div className="flex items-center gap-1.5" aria-label="Active permissions">
          {PERM_ICONS.map(({ key, Icon, label }) => {
            const val = passport.permission_manifest?.[key];
            const active = val === true || (!!val && typeof val === "object" && !Array.isArray(val));
            if (!active) return null;
            return (
              <Icon
                key={key}
                className={`h-3.5 w-3.5 ${["wallet", "terminal"].includes(key) ? "text-signal" : "text-stone-400"}`}
                aria-label={label}
              />
            );
          })}
        </div>

        {/* Risk + arrow */}
        <div className="flex items-center gap-1 text-stone-400">
          {risk === "low"    && <ShieldCheck    className="h-4 w-4 text-moss"        aria-label="Low risk" />}
          {risk === "medium" && <AlertTriangle  className="h-4 w-4 text-amber-500"  aria-label="Medium risk" />}
          {risk === "high"   && <AlertTriangle  className="h-4 w-4 text-signal"     aria-label="High risk" />}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </div>
      </div>
    </Link>
  );
}
