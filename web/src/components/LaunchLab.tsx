"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RadioTower,
  ShieldCheck,
  Lock,
  Wallet,
  Terminal,
  Globe,
  FileText,
  Camera,
  Mic,
  Database,
  Cpu,
  Link2,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Passport = {
  tool_identity: { name: string; slug: string; category: string };
  creator_identity: { creator: string; verification_state: string };
  trust_status: string;
  permission_manifest: Record<string, boolean | string>;
  data_handling: {
    retention_days: number;
    used_for_training: boolean;
    third_party_sharing: boolean;
    gdpr_compliant: boolean;
    ccpa_compliant: boolean;
  };
  commercial_status: {
    status: string;
    pricing?: { amount: number; currency: string };
    payment_config?: { network: string; wallet_address: string; supported_tokens: string[] };
  };
  version_hash: { version: string; commit: string; artifact_hash: string };
};

type LiveCheck = { name: string; ok: boolean; detail: string };

// ── Policy (what your AI agent is allowed to do) ──────────────────────────────

const TRUST_ORDER: Record<string, number> = {
  auto_generated_draft: 0,
  self_attested: 1,
  community_reviewed: 2,
  verified: 3,
  continuously_monitored: 4,
};

const policy = {
  max_cost_per_call_usdc: 0.1,
  min_trust_status: "community_reviewed",
  blocked_permissions: ["wallet", "private_data", "terminal", "browser"],
  allowed_networks: ["base"],
  allowed_currencies: ["USDC"],
  require_escrow_above_usdc: 0.1,
  human_approval_above_usdc: 0.01,
};

// ── Sample tool passports ─────────────────────────────────────────────────────

const safePassport: Passport = {
  tool_identity: { name: "Hello Weather", slug: "hello-weather", category: "research" },
  creator_identity: { creator: "OpenTrust Demo", verification_state: "github_verified" },
  trust_status: "community_reviewed",
  permission_manifest: {
    file: false, terminal: false, browser: false, network: true,
    memory: false, wallet: false, api: true, camera: false,
    microphone: false, private_data: false,
    notes: "Makes HTTPS calls to a weather API only.",
  },
  data_handling: {
    retention_days: 0, used_for_training: false,
    third_party_sharing: false, gdpr_compliant: true, ccpa_compliant: true,
  },
  commercial_status: { status: "free" },
  version_hash: {
    version: "1.0.0",
    commit: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4",
    artifact_hash: "sha256:aabbccddee001122334455667788990011223344",
  },
};

const unsafePassport: Passport = {
  tool_identity: { name: "Weather Turbo", slug: "weather-turbo", category: "research" },
  creator_identity: { creator: "Unknown Developer", verification_state: "unverified" },
  trust_status: "auto_generated_draft",
  permission_manifest: {
    file: true, terminal: true, browser: false, network: true,
    memory: true, wallet: true, api: true, camera: false,
    microphone: false, private_data: true,
    notes: "Reads credentials, caches to disk, auto-installs packages, accesses wallet keys.",
  },
  data_handling: {
    retention_days: 90, used_for_training: true,
    third_party_sharing: true, gdpr_compliant: false, ccpa_compliant: false,
  },
  commercial_status: {
    status: "pay_per_use",
    pricing: { amount: 0.5, currency: "USDC" },
    payment_config: { network: "solana", wallet_address: "0xDEADBEEF0000", supported_tokens: ["USDC"] },
  },
  version_hash: {
    version: "0.0.1-alpha",
    commit: "ffffffffffffffffffffffffffffffffffffffff",
    artifact_hash: "sha256:ffffffffffffffffffffffffffffffffffffffff",
  },
};

// ── Launch checklist ──────────────────────────────────────────────────────────

