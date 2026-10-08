import Link from "next/link";
import { PLAN_IDS, PLANS } from "@sf/core";
import { PriceCalculator } from "./PriceCalculator";

export const metadata = { title: "Pricing", description: "Start free with 2% per sale, or pay a flat monthly price and keep every sale." };

const usd = (minor: number) => `$${(minor / 100).toFixed(0)}`;

export default function PricingPage() {
  const plans = PLAN_IDS.map((id) => ({ id, ...PLANS[id] }));
  return (
    <main className="px-4 sm:px-8 pb-12 max-w-6xl mx-auto flex flex-col gap-10">
      <div className="flex flex-col gap-3 max-w-2xl">
        <h1 className="text-4xl font-bold tracking-tight">Start free. Switch when it saves you money.</h1>
        <p className="text-lg text-muted">
          Free costs nothing a month and takes 2% of each sale. Paid plans take nothing from your sales. We tell you in your Money
          page when another plan would cost you less.
        </p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((p) => (
          <li key={p.id} className={`card p-5 flex flex-col gap-3 ${p.id === "growth" ? "ring-2 ring-accent" : ""}`} aria-label={`${p.name} plan`}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg">{p.name}</h2>
              {p.id === "growth" && <span className="pill pill-success">Most stores</span>}
            </div>
            <p>
              <span className="text-3xl font-bold num">{usd(p.monthlyMinor)}</span>
              <span className="hint"> a month</span>
            </p>
            <p className="text-sm font-medium">{p.feeBps ? `+ ${p.feeBps / 100}% of each sale` : "0% of your sales"}</p>
            <p className="text-sm text-muted flex-1">{p.blurb}</p>
            <p className="hint text-sm">{p.ordersPerMonth ? `Up to ${p.ordersPerMonth} orders a month` : "Unlimited orders"}</p>
            <Link href="/signup" className={`btn ${p.id === "growth" ? "btn-primary" : "btn-secondary"}`}>{p.monthlyMinor ? `Start with ${p.name}` : "Start free"}</Link>
          </li>
        ))}
      </ul>
      <section className="card p-6 flex flex-col gap-4" aria-labelledby="calc">
        <h2 id="calc" className="text-xl font-semibold">What would you pay?</h2>
        <PriceCalculator plans={plans.map((p) => ({ id: p.id, name: p.name, monthlyMinor: p.monthlyMinor, feeBps: p.feeBps, ordersPerMonth: p.ordersPerMonth }))} />
      </section>
      <section className="grid gap-4 md:grid-cols-3 text-sm" aria-label="Included on every plan">
        <div className="flex flex-col gap-1"><h3 className="font-semibold">On every plan</h3><p className="text-muted">Supplier import, automatic orders, the theme editor, your own domain, reviews, discount codes, checkout reminders, analytics, the app, the API and webhooks.</p></div>
        <div className="flex flex-col gap-1"><h3 className="font-semibold">Card fees</h3><p className="text-muted">Stripe charges its own card fee (2.9% + 30¢ for most US cards). It&apos;s the same on every plan, and every order shows it.</p></div>
        <div className="flex flex-col gap-1"><h3 className="font-semibold">AI help</h3><p className="text-muted">Every plan includes a monthly AI allowance. Higher plans include more; you set the limit and can pause it.</p></div>
      </section>
    </main>
  );
}
