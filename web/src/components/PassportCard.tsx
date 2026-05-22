import Link from "next/link";
import type { Passport } from "@/types/passport";
import { TrustBadge } from "./TrustBadge";
import { ShieldCheck, AlertTriangle, Globe, FileText, Terminal, Wallet } from "lucide-react";

const COMMERCIAL_LABEL: Record<string, { label: string; cls: string }> = {
  free:       { label: "Free",       cls: "bg-green-100 text-green-800" },
  freemium:   { label: "Freemium",   cls: "bg-blue-100 text-blue-800" },
  paid:       { label: "Paid",       cls: "bg-amber-100 text-amber-800" },
  enterprise: { label: "Enterprise", cls: "bg-purple-100 text-purple-800" },
};

function riskLevel(manifest: Record<string, unknown>): "low" | "medium" | "high" {
  const dangerous = ["wallet", "terminal", "private_data", "browser"];
  const hasTrue = (key: string) => {
    const v = manifest[key];
    if (v === true) return true;
    if (v && typeof v === "object") {
      // object-form: if any sub-key looks like a truthy capability, treat as enabled
      const vals = Object.values(v as Record<string, unknown>);
      return vals.some((sv) => sv === true || (Array.isArray(sv) && sv.length > 0));
    }
    return false;
  };
  const riskCount = dangerous.filter(hasTrue).length;
  if (riskCount === 0) return "low";
  if (riskCount <= 1) return "medium";
  return "high";
}

const PERM_ICONS = [
  { key: "network",      Icon: Globe },
  { key: "file",         Icon: FileText },
  { key: "terminal",     Icon: Terminal },
  { key: "wallet",       Icon: Wallet },
];

export function PassportCard({ passport }: { passport: Passport }) {
  const commercial = COMMERCIAL_LABEL[passport.commercial_status?.status ?? ""] ?? { label: passport.commercial_status?.status ?? "—", cls: "bg-stone-100 text-stone-600" };
  const risk = riskLevel(passport.permission_manifest ?? {});

  return (
    <article className="panel p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/tools/${passport.slug}`}
            className="block truncate font-semibold text-stone-900 hover:text-moss transition-colors"
          >
            {passport.name}
          </Link>
          <p className="mt-0.5 text-xs text-stone-400">{passport.slug}</p>
        </div>
        <TrustBadge status={passport.trust_status} />
      </div>

      {/* Description */}
      {passport.description && (
        <p className="text-sm text-stone-600 line-clamp-2">{passport.description}</p>
      )}

      {/* Footer row */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1 border-t border-stone-100">
        {/* Commercial badge */}
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${commercial.cls}`}>
          {commercial.label}
        </span>

        {/* Permission icons */}
        <div className="flex items-center gap-1.5" aria-label="Permissions">
          {PERM_ICONS.map(({ key, Icon }) => {
            const val = passport.permission_manifest?.[key];
            const active = val === true || (!!val && typeof val === "object");
            if (!active) return null;
            return (
              <Icon
                key={key}
                className={`h-3.5 w-3.5 ${["wallet", "terminal"].includes(key) ? "text-signal" : "text-stone-400"}`}
                aria-label={key}
              />
            );
          })}
        </div>

        {/* Risk indicator */}
        <div className="flex items-center gap-1">
          {risk === "low" && <ShieldCheck className="h-4 w-4 text-moss" aria-label="Low risk" />}
          {risk === "medium" && <AlertTriangle className="h-4 w-4 text-amber-500" aria-label="Medium risk" />}
          {risk === "high" && <AlertTriangle className="h-4 w-4 text-signal" aria-label="High risk" />}
        </div>
      </div>
    </article>
  );
}
