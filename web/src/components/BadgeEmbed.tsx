export function BadgeEmbed({ slug }: { slug: string }) {
  const markdown = `![OpenTrust](/api/v1/badge/${slug}.svg)`;
  return <code className="block rounded bg-stone-100 p-3 text-sm">{markdown}</code>;
}
