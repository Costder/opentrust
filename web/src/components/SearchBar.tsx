"use client";

import { Search } from "lucide-react";

export function SearchBar() {
  return (
    <form action="/tools" className="flex max-w-xl items-center gap-2">
      <Search className="h-5 w-5 text-moss" />
      <input name="q" className="w-full rounded border border-stone-300 bg-white px-3 py-2" placeholder="Search tools, capabilities, permissions" />
    </form>
  );
}
