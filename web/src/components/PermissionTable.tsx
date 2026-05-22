"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

// ── helpers ───────────────────────────────────────────────────────────────────

function formatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Object detail rows ────────────────────────────────────────────────────────

function ObjectDetail({ data }: { data: Record<string, unknown> }) {
  return (
    <dl className="mt-2 space-y-1 rounded-md bg-stone-50 px-3 py-2 text-xs">
      {Object.entries(data).map(([k, v]) => {
        const display = Array.isArray(v)
          ? v.length > 0 ? v.join(", ") : "(none)"
          : v === null || v === undefined
          ? "(none)"
          : String(v);
        return (
          <div key={k} className="flex gap-2">
            <dt className="shrink-0 font-mono text-stone-400">{k}:</dt>
            <dd className="text-stone-700 break-all">{display}</dd>
          </div>
        );
      })}
    </dl>
  );
}

// ── Single permission row ─────────────────────────────────────────────────────

function PermRow({
  perm,
  value,
}: {
  perm: string;
  value: unknown;
}) {
  const [open, setOpen] = useState(false);
  const isObject = value !== null && typeof value === "object" && !Array.isArray(value);
  const isTrue = value === true;
  const isFalse = !value || value === false;

  let badge: React.ReactNode;
  if (isObject) {
    badge = (
      <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
        Granular
      </span>
    );
  } else if (isTrue) {
    badge = (
      <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
        Yes
      </span>
    );
  } else {
    badge = (
      <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
        No
      </span>
    );
  }

  return (
    <li className="border-b border-stone-100 last:border-0">
      <div className="flex items-center justify-between gap-3 py-2.5 px-1">
        <div className="flex items-center gap-2 min-w-0">
          {isObject ? (
            <button
              onClick={() => setOpen((o) => !o)}
              className="flex items-center gap-1.5 text-sm font-medium text-stone-800 hover:text-moss transition-colors focus-visible:outline-none focus-visible:underline"
              aria-expanded={open}
              aria-controls={`perm-detail-${perm}`}
            >
              {open
                ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-stone-400" aria-hidden="true" />
                : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-400" aria-hidden="true" />
              }
              {formatKey(perm)}
            </button>
          ) : (
            <span className="text-sm font-medium text-stone-800 pl-5">{formatKey(perm)}</span>
          )}
        </div>
        {badge}
      </div>

      {isObject && open && (
        <div id={`perm-detail-${perm}`} className="pb-3 pl-5">
          <ObjectDetail data={value as Record<string, unknown>} />
        </div>
      )}
    </li>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PermissionTable({ permissions }: { permissions: Record<string, unknown> }) {
  const entries = Object.entries(permissions).filter(([k]) => k !== "notes");
  if (entries.length === 0) {
    return <p className="text-sm text-stone-400">No permissions declared.</p>;
  }

  return (
    <ul className="divide-y-0 rounded-lg border border-stone-200 bg-white px-3" aria-label="Permission manifest">
      {entries.map(([key, value]) => (
        <PermRow key={key} perm={key} value={value} />
      ))}
    </ul>
  );
}
