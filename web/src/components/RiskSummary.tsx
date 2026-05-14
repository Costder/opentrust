export function RiskSummary({ summary, warning }: { summary?: Record<string, unknown> | null; warning?: string | null }) {
  return (
    <section className="panel p-4">
      <h2 className="mb-3 text-lg font-semibold">Risk Summary</h2>
      {warning ? <p className="mb-3 rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-950">{warning}</p> : null}
      <pre className="whitespace-pre-wrap text-sm">{JSON.stringify(summary || {}, null, 2)}</pre>
    </section>
  );
}
