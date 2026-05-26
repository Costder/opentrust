import Link from "next/link";
import type { Passport } from "@/types/passport";
import { TrustBadge } from "./TrustBadge";
import { ShieldCheck, AlertTriangle, Globe, FileText, Terminal, Wallet, ArrowRight } from "lucide-react";

const COMMERCIAL_LABEL: Record<string, { label: string; cls: string }> = {
  free:       { label: "Free",       cls: "bg-green-100 text-green-800" },
  freemium:   { label: "Freemium",   cls: "bg-blue-100 text-blue-800" },
  paid:       { label: "Paid",       cls: "bg-amber-100 text-amber-800" },
  enterprise: { label: "Enterprise", cls: "bg-purple-100 text-purple-800" },
};

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
  const commercial =
    COMMERCIAL_LABEL[passport.commercial_status?.status ?? ""] ??
    { label: passport.commercial_status?.status ?? "—", cls: "bg-stone-100 text-stone-600" };
  const risk = riskLevel(passport.permission_manifest ?? {});
  const pricing = (passport.commercial_status as { pricing?: { amount: number; currency: string } })?.pricing;

  return (
    /* Outer article is the card boundary. The invisible <Link> stretches over
       the entire card; individual interactive bits sit on top via relative z-10. */
    <article className="panel relative flex flex-col gap-3 p-4 transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-moss focus-within:ring-offset-2">

      {/* Full-card clickable overlay */}
      <Link
        href={`/tools/${passport.slug}`}
        className="absolute inset-0 rounded-lg"
        aria-label={`View passport for ${passport.name}`}
        tabIndex={0}
      />

      {/* Header */}
      <div className="relative z-10 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-stone-900 group-hover:text-moss">
            {passport.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-stone-400">{passport.slug}</p>
        </div>
        <TrustBadge status={passport.trust_status} />
      </div>

      {/* Description */}
      {passport.description && (
        <p className="relative z-10 line-clamp-2 text-sm text-stone-600">
          {passport.description}
        </p>
      )}

      {/* Footer */}
      <div className="relative z-10 mt-auto flex items-center justify-between gap-2 border-t border-stone-100 pt-2">
        {/* Pricing */}
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${commercial.cls}`}>
          {pricing ? `$${pricing.amount} ${pricing.currency}` : commercial.label}
        </span>

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
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </div>
      </div>
    </article>
  );
}
