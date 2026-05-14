import Link from "next/link";

export function Navigation() {
  return (
    <nav className="border-b border-stone-300 bg-paper/90">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-bold">OpenTrust</Link>
        <div className="flex gap-4 text-sm">
          <Link href="/tools">Tools</Link>
        </div>
      </div>
    </nav>
  );
}
