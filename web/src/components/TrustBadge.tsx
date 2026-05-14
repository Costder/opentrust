import type { TrustStatus } from "@/types/passport";

const colors: Record<TrustStatus, string> = {
  auto_generated_draft: "bg-yellow-100 text-yellow-900 border-yellow-300",
  creator_claimed: "bg-sky-100 text-sky-900 border-sky-300",
  seller_confirmed: "bg-teal-100 text-teal-900 border-teal-300",
  community_reviewed: "bg-green-100 text-green-900 border-green-300",
  reviewer_signed: "bg-lime-100 text-lime-900 border-lime-300",
  security_checked: "bg-emerald-100 text-emerald-900 border-emerald-300",
  continuously_monitored: "bg-green-200 text-green-950 border-green-400",
  disputed: "bg-red-100 text-red-900 border-red-300"
};

export function TrustBadge({ status }: { status: TrustStatus }) {
  return <span className={`inline-flex rounded border px-2 py-1 text-xs font-semibold ${colors[status]}`}>{status.replaceAll("_", " ")}</span>;
}
