export function PricingCard({ title, price, body }: { title: string; price: string; body: string }) {
  return (
    <article className="panel p-5">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-2xl font-bold">{price}</p>
      <p className="mt-3 text-sm text-stone-700">{body}</p>
    </article>
  );
}
