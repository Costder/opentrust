import { notFound } from "next/navigation";
import Link from "next/link";
import { getTool } from "@/lib/api";
import { TrustBadge } from "@/components/TrustBadge";
import { PermissionTable } from "@/components/PermissionTable";
import {
  ArrowLeft,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  CheckCircle2,
  GitCommit,
  Package,
  Globe,
  User,
  Coins,
  BookOpen,
  Microscope,
} from "lucide-react";
import type { TrustStatus } from "@/types/passport";
import { CopyButton } from "@/components/CopyButton";

// ── Trust ladder ──────────────────────────────────────────────────────────────

const TRUST_LADDER: { status: TrustStatus; label: string; desc: string }[] = [
  { status: "auto_generated_draft",   label: "Draft",              desc: "AI-generated, no human review" },
  { status: "creator_claimed",        label: "Claimed",            desc: "Creator confirmed ownership" },
  { status: "seller_confirmed",       label: "Seller Confirmed",   desc: "Seller verified metadata" },
  { status: "community_reviewed",     label: "Community",          desc: "Community feedback received" },
  { status: "reviewer_signed",        label: "Reviewer Signed",    desc: "Technical reviewer attested" },
  { status: "security_checked",       label: "Security Checked",   desc: "Passed defined security checks" },
  { status: "continuously_monitored", label: "Monitored",          desc: "Version/dependency tracking active" },
];

const TRUST_ORDER: Record<TrustStatus, number> = Object.fromEntries(
  TRUST_LADDER.map((l, i) => [l.status, i])
) as Record<TrustStatus, number>;

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, children, icon: Icon }: {
  title: string;
  children: React.ReactNode;
  icon?: React.ElementType;
}) {
  return (
    <section className="panel p-5">
      <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-stone-900">
        {Icon && <Icon className="h-4 w-4 text-stone-400" aria-hidden="true" />}
        {title}
      </h2>
      {children}
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-stone-100 py-2.5 last:border-0">
      <span className="shrink-0 text-sm text-stone-500">{label}</span>
      <span className="text-right text-sm font-medium text-stone-900">{value}</span>
    </div>
  );
}

// ── Server component ──────────────────────────────────────────────────────────

