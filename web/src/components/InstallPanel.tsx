"use client";

import { useEffect, useState } from "react";
import { Download, Copy, Check, Terminal, ExternalLink, Loader2 } from "lucide-react";

type InstallInfo = {
  slug: string;
  name: string;
  kind: string;
  free: boolean;
  source_url: string | null;
  note: string;
  install_command?: string | null;
  mcp_config?: unknown;
  deep_links?: Record<string, string>;
};

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50 transition"
      aria-label={`Copy ${label}`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-moss" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function InstallPanel({ slug }: { slug: string }) {
  const [info, setInfo] = useState<InstallInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/tools/${slug}/install`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setInfo)
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-stone-400" aria-hidden="true" />
      </div>
    );
  }
  if (!info) return null;

  const claudeCmd = info.deep_links?.claude_code;
  const mcpJson = info.mcp_config ? JSON.stringify(info.mcp_config, null, 2) : null;

  return (
    <div className="space-y-4">
      {/* Free / paid banner */}
      <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
        info.free ? "border border-green-200 bg-green-50 text-green-900" : "border border-amber-200 bg-amber-50 text-amber-900"
      }`}>
        <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
        {info.note}
      </div>

      {/* Claude Code one-liner (deep link / command) */}
      {claudeCmd && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400">
            <Terminal className="h-3.5 w-3.5" aria-hidden="true" /> Add to Claude Code
          </p>
          <div className="flex items-start gap-2">
            <code className="flex-1 rounded-lg border border-stone-200 bg-stone-900 px-3 py-2.5 font-mono text-xs text-stone-100 break-all">
              {claudeCmd}
            </code>
            <CopyBtn text={claudeCmd} label="Claude command" />
          </div>
        </div>
      )}

      {/* npx/pip install command */}
      {info.install_command && !claudeCmd && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400">Install command</p>
          <div className="flex items-start gap-2">
            <code className="flex-1 rounded-lg border border-stone-200 bg-stone-900 px-3 py-2.5 font-mono text-xs text-stone-100 break-all">
              {info.install_command}
            </code>
            <CopyBtn text={info.install_command} label="install command" />
          </div>
        </div>
      )}

      {/* MCP client config block */}
      {mcpJson && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400">
            MCP client config (paste into your client)
          </p>
          <div className="flex items-start gap-2">
            <pre className="flex-1 overflow-x-auto rounded-lg border border-stone-200 bg-stone-900 px-3 py-2.5 font-mono text-xs text-stone-100">
              {mcpJson}
            </pre>
            <CopyBtn text={mcpJson} label="MCP config" />
          </div>
        </div>
      )}

      {/* Source link */}
      {info.source_url && (
        <a
          href={info.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-moss underline underline-offset-2"
        >
          View source / docs <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      )}
    </div>
  );
}
