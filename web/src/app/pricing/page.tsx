import { PricingCard } from "@/components/PricingCard";

export default function PricingPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Pricing</h1>
      <p className="max-w-2xl text-stone-700">Discovery is free. Paid product flows use the public payment contracts and the mock provider for demos.</p>
      <div className="grid gap-4 md:grid-cols-3">
        <PricingCard title="Trust Report" price="19 USDC" body="Mock checkout is marked paid immediately for demos." />
        <PricingCard title="Verified Badge" price="49 USDC" body="Reviewer labor is paid for work, not positive outcomes." />
        <PricingCard title="Monitoring" price="19 USDC/mo" body="Subscriptions create a public demo checkout." />
      </div>
    </div>
  );
}
