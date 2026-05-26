import type { Passport, VerifyResult } from "./types.js";

export const TRUST_LEVELS: Record<string, number> = {
  auto_generated_draft: 1,
  creator_claimed: 2,
  seller_confirmed: 3,
  community_reviewed: 4,
  reviewer_signed: 5,
  security_checked: 6,
  continuously_monitored: 7,
  disputed: 0,
};

const RECOMMENDATIONS: Record<number, string> = {
  0: "⛔ Under active dispute. Do not use until resolved.",
  1: "Auto-generated draft. Do not use in any agent workflow.",
  2: "Creator claimed. Verify source independently before use.",
  3: "Seller confirmed. Suitable for sandboxed/test environments only.",
  4: "Community reviewed. Safe for low-risk tasks. Require level 6+ for production.",
  5: "Reviewer signed. Suitable for most production tasks without sensitive permissions.",
  6: "Security checked. Safe for production including sensitive permissions.",
  7: "Continuously monitored. Highest trust level available.",
};

function permActive(val: unknown): boolean {
  if (val === true) return true;
  if (val && typeof val === "object" && !Array.isArray(val)) {
    return Object.values(val as Record<string, unknown>).some(
      (v) => v === true || (Array.isArray(v) && v.length > 0)
    );
  }
  return false;
}

export function buildRecommendation(
  trustStatus: string,
  permissions: Record<string, unknown>
): string {
  const level = TRUST_LEVELS[trustStatus] ?? 1;
  let text = RECOMMENDATIONS[level] ?? RECOMMENDATIONS[1]!;
  if (permActive(permissions["wallet"])) {
    text += " ⚠ Wallet access active — verify payment amounts before use.";
  }
  if (permActive(permissions["terminal"])) {
    text += " ⚠ Terminal access active — review allowed commands carefully.";
  }
  return text;
}

export function buildRisk(
  trustStatus: string,
  permissions: Record<string, unknown>
): "low" | "medium" | "high" {
  if (trustStatus === "disputed") return "high";
  const level = TRUST_LEVELS[trustStatus] ?? 1;
  const dangerous = ["wallet", "terminal", "private_data", "browser"];
  const n = dangerous.filter((k) => permActive(permissions[k])).length;
  if (level <= 2 || n >= 2) return "high";
  if (n === 1 || level <= 4) return "medium";
  return "low";
}

export function buildVerifyResult(passport: Passport): VerifyResult {
  const trustStatus = passport.trust_status;
  const level = TRUST_LEVELS[trustStatus] ?? 1;
  const perms = (passport.permission_manifest ?? {}) as Record<string, unknown>;
  return {
    slug: passport.slug,
    trustStatus,
    trustLevel: level,
    isDisputed: trustStatus === "disputed",
    recommendation: buildRecommendation(trustStatus, perms),
    risk: buildRisk(trustStatus, perms),
    passport,
    permissions: perms,
  };
}
