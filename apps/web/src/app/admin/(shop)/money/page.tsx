import Link from "next/link";
import { formatMoney, listPayouts, listRequirements, moneySummary, planAdvice, PLANS } from "@sf/core";
import { requireShop, testPayments } from "@/lib/server";
import { runPayoutsAction, setupPayoutsAction, simulateHoldAction } from "../../money-actions";
import { PageHeader } from "../PageHeader";
import { UploadDocumentForm } from "./MoneyActions";

export const metadata = { title: "Money" };

const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const PAYOUT_STATUS: Record<string, [string, string]> = {
  pending: ["Scheduled", "pill-info"],
  in_transit: ["On the way", "pill-info"],
  paid: ["Arrived", "pill-success"],
  failed: ["Failed", "pill-critical"],
  canceled: ["Cancelled", "pill-neutral"],
};

export default async function MoneyPage({ searchParams }: { searchParams: Promise<{ setup?: string }> }) {
  const { shop, db } = await requireShop("money");
  const [{ setup }, summary, requirements, payouts, advice] = await Promise.all([
    searchParams,
    moneySummary(db, shop),
    listRequirements(db, shop.id),
    listPayouts(db, shop.id),
    planAdvice(db, shop),
  ]);
  const money = (m: number) => formatMoney(m, shop.currency);
  const plan = PLANS[shop.plan];
  const holds = requirements.filter((r) => r.holdsPayouts);
  const test = testPayments();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  return (
    <main className="pb-12">
      <PageHeader title="Money" actions={<a className="btn btn-secondary" href={`/admin/money/statement?from=${monthAgo}&to=${today}`}>Download statement (CSV)</a>} />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-4xl">
        {setup === "done" && shop.payoutsEnabled && <p className="banner banner-info" role="status">Payouts are set up. Money from sales goes to your bank automatically.</p>}

        {!shop.paymentsAccountId ? (
          <section className="card p-5 flex flex-col gap-3">
            <h2 className="font-semibold">Set up payouts to get paid</h2>
            <p className="text-sm">
              Buyers pay by card through Stripe, and the money goes straight to your bank. Setup takes about five minutes: your bank
              account and a few details to confirm who you are.
            </p>
            <form action={setupPayoutsAction}><button className="btn btn-primary">Set up payouts</button></form>
            {test && <p className="hint">Test mode: this connects a pretend account straight away, no forms.</p>}
          </section>
        ) : !shop.payoutsEnabled && !requirements.length ? (
          <section className="card p-5 flex flex-col gap-3">
            <h2 className="font-semibold">Finish payout setup</h2>
            <p className="text-sm">A few details are still missing before money can be paid out.</p>
            <div><Link className="btn btn-primary" href="/admin/money/setup">Continue setup</Link></div>
          </section>
        ) : null}

        {requirements.map((r) => (
          <section key={r.id} className={`card p-5 flex flex-col gap-3 ${r.holdsPayouts ? "border-critical" : ""}`} aria-labelledby={`req-${r.id}`}>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 id={`req-${r.id}`} className="font-semibold">{r.holdsPayouts ? "Payouts paused: " : ""}{r.title} needed</h2>
              {r.submittedAt ? <span className="pill pill-info">Sent, being checked</span> : r.dueBy ? <span className="pill pill-warning">Due {day.format(r.dueBy)}</span> : <span className="pill pill-critical">Needed now</span>}
            </div>
            <p className="text-sm"><span className="font-semibold">Why: </span>{r.explanation}</p>
            {r.holdsPayouts && (
              <p className="text-sm">
                Your money is safe. Sales keep coming in and are paid out as soon as this is cleared
                {summary.availableMinor > 0 ? <> ({money(summary.availableMinor)} is waiting)</> : null}.
              </p>
            )}
            {r.kind === "review" ? null : r.upload ? (
              <UploadDocumentForm requirementId={r.id} label={r.submittedAt ? "Send another file" : `Upload your ${r.title.toLowerCase()}`} />
            ) : (
              <div><Link className="btn btn-primary" href="/admin/money/setup">Update details</Link></div>
            )}
          </section>
        ))}

        <section aria-label="Balance" className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border border border-border rounded-xl overflow-hidden">
          {[
            ["Available", summary.availableMinor, holds.length ? "Paused until the request above is cleared" : "Goes out in the next payout"],
            ["Clearing", summary.pendingMinor, "Card payments take about 2 days"],
            ["On the way", summary.onTheWayMinor, "Sent to your bank"],
            ["Paid out", summary.paidOutMinor, "All time"],
          ].map(([k, v, note]) => (
            <div key={k as string} className="bg-surface p-4 flex flex-col gap-1">
              <span className="hint">{k}</span>
              <span className={`text-2xl font-semibold num ${(v as number) < 0 ? "text-critical" : ""}`}>{money(v as number)}</span>
              <span className="hint text-xs">{note}</span>
            </div>
          ))}
        </section>

        <section className="card p-5 flex flex-col gap-3">
          <h2 className="font-semibold">Last 30 days</h2>
          <dl className="text-sm grid grid-cols-[1fr_auto] gap-y-2 num max-w-md">
            <dt>Sales ({summary.last30.orders} {summary.last30.orders === 1 ? "order" : "orders"}, after refunds)</dt><dd>{money(summary.last30.salesMinor)}</dd>
            <dt className="hint">Refunded</dt><dd className="hint">{money(summary.last30.refundsMinor)}</dd>
            <dt>Our fee ({plan.feeBps ? `${plan.feeBps / 100}% on the ${plan.name} plan` : `0% on the ${plan.name} plan`})</dt><dd>−{money(summary.last30.platformFeesMinor)}</dd>
            <dt>Card processing (estimated)</dt><dd>−{money(summary.last30.processingFeesMinor)}</dd>
            <dt>Tax collected <Link className="hint underline" href="/admin/taxes">(you pay this to the tax office)</Link></dt><dd>−{money(summary.last30.taxMinor)}</dd>
            <dt>Shipping charged to buyers</dt><dd>−{money(summary.last30.shippingMinor)}</dd>
            <dt>Supplier costs</dt><dd>−{money(summary.last30.supplierCostsMinor)}</dd>
            <dt className="font-semibold border-t border-border pt-2">Profit</dt>
            <dd className={`font-semibold border-t border-border pt-2 ${summary.last30.profitMinor >= 0 ? "text-success" : "text-critical"}`}>{money(summary.last30.profitMinor)}</dd>
          </dl>
          <p className="hint">The shipping you charge is set against the supplier's shipping. Supplier costs are paid to your supplier, not taken from payouts. Ad spend isn't included yet.</p>
          {advice.best && (
            <p className="banner banner-info">
              The {PLANS[advice.best.plan].name} plan would have saved you {money(advice.best.saveMinor)} this month.{" "}
              <Link className="underline font-semibold" href="/admin/plan">Compare plans</Link>
            </p>
          )}
          {advice.overLimit && (
            <p className="banner banner-critical">
              You had {advice.orders} orders this month, over the {plan.ordersPerMonth} included in {plan.name}. Orders still go through.{" "}
              <Link className="underline font-semibold" href="/admin/plan">Change plan</Link>
            </p>
          )}
        </section>

        <section className="card">
          <h2 className="font-semibold px-5 pt-4 pb-2">Payouts</h2>
          {payouts.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left hint"><th className="px-5 py-2 font-medium">Arrives</th><th className="px-5 py-2 font-medium">Status</th><th className="px-5 py-2 font-medium text-right">Amount</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payouts.map((p) => {
                  const [label, cls] = PAYOUT_STATUS[p.status]!;
                  return (
                    <tr key={p.id}>
                      <td className="px-5 py-3 num">{p.arrivalDate ? day.format(new Date(`${p.arrivalDate}T12:00:00Z`)) : "Not scheduled"}</td>
                      <td className="px-5 py-3"><span className={`pill ${cls}`}>{label}</span>{p.failureReason && <span className="hint block">{p.failureReason}</span>}</td>
                      <td className="px-5 py-3 num text-right">{formatMoney(p.amountMinor, p.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="hint px-5 pb-4">No payouts yet. The first one goes out about two days after your first sale.</p>
          )}
        </section>

        {test && shop.paymentsAccountId && (
          <section className="card p-5 flex flex-col gap-3 border-dashed">
            <h2 className="font-semibold">Test mode</h2>
            <p className="hint">No real money moves. Use these to see what payouts and holds look like.</p>
            <div className="flex gap-2 flex-wrap">
              <form action={runPayoutsAction}><button className="btn btn-secondary">Pay out now</button></form>
              <form action={simulateHoldAction} className="flex flex-wrap gap-2 min-w-0">
                <label className="sr-only" htmlFor="kind">Hold reason</label>
                <select id="kind" name="kind" className="input text-sm sm:w-auto">
                  <option value="identity_document">ID check</option>
                  <option value="proof_of_address">Proof of address</option>
                  <option value="supplier_invoice">Sales spike (supplier invoice)</option>
                  <option value="tracking_info">Disputes (proof of delivery)</option>
                </select>
                <button className="btn btn-secondary">Simulate a payout hold</button>
              </form>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
