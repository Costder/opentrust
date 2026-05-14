import { PassportCard } from "@/components/PassportCard";
import { getTools } from "@/lib/api";

export default async function ToolsPage({ searchParams }: { searchParams: { commercial_status?: string } }) {
  const tools = await getTools();
  const status = searchParams.commercial_status;
  const filtered = status ? tools.filter((tool) => tool.commercial_status.status === status) : tools;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Tool Directory</h1>
        <div className="flex gap-2 text-sm">
          {["free", "paid", "enterprise"].map((item) => (
            <a className="rounded border border-stone-300 px-3 py-1" href={`/tools?commercial_status=${item}`} key={item}>{item}</a>
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {filtered.map((tool) => <PassportCard key={tool.slug} passport={tool} />)}
      </div>
    </div>
  );
}
