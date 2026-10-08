import { formatMoney, planAdvice, platformFeeFor, PLAN_IDS, PLANS } from "@sf/core";
import { requireShop, testPayments } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { PlanButton } from "./PlanButton";

export const metadata = { title: "Plan" };

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const { shop, db } = await requireShop();
  const [{ plan: returned }, advice] = await Promise.all([searchParams, planAdvice(db, shop)]);
  const usd = (m: number) => formatMoney(m, "USD");
  const money = (m: number) => formatMoney(m, shop.currency);
  const current = PLANS[shop.plan];

  return (
    <main className="pb-12">
      <PageHeader title="Plan" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-5xl">
        {returned === "updated" && <p className="banner banner-info" role="status">Thanks. Your plan updates as soon as the payment goes through.</p>}
        <section className="card p-5 flex flex-col gap-2">
          <h2 className="font-semibold">You're on {current.name}</h2>
          <p className="text-sm">
            Last 30 days: {advice.orders} {advice.orders === 1 ? "order" : "orders"}, {money(advice.salesMinor)} in sales. This plan cost you{" "}
            <span className="font-semibold num">{money(advice.currentCostMinor)}</span>
            {current.feeBps ? ` (${money(advice.feesMinor)} in sales fees${current.monthlyMinor ? ` plus ${usd(current.monthlyMinor)}` : ""})` : ""}.
          </p>
          {advice.best && (
            <p className="banner banner-info">
              {PLANS[advice.best.plan].name} would have cost {money(advice.best.saveMinor)} less for the same sales.
            </p>
          )}
          <p className="hint">No contracts. Switch or cancel any time; we never take a cut on paid plans. Card processing is charged by Stripe on every plan.</p>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Plans">
          {PLAN_IDS.map((id) => {
            const p = PLANS[id];
            const isCurrent = id === shop.plan;
            const estimate = p.monthlyMinor + platformFeeFor(id, advice.salesMinor);
            return (
              <article key={id} className={`card p-5 flex flex-col gap-3 ${isCurrent ? "border-accent" : ""}`} aria-current={isCurrent ? "true" : undefined}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-lg">{p.name}</h3>
                  {isCurrent && <span className="pill pill-info">Current</span>}
                </div>
                <p><span className="text-3xl font-bold num">{usd(p.monthlyMinor)}</span><span className="hint"> / month</span></p>
                <p className="text-sm font-semibold">{p.feeBps ? `${p.feeBps / 100}% of each sale` : "0% of your sales"}</p>
                <p className="text-sm hint">{p.blurb}</p>
                <p className="text-sm">
                  {p.ordersPerMonth ? `Up to ${p.ordersPerMonth} orders a month` : "Unlimited orders"}
                </p>
                <p className="text-sm hint num">With your last 30 days: {money(estimate)}</p>
                <div className="mt-auto">
                  {isCurrent ? (
                    <span className="hint">Your plan</span>
                  ) : (
                    <PlanButton plan={id} label={p.monthlyMinor > current.monthlyMinor ? `Upgrade to ${p.name}` : `Switch to ${p.name}`} primary={advice.best?.plan === id} />
                  )}
                </div>
              </article>
            );
          })}
        </section>
        {testPayments() && <p className="hint">Test mode: plan changes apply straight away and nothing is charged.</p>}
      </div>
    </main>
  );
}
