export default function ClaimPage({ params }: { params: { slug: string } }) {
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-3xl font-bold">Claim {params.slug}</h1>
      <p className="text-stone-700">GitHub OAuth starts a stateless JWT claim flow. The registry records creator corrections after verification.</p>
      <a className="inline-flex rounded bg-ink px-4 py-2 text-white" href={`/api/v1/claim?slug=${params.slug}`}>Continue with GitHub</a>
    </div>
  );
}