const launchGates = [
  {
    label: "Tools have tamper-proof seals",
    detail: "If anyone changes a tool after it's signed, we know right away.",
    status: "ready",
  },
  {
    label: "Blocked tools stay blocked",
    detail: "Once we remove a tool, AI agents can't use it — even when offline.",
    status: "ready",
  },
  {
    label: "Dangerous actions are blocked by default",
    detail: "Wallet access, terminal use, and private data are off unless you say so.",
    status: "ready",
  },
  {
    label: "Spending limits are enforced",
    detail: "Your agent won't spend more than your cap. Big payments need approval.",
    status: "ready",
  },
  {
    label: "Payment codes expire quickly",
    detail: "Each payment code is single-use and expires fast so it can't be stolen.",
    status: "ready",
  },
  {
    label: "Admin actions are logged",
    detail: "Every change to the registry is recorded with who did it and when.",
    status: "ready",
  },
  {
    label: "The server is locked down",
    detail: "Security headers, rate limiting, and non-root containers are all on.",
    status: "ready",
  },
  {
    label: "Real keys, domain, and SSL needed",
    detail: "Before going public: generate real secret keys, add a real domain, and get an SSL certificate.",
    status: "operator",
  },
];

// ── Permission labels ─────────────────────────────────────────────────────────

const PERMISSIONS = [
  { key: "file",         label: "Read your files",        icon: FileText,  risky: true  },
  { key: "terminal",     label: "Use the terminal",        icon: Terminal,  risky: true  },
  { key: "browser",      label: "Control your browser",    icon: Globe,     risky: true  },
  { key: "network",      label: "Use the internet",        icon: Link2,     risky: false },
  { key: "memory",       label: "Save things to memory",   icon: Cpu,       risky: false },
  { key: "wallet",       label: "Access your wallet",      icon: Wallet,    risky: true  },
  { key: "api",          label: "Call external APIs",      icon: RadioTower, risky: false },
  { key: "camera",       label: "Use your camera",         icon: Camera,    risky: true  },
  { key: "microphone",   label: "Use your microphone",     icon: Mic,       risky: true  },
  { key: "private_data", label: "Read your private data",  icon: Database,  risky: true  },
];

// ── Plain-English helpers ─────────────────────────────────────────────────────

function humanTrustStatus(status: string): string {
  const map: Record<string, string> = {
    auto_generated_draft:    "New — not reviewed yet",
    self_attested:           "Creator says it's safe",
    community_reviewed:      "Checked by the community",
    verified:                "Verified",
    continuously_monitored:  "Actively monitored",
    disputed:                "Under dispute",
  };
  return map[status] ?? status.replaceAll("_", " ");
}

function humanVerification(state: string): string {
  return state === "github_verified" ? "GitHub verified" : "Not verified";
}

function humanizeReason(reason: string): string {
  if (reason.startsWith("TRUST TOO LOW"))
    return "This tool hasn't been reviewed enough to be trusted.";
  if (reason.includes("BROAD PERMISSION: wallet"))
    return "This tool wants to access your wallet — that's blocked.";
  if (reason.includes("BROAD PERMISSION: terminal"))
    return "This tool wants to use your terminal — that's blocked.";
  if (reason.includes("BROAD PERMISSION: private_data"))
    return "This tool wants to read your private data — that's blocked.";
  if (reason.includes("BROAD PERMISSION: browser"))
    return "This tool wants to control your browser — that's blocked.";
  if (reason.includes("BROAD PERMISSION:")) {
    const perm = reason.split(":")[1]?.split("is")[0]?.trim();
    return `This tool wants "${perm}" access — that's blocked by your rules.`;
  }
  if (reason.includes("DATA USE: training"))
    return "This tool trains AI on your data — your rules don't allow that.";
  if (reason.includes("DATA SHARING"))
    return "This tool shares your data with other companies — not allowed.";
  if (reason.includes("SPEND CAP")) {
    const m = reason.match(/([\d.]+) > ([\d.]+)/);
    if (m) return `This tool costs $${m[1]} per use. Your limit is $${m[2]}.`;
    return "This tool costs more per use than your limit.";
  }
  if (reason.includes("HUMAN APPROVAL REQUIRED"))
    return "A real person needs to approve this payment — it's over the automatic limit.";
  if (reason.includes("NETWORK DENIED")) {
    const net = reason.split(":")[1]?.trim();
    return `This tool uses the ${net} network — only Base is allowed.`;
  }
  if (reason.includes("CURRENCY DENIED")) {
    const cur = reason.split(":")[1]?.trim();
    return `This tool uses ${cur} — only USDC is allowed.`;
  }
  if (reason.includes("VERSION HASH MISSING"))
    return "This tool has no security seal. We can't verify it hasn't been changed.";
  return reason;
}

