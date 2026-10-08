import Link from "next/link";
import { abandonedCartStats, describeDiscount, formatMoney, listDiscounts } from "@sf/core";
import { requireShop, testPayments } from "@/lib/server";
import { sendRemindersNowAction, setDiscountActiveAction, setRemindersAction } from "../../growth-actions";
import { PageHeader } from "../PageHeader";
import { DiscountForm } from "./DiscountForm";

export const metadata = { title: "Marketing" };

const DAY = 86_400_000;
const date = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function MarketingPage() {
  const { shop, db } = await requireShop("marketing");
  const [discounts, stats] = await Promise.all([listDiscounts(db, shop.id), abandonedCartStats(db, shop.id, new Date(Date.now() - 30 * DAY))]);
  const money = (m: number) => formatMoney(m, shop.currency);
  const now = new Date();
  const state = (d: (typeof discounts)[number]) =>
    !d.active ? "Turned off" : d.endsAt && d.endsAt <= now ? "Expired" : d.startsAt && d.startsAt > now ? `Starts ${date(d.startsAt)}` : d.usageLimit !== null && d.used >= d.usageLimit ? "Used up" : "Live";

  return (
    <main className="pb-12">
      <PageHeader title="Marketing" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        <section className="card p-5 flex flex-wrap items-center gap-3" aria-labelledby="campaigns-link-heading">
          <div className="flex-1 min-w-56">
            <h2 id="campaigns-link-heading" className="font-semibold">Email campaigns</h2>
            <p className="hint">Write to buyers who said yes to emails, and see the clicks and sales each email brings.</p>
          </div>
          <Link href="/admin/campaigns" className="btn btn-secondary">Open campaigns</Link>
        </section>
        <section className="card p-5 flex flex-col gap-4" aria-labelledby="codes-heading">
          <div>
            <h2 id="codes-heading" className="font-semibold">Discount codes</h2>
            <p className="hint">Buyers type a code in the cart. Only paid orders count toward a code's limit.</p>
          </div>
          {discounts.length ? (
            <ul className="divide-y divide-border border-y border-border">
              {discounts.map((d) => {
                const s = state(d);
                return (
                  <li key={d.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="font-mono font-semibold">{d.code}</span>
                    <span className="flex-1 min-w-40">
                      {describeDiscount(d, shop.currency)}
                      <span className="hint">
                        {d.usageLimit !== null && ` · ${d.usageLimit} uses`}
                        {d.oncePerCustomer && " · once per buyer"}
                        {d.endsAt && ` · until ${date(d.endsAt)}`}
                      </span>
                    </span>
                    <span className={`pill ${s === "Live" ? "pill-success" : "pill-neutral"}`}>{s}</span>
                    <span className="hint num w-full sm:w-auto">
                      Used {d.used} {d.used === 1 ? "time" : "times"}
                      {d.used > 0 && ` · ${money(d.salesMinor)} in sales · ${money(d.discountedMinor)} off`}
                    </span>
                    <form action={setDiscountActiveAction.bind(null, d.id, !d.active)}>
                      <button className="hint hover:text-ink" aria-label={`${d.active ? "Turn off" : "Turn on"} ${d.code}`}>{d.active ? "Turn off" : "Turn on"}</button>
                    </form>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="hint">No codes yet. A first-order code like WELCOME10 is a good start.</p>
          )}
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <h3 className="font-medium text-sm">New code</h3>
            <DiscountForm currency={shop.currency} />
          </div>
        </section>

        <section className="card p-5 flex flex-col gap-3" aria-labelledby="reminders-heading">
          <h2 id="reminders-heading" className="font-semibold">Checkout reminders</h2>
          <p className="text-sm">
            When a buyer starts checkout but doesn't pay, we email them once, about an hour later, with a link straight back to
            payment. Nobody gets more than one a day, and buyers who paid in the meantime are skipped.
          </p>
          <form action={setRemindersAction} className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="abandonedCartEmails" defaultChecked={shop.abandonedCartEmails} />
              Send checkout reminders
            </label>
            <button className="btn btn-secondary">Save</button>
          </form>
          <dl className="grid grid-cols-3 gap-3 border-t border-border pt-3 text-sm">
            <div><dt className="hint">Sent, last 30 days</dt><dd className="text-lg font-semibold num">{stats.sent}</dd></div>
            <div><dt className="hint">Then paid</dt><dd className="text-lg font-semibold num">{stats.recovered}</dd></div>
            <div><dt className="hint">Sales won back</dt><dd className="text-lg font-semibold num">{money(stats.recoveredMinor)}</dd></div>
          </dl>
          {testPayments() && (
            <form action={sendRemindersNowAction} className="flex items-center gap-3 border-t border-border pt-3">
              <button className="btn btn-secondary">Send reminders now</button>
              <span className="hint">Test mode: sends as if an hour had passed.</span>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
