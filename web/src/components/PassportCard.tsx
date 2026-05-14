import Link from "next/link";
import type { Passport } from "@/types/passport";
import { TrustBadge } from "./TrustBadge";

export function PassportCard({ passport }: { passport: Passport }) {
  return (
    <article className="panel p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <Link href={`/tools/${passport.slug}`} className="text-lg font-semibold">{passport.name}</Link>
        <TrustBadge status={passport.trust_status} />
      </div>
      <p className="mb-3 text-sm text-stone-700">{passport.description || passport.capabilities.join(", ")}</p>
      <p className="text-sm font-medium">Commercial: {passport.commercial_status.status}</p>
    </article>
  );
}