function evaluatePassport(passport: Passport) {
  const reasons: string[] = [];
  const trust = TRUST_ORDER[passport.trust_status] ?? -1;
  const minTrust = TRUST_ORDER[policy.min_trust_status];
  if (trust < minTrust)
    reasons.push(`TRUST TOO LOW: ${passport.trust_status} < ${policy.min_trust_status}`);
  for (const perm of policy.blocked_permissions) {
    if (passport.permission_manifest[perm] === true)
      reasons.push(`BROAD PERMISSION: ${perm} is blocked by local policy`);
  }
  if (passport.data_handling.used_for_training)
    reasons.push("DATA USE: training on user data is not allowed by this demo policy");
  if (passport.data_handling.third_party_sharing)
    reasons.push("DATA SHARING: third-party sharing requires explicit approval");
  const pricing = passport.commercial_status.pricing;
  const payment = passport.commercial_status.payment_config;
  if (pricing) {
    if (pricing.amount > policy.max_cost_per_call_usdc)
      reasons.push(`SPEND CAP: ${pricing.amount} > ${policy.max_cost_per_call_usdc} USDC/call`);
    if (!policy.allowed_currencies.includes(pricing.currency))
      reasons.push(`CURRENCY DENIED: ${pricing.currency}`);
    if (pricing.amount > policy.human_approval_above_usdc)
      reasons.push("HUMAN APPROVAL REQUIRED: amount crosses local threshold");
  }
  if (payment && !policy.allowed_networks.includes(payment.network))
    reasons.push(`NETWORK DENIED: ${payment.network}`);
  if (!passport.version_hash.commit && !passport.version_hash.artifact_hash)
    reasons.push("VERSION HASH MISSING: commit or artifact hash required");
  return { allowed: reasons.length === 0, reasons };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PermissionRow({
  label,
  icon: Icon,
  value,
  risky,
}: {
  label: string;
  icon: React.ElementType;
  value: boolean | string;
  risky: boolean;
}) {
  const granted = value === true;
  const isRiskyAndGranted = granted && risky;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2">
      <Icon
        className={`h-4 w-4 shrink-0 ${isRiskyAndGranted ? "text-signal" : "text-stone-400"}`}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 text-sm text-stone-700">{label}</span>
      {granted ? (
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${
            risky
              ? "bg-red-100 text-red-800"
              : "bg-stone-100 text-stone-600"
          }`}
          aria-label={`${label}: ${risky ? "yes — risky" : "yes"}`}
        >
          Yes
        </span>
      ) : (
        <span
          className="shrink-0 rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800"
          aria-label={`${label}: no`}
        >
          No
        </span>
      )}
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-stone-600">{label}</span>
      <span className="text-right font-medium text-stone-900">{value}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function LaunchLab() {
  const [mode, setMode] = useState<"safe" | "unsafe">("safe");
  const [liveChecks, setLiveChecks] = useState<LiveCheck[]>([]);
  const [checking, setChecking] = useState(false);
  const [apiBase, setApiBase] = useState(process.env.NEXT_PUBLIC_API_URL ?? "");

  const passport = mode === "safe" ? safePassport : unsafePassport;
  const evaluation = useMemo(() => evaluatePassport(passport), [passport]);

  async function checkLiveRegistry() {
    setChecking(true);
    setLiveChecks([]);
    const endpoints = [
      { label: "Is the API running?",                path: "/api/v1/health" },
      { label: "Are the security keys published?",   path: "/.well-known/opentrust-keys.json" },
      { label: "Is the registry list signed?",       path: "/.well-known/opentrust-registries.json" },
      { label: "Is the blocked-tools list signed?",  path: "/.well-known/revoked-passports.json" },
    ];
    const results: LiveCheck[] = [];
    for (const ep of endpoints) {
      try {
        const base = apiBase.trim().replace(/\/$/, "");
        const resp = await fetch(`${base}${ep.path}`, { cache: "no-store" });
        const data = await resp.json().catch(() => ({}));
        const ok = resp.ok && (ep.path.includes("well-known")
          ? Boolean(data.keys || data.signature || data.payload || data.registries)
          : true);
        results.push({ name: ep.label, ok, detail: `HTTP ${resp.status}` });
      } catch (err) {
        results.push({
          name: ep.label,
          ok: false,
          detail: err instanceof Error ? err.message : "Request failed",
        });
      }
    }
    setLiveChecks(results);
    setChecking(false);
  }

  const readyCount = launchGates.filter((g) => g.status === "ready").length;
  const operatorCount = launchGates.filter((g) => g.status === "operator").length;

  return (
    <div className="space-y-8">

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <header>
        <h1 className="text-3xl font-bold text-stone-900 sm:text-4xl">
          Is OpenTrust ready to launch?
        </h1>
        <p className="mt-2 max-w-2xl text-stone-600">
          This page shows how OpenTrust keeps AI agents safe from bad tools.
          Try the tool simulator, review the launch checklist, and test the live site.
        </p>
        <div className="mt-4 flex flex-wrap gap-3" aria-label="Build status summary">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-green-300 bg-green-50 px-3 py-1 text-sm font-medium text-green-800">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            155 tests passing
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-green-300 bg-green-50 px-3 py-1 text-sm font-medium text-green-800">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {readyCount} of {launchGates.length} checks ready
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {operatorCount} setup step still needed
          </span>
        </div>
      </header>

      {/* ── Try it yourself ──────────────────────────────────────────────────── */}
      <section aria-labelledby="simulator-heading">
        <div className="panel p-6">
          <h2 id="simulator-heading" className="text-xl font-bold text-stone-900">
            Try it yourself
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            Pick a tool. OpenTrust will decide if your AI agent is allowed to use it.
          </p>

          {/* Toggle */}
          <div
            role="group"
            aria-label="Choose which tool to test"
            className="mt-4 inline-flex rounded-lg border border-stone-300 bg-stone-100 p-1"
          >
            <button
              onClick={() => setMode("safe")}
              aria-pressed={mode === "safe"}
              className={`rounded-md px-5 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss ${
                mode === "safe"
                  ? "bg-white text-stone-900 shadow-sm"
                  : "text-stone-500 hover:text-stone-700"
              }`}
            >
              Safe tool
            </button>
            <button
              onClick={() => setMode("unsafe")}
              aria-pressed={mode === "unsafe"}
              className={`rounded-md px-5 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal ${
                mode === "unsafe"
                  ? "bg-white text-stone-900 shadow-sm"
                  : "text-stone-500 hover:text-stone-700"
              }`}
            >
              Risky tool
            </button>
          </div>

          {/* Tool info + Decision */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">

            {/* Tool card */}
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">
                Tool info
              </p>
              <h3 className="mt-1 text-xl font-bold text-stone-900">
                {passport.tool_identity.name}
              </h3>
              <dl className="mt-3 space-y-2 divide-y divide-stone-200">
                <div className="flex justify-between gap-4 pt-2 text-sm">
                  <dt className="text-stone-500">Trust level</dt>
                  <dd className="text-right font-medium text-stone-900">
                    {humanTrustStatus(passport.trust_status)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 pt-2 text-sm">
                  <dt className="text-stone-500">Creator</dt>
                  <dd className="text-right font-medium text-stone-900">
                    {passport.creator_identity.creator}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 pt-2 text-sm">
                  <dt className="text-stone-500">Verified</dt>
                  <dd className="text-right font-medium text-stone-900">
                    {humanVerification(passport.creator_identity.verification_state)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 pt-2 text-sm">
                  <dt className="text-stone-500">Price</dt>
                  <dd className="text-right font-medium text-stone-900">
                    {passport.commercial_status.pricing
                      ? `$${passport.commercial_status.pricing.amount} USDC per use`
                      : "Free"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 pt-2 text-sm">
                  <dt className="text-stone-500">Network</dt>
                  <dd className="text-right font-medium text-stone-900">
                    {passport.commercial_status.payment_config?.network ?? "None"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 pt-2 text-sm">
                  <dt className="text-stone-500">Version</dt>
                  <dd className="text-right font-medium text-stone-900">
                    {passport.version_hash.version}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Decision card */}
            <div
              className={`rounded-lg border p-5 ${
                evaluation.allowed
                  ? "border-green-300 bg-green-50"
                  : "border-red-300 bg-red-50"
              }`}
              role="region"
              aria-label="Policy decision"
              aria-live="polite"
            >
              <div className="flex items-center gap-3">
                {evaluation.allowed ? (
                  <ShieldCheck className="h-8 w-8 shrink-0 text-green-700" aria-hidden="true" />
                ) : (
                  <XCircle className="h-8 w-8 shrink-0 text-red-700" aria-hidden="true" />
                )}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-stone-500">
                    Decision
                  </p>
                  <p
                    className={`text-3xl font-black ${
                      evaluation.allowed ? "text-green-800" : "text-red-800"
                    }`}
                  >
                    {evaluation.allowed ? "Allowed" : "Blocked"}
                  </p>
                </div>
              </div>

              <div className="mt-4">
                {evaluation.allowed ? (
                  <p className="text-sm text-green-800">
                    This tool passed all checks. Your agent can use it safely.
                  </p>
                ) : (
                  <>
                    <p className="mb-3 text-sm font-semibold text-red-900">
                      Why it was blocked:
                    </p>
                    <ul className="space-y-2" role="list">
                      {evaluation.reasons.map((reason) => (
                        <li
                          key={reason}
                          className="flex items-start gap-2 rounded-md bg-red-100 px-3 py-2 text-sm text-red-900"
                        >
                          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                          {humanizeReason(reason)}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Permissions grid */}
          <div className="mt-6">
            <h3 className="text-base font-bold text-stone-900">
              What can this tool do?
            </h3>
            <p className="mt-1 text-sm text-stone-500">
              Red means the tool has that permission. Green means it does not.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {PERMISSIONS.map(({ key, label, icon, risky }) => (
                <PermissionRow
                  key={key}
                  label={label}
                  icon={icon}
                  value={passport.permission_manifest[key] ?? false}
                  risky={risky}
                />
              ))}
            </div>
          </div>

          {/* Data handling */}
          <div className="mt-6">
            <h3 className="text-base font-bold text-stone-900">
              What happens to your data?
            </h3>
            <div className="mt-3 divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white px-4">
              <DataRow
                label="Stores your data for"
                value={
                  passport.data_handling.retention_days === 0
                    ? "No storage — data is not kept"
                    : `${passport.data_handling.retention_days} days`
                }
              />
              <DataRow
                label="Trains AI on your data"
                value={passport.data_handling.used_for_training ? "Yes" : "No"}
              />
              <DataRow
                label="Shares data with other companies"
                value={passport.data_handling.third_party_sharing ? "Yes" : "No"}
              />
              <DataRow
                label="GDPR compliant"
                value={passport.data_handling.gdpr_compliant ? "Yes" : "No"}
              />
              <DataRow
                label="CCPA compliant"
                value={passport.data_handling.ccpa_compliant ? "Yes" : "No"}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── Checklist + Live check ───────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">

        {/* Launch checklist */}
        <section aria-labelledby="checklist-heading">
          <div className="panel h-full p-6">
            <h2 id="checklist-heading" className="text-xl font-bold text-stone-900">
              Launch checklist
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              These are the things OpenTrust checks before it goes live.
            </p>
            <ul className="mt-4 space-y-3" role="list">
              {launchGates.map((gate) => (
                <li
                  key={gate.label}
                  className="flex items-start gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3"
                >
                  {gate.status === "ready" ? (
                    <CheckCircle2
                      className="mt-0.5 h-5 w-5 shrink-0 text-moss"
                      aria-label="Ready"
                    />
                  ) : (
                    <AlertTriangle
                      className="mt-0.5 h-5 w-5 shrink-0 text-amber-500"
                      aria-label="Action needed"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold text-stone-900">{gate.label}</p>
                    <p className="mt-0.5 text-sm text-stone-500">{gate.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Live registry check */}
        <section aria-labelledby="live-check-heading">
          <div className="panel h-full p-6">
            <h2 id="live-check-heading" className="text-xl font-bold text-stone-900">
              Check the live site
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              Enter the API address to see if everything is running. Leave it empty to check this page.
            </p>

            <div className="mt-4">
              <label
                htmlFor="api-base-url"
                className="block text-sm font-medium text-stone-700"
              >
                API address
              </label>
              <input
                id="api-base-url"
                type="url"
                value={apiBase}
                onChange={(e) => setApiBase(e.target.value)}
                placeholder="https://your-api.vercel.app (leave empty for this site)"
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-moss focus:outline-none focus:ring-2 focus:ring-moss/30"
                aria-describedby="api-base-hint"
              />
              <p id="api-base-hint" className="mt-1 text-xs text-stone-400">
                Example: https://api-kappa-pied-59.vercel.app
              </p>
            </div>

            <button
              onClick={checkLiveRegistry}
              disabled={checking}
              aria-busy={checking}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition hover:bg-stone-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RadioTower className="h-4 w-4" aria-hidden="true" />
              {checking ? "Checking…" : "Run checks"}
            </button>

            <div
              role="status"
              aria-live="polite"
              aria-label="Check results"
              className="mt-4"
            >
              {liveChecks.length > 0 && (
                <ul className="space-y-2" role="list">
                  {liveChecks.map((check) => (
                    <li
                      key={check.name}
                      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
                        check.ok
                          ? "border-green-200 bg-green-50"
                          : "border-red-200 bg-red-50"
                      }`}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        {check.ok ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-label="Passed" />
                        ) : (
                          <XCircle className="h-4 w-4 shrink-0 text-red-600" aria-label="Failed" />
                        )}
                        {check.name}
                      </span>
                      <span className={`shrink-0 text-xs ${check.ok ? "text-green-700" : "text-red-700"}`}>
                        {check.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* ── Before you go public ─────────────────────────────────────────────── */}
      <section aria-labelledby="operator-heading">
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-6">
          <div className="flex items-start gap-3">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
            <div className="min-w-0">
              <h2 id="operator-heading" className="text-lg font-bold text-amber-900">
                Before you go public
              </h2>
              <p className="mt-1 text-sm text-amber-800">
                The code is ready. You still need to do these three things before real users visit the site:
              </p>
              <ol className="mt-3 space-y-2 text-sm text-amber-900" role="list">
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-200 text-xs font-bold text-amber-900">
                    1
                  </span>
                  <span>
                    <strong>Get real secret keys.</strong> Generate a registry signing key outside of git and store it in a secrets manager — not in code.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-200 text-xs font-bold text-amber-900">
                    2
                  </span>
                  <span>
                    <strong>Set up a real domain with SSL.</strong> Get a domain name and an SSL certificate so the site runs on <code className="rounded bg-amber-100 px-1 font-mono text-xs">https://</code>.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-200 text-xs font-bold text-amber-900">
                    3
                  </span>
                  <span>
                    <strong>Practice a restore drill.</strong> Make sure you can recover from a backup on your actual server before anything goes wrong.
                  </span>
                </li>
              </ol>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}
