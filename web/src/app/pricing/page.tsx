import { PricingCard } from "@/components/PricingCard";

export default function PricingPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Pricing</h1>
      <p className="max-w-2xl text-stone-700">Discovery is free. Anything that creates review labor, compute cost, moderation, arbitration, or legal risk is paid once the private payment add-on is configured.</p>
      <div className="grid gap-4 md:grid-cols-3">
        <PricingCard title="Manifest Validation" price="Stub" body="Contract endpoint exists; provider implementation is private." />
        <PricingCard title="Security Review" price="Stub" body="Reviewer labor is paid for work, not positive outcomes." />
        <PricingCard title="Monitoring" price="Stub" body="Subscriptions are represented by contracts in this public repo." />
      </div>
    </div>
  );
}