export default async function ToolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tool = await getTool(slug);
  if (!tool) notFound();

  const currentLevel = TRUST_ORDER[tool.trust_status as TrustStatus] ?? 0;
  const isDisputed = tool.trust_status === "disputed";
  const pricing = (tool.commercial_status as { pricing?: { amount: number; currency: string } })?.pricing;
  const paymentConfig = (tool.commercial_status as { payment_config?: { network: string; wallet_address: string } })?.payment_config;

  const badgeMarkdown = `![OpenTrust](https://api-kappa-pied-59.vercel.app/api/v1/badge/${slug}.svg)`;

  return (
    <div className="mx-auto max-w-4xl space-y-6">

      {/* Back link */}
      <Link
        href="/tools"
        className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-900 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Tool Directory
      </Link>

      {/* ── Hero header ─────────────────────────────────────────────────────── */}
      <header className="panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-stone-900">{tool.name}</h1>
            <p className="mt-0.5 font-mono text-sm text-stone-400">{tool.slug}</p>
            {tool.description && (
              <p className="mt-3 max-w-2xl text-stone-600">{tool.description}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <TrustBadge status={tool.trust_status as TrustStatus} />
            <Link
              href={`/claim/${tool.slug}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:bg-stone-50"
            >
              <User className="h-3.5 w-3.5" aria-hidden="true" />
              Claim this tool
            </Link>
          </div>
        </div>

        {/* Warning banner */}
        {tool.warning && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
            <p className="text-sm text-amber-900">{tool.warning}</p>
          </div>
        )}

        {/* Disputed overlay */}
        {isDisputed && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
            <div>
              <p className="font-semibold text-red-900">Passport under dispute</p>
              <p className="mt-0.5 text-sm text-red-800">
                Claims on this passport have been formally challenged and are under review. Treat this tool as untrusted until resolved.
              </p>
            </div>
          </div>
        )}
      </header>

      {/* ── Trust ladder ────────────────────────────────────────────────────── */}
      <Section title="Trust ladder" icon={ShieldCheck}>
        <ol className="space-y-1" role="list" aria-label="Trust levels">
          {TRUST_LADDER.map((level, i) => {
            const done = i < currentLevel;
            const active = i === currentLevel;
            return (
              <li
                key={level.status}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? "border border-moss bg-green-50"
                    : done
                    ? "bg-stone-50 text-stone-500"
                    : "text-stone-300"
                }`}
                aria-current={active ? "step" : undefined}
              >
                <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  active ? "bg-moss text-white" : done ? "bg-stone-300 text-white" : "bg-stone-100 text-stone-300"
                }`}>
                  {done ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <span className={`font-medium ${active ? "text-stone-900" : ""}`}>{level.label}</span>
                  <span className={`ml-2 text-xs ${active ? "text-stone-500" : "text-stone-300"}`}>
                    {level.desc}
                  </span>
                </div>
                {active && (
                  <span className="shrink-0 rounded-full bg-moss px-2 py-0.5 text-xs font-semibold text-white">
                    Current
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </Section>

      {/* ── Two-column: identity + commercial ──────────────────────────────── */}
      <div className="grid gap-6 md:grid-cols-2">

        {/* Identity */}
        <Section title="Identity" icon={User}>
          <div className="divide-y-0">
            {tool.tool_identity?.publisher && (
              <InfoRow label="Publisher" value={tool.tool_identity.publisher as string} />
            )}
            {tool.tool_identity?.version && (
              <InfoRow label="Version" value={
                <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs">
                  {tool.tool_identity.version as string}
                </span>
              } />
            )}
            {tool.creator_identity?.creator && (
              <InfoRow label="Creator" value={tool.creator_identity.creator as string} />
            )}
            {tool.creator_identity?.verification_state && (
              <InfoRow label="Verified" value={
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                  tool.creator_identity.verification_state === "github_verified"
                    ? "bg-green-100 text-green-800"
                    : "bg-stone-100 text-stone-600"
                }`}>
                  {tool.creator_identity.verification_state === "github_verified" ? "GitHub verified" : "Unverified"}
                </span>
              } />
            )}
            {tool.tool_identity?.source_url && (
              <InfoRow label="Source" value={
                <a
                  href={tool.tool_identity.source_url as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-moss underline underline-offset-2"
                >
                  View source <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              } />
            )}
          </div>
        </Section>

        {/* Commercial */}
        <Section title="Pricing" icon={Coins}>
          <div>
            <InfoRow label="Model" value={
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                tool.commercial_status.status === "free"       ? "bg-green-100 text-green-800"  :
                tool.commercial_status.status === "freemium"   ? "bg-blue-100 text-blue-800"   :
                tool.commercial_status.status === "paid"       ? "bg-amber-100 text-amber-800" :
                "bg-stone-100 text-stone-600"
              }`}>
                {tool.commercial_status.status}
              </span>
            } />
            {pricing && (
              <>
                <InfoRow label="Price" value={
                  <span className="font-mono">
                    ${pricing.amount.toFixed(4)} {pricing.currency} / call
                  </span>
                } />
                {paymentConfig && (
                  <InfoRow label="Network" value={paymentConfig.network} />
                )}
                {paymentConfig?.wallet_address && (
                  <InfoRow label="Wallet" value={
                    <span className="font-mono text-xs">
                      {paymentConfig.wallet_address.slice(0, 8)}…{paymentConfig.wallet_address.slice(-6)}
                    </span>
                  } />
                )}
              </>
            )}
            {!pricing && tool.commercial_status.status === "free" && (
              <p className="mt-2 text-sm text-stone-500">No payment required. Free to use.</p>
            )}
            {!pricing && tool.commercial_status.status === "freemium" && (
              <p className="mt-2 text-sm text-stone-500">Free tier available. Paid tiers available via operator.</p>
            )}
          </div>
        </Section>
      </div>

      {/* ── Capabilities ───────────────────────────────────────────────────── */}
      <Section title="Capabilities" icon={Package}>
        <div className="flex flex-wrap gap-2">
          {tool.capabilities.map((cap) => (
            <span
              key={cap}
              className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 font-mono text-xs text-stone-700"
            >
              {cap}
            </span>
          ))}
        </div>
      </Section>

      {/* ── Permissions ─────────────────────────────────────────────────────── */}
      <Section title="Permission manifest" icon={Globe}>
        <p className="mb-3 text-sm text-stone-500">
          What this tool claims it needs to run. Expand any row to see granular scope restrictions.
        </p>
        <PermissionTable permissions={tool.permission_manifest} />
      </Section>

      {/* ── Evidence (v0.3 — shown only when present) ──────────────────────── */}
      {tool.evidence && (
        <Section title="Security evidence" icon={Microscope}>
          <div className="space-y-2">
            {tool.evidence.scanner && (
              <InfoRow label="Scanner" value={tool.evidence.scanner as string} />
            )}
            {tool.evidence.run_at && (
              <InfoRow label="Scanned" value={new Date(tool.evidence.run_at as string).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} />
            )}
            {tool.evidence.commit && (
              <InfoRow label="Commit" value={
                <span className="font-mono text-xs">{(tool.evidence.commit as string).slice(0, 12)}</span>
              } />
            )}
            {tool.evidence.findings && (
              <div className="mt-3">
                <p className="mb-2 text-xs font-medium text-stone-500 uppercase tracking-wide">Findings</p>
                <div className="grid grid-cols-4 gap-2">
                  {(["critical", "high", "medium", "low"] as const).map((sev) => {
                    const count = (tool.evidence!.findings as Record<string, number>)[sev] ?? 0;
                    return (
                      <div key={sev} className={`rounded-lg border p-3 text-center ${
                        sev === "critical" && count > 0 ? "border-red-300 bg-red-50" :
                        sev === "high" && count > 0     ? "border-orange-300 bg-orange-50" :
                        "border-stone-200 bg-stone-50"
                      }`}>
                        <p className={`text-xl font-bold ${
                          sev === "critical" && count > 0 ? "text-red-700" :
                          sev === "high" && count > 0     ? "text-orange-700" :
                          count > 0 ? "text-amber-700" : "text-stone-400"
                        }`}>{count}</p>
                        <p className="mt-0.5 text-xs capitalize text-stone-500">{sev}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* ── Version hash ────────────────────────────────────────────────────── */}
      {tool.version_hash && (
        <Section title="Version seal" icon={GitCommit}>
          <p className="mb-3 text-sm text-stone-500">
            Trust is bound to this exact release. If the code changes, the seal breaks.
          </p>
          <div>
            {tool.version_hash.version && (
              <InfoRow label="Version" value={
                <span className="font-mono text-xs">{tool.version_hash.version as string}</span>
              } />
            )}
            {tool.version_hash.commit && (
              <InfoRow label="Commit" value={
                <span className="font-mono text-xs break-all">{tool.version_hash.commit as string}</span>
              } />
            )}
            {tool.version_hash.artifact_hash && (
              <InfoRow label="Artifact hash" value={
                <span className="font-mono text-xs break-all">{(tool.version_hash.artifact_hash as string).slice(0, 20)}…</span>
              } />
            )}
          </div>
        </Section>
      )}

      {/* ── Agent access ────────────────────────────────────────────────────── */}
      <Section title="Agent access" icon={BookOpen}>
        <InfoRow
          label="Allowed"
          value={
            tool.agent_access?.allowed ? (
              <span className="inline-flex items-center gap-1 rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                Yes
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                No
              </span>
            )
          }
        />
        {!!tool.agent_access?.conditions && (
          <InfoRow label="Conditions" value={String(tool.agent_access.conditions)} />
        )}
      </Section>

      {/* ── Badge embed ─────────────────────────────────────────────────────── */}
      <Section title="Badge">
        <p className="mb-3 text-sm text-stone-500">
          Add this to your README to show live trust status.
        </p>
        <div className="flex items-center gap-2">
          {/* Live badge preview */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/v1/badge/${tool.slug}.svg`}
            alt={`OpenTrust badge for ${tool.name}`}
            className="h-5"
          />
        </div>
        <div className="mt-3 flex items-start gap-2">
          <code className="flex-1 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 font-mono text-xs text-stone-700 break-all">
            {badgeMarkdown}
          </code>
          <CopyButton text={badgeMarkdown} />
        </div>
      </Section>

    </div>
  );
}

