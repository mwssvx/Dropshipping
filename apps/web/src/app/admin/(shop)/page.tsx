import Link from "next/link";
import { formatMoney, listOrders, listProducts, listRequirements } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "./PageHeader";

export const metadata = { title: "Home" };

export default async function AdminHome() {
  const { shop, db } = await requireShop();
  const [orders, products, requirements] = await Promise.all([listOrders(db, shop.id), listProducts(db, shop.id), listRequirements(db, shop.id)]);
  const holds = requirements.filter((r) => r.holdsPayouts);
  const paid = orders.filter((o) => o.paymentStatus === "paid");
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const today = paid.filter((o) => o.paidAt && o.paidAt >= startOfDay);
  const toSend = paid.filter((o) => o.fulfillmentStatus === "unfulfilled");
  const problems = paid.filter((o) => o.fulfillmentStatus === "problem");
  const hasActive = products.some((p) => p.status === "active");

  const steps = [
    { done: true, title: "Create your store", href: "/admin" },
    { done: products.length > 0, title: "Import your first product", href: "/admin/products/import" },
    { done: hasActive, title: "Make a product active so buyers can see it", href: "/admin/products" },
    { done: paid.length > 0, title: "Place a test order on your store", href: `/s/${shop.handle}` },
    { done: shop.payoutsEnabled || requirements.length > 0, title: "Set up payouts so you get paid", href: "/admin/money" },
  ];
  const left = steps.filter((s) => !s.done).length;

  return (
    <main className="pb-12">
      <PageHeader title={`Welcome to ${shop.name}`} />
      <div className="px-4 sm:px-8 grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6 min-w-0">
          <section className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-border border border-border rounded-xl overflow-hidden">
            {[
              ["Sales today", formatMoney(today.reduce((s, o) => s + o.totalMinor, 0), shop.currency)],
              ["Orders today", String(today.length)],
              ["Products", String(products.length)],
            ].map(([k, v]) => (
              <div key={k} className="bg-surface p-4 flex flex-col gap-1">
                <span className="hint">{k}</span>
                <span className="text-2xl font-semibold num">{v}</span>
              </div>
            ))}
          </section>
          <section className="card">
            <h2 className="font-semibold px-4 pt-4">Needs your attention</h2>
            {toSend.length || problems.length || holds.length ? (
              <ul className="p-2">
                {holds.length > 0 && (
                  <li>
                    <Link href="/admin/money" className="flex items-center justify-between gap-3 px-2 py-3 rounded-md hover:bg-sunken">
                      <span><span className="pill pill-critical mr-2">Payouts paused</span>The payment processor needs: {holds.map((h) => h.title.toLowerCase()).join(", ")}</span>
                      <span className="hint">Send →</span>
                    </Link>
                  </li>
                )}
                {problems.length > 0 && (
                  <li>
                    <Link href="/admin/orders?show=problems" className="flex items-center justify-between gap-3 px-2 py-3 rounded-md hover:bg-sunken">
                      <span><span className="pill pill-critical mr-2">Problem</span>{problems.length} {problems.length === 1 ? "order needs" : "orders need"} you: the supplier refused or hasn't shipped</span>
                      <span className="hint">Fix →</span>
                    </Link>
                  </li>
                )}
                {toSend.length > 0 && <li>
                  <Link href="/admin/orders" className="flex items-center justify-between gap-3 px-2 py-3 rounded-md hover:bg-sunken">
                    <span><span className="pill pill-warning mr-2">To send</span>{toSend.length} paid {toSend.length === 1 ? "order is" : "orders are"} waiting to be sent</span>
                    <span className="hint">Review →</span>
                  </Link>
                </li>}
              </ul>
            ) : (
              <p className="hint px-4 pb-4 pt-2">Nothing right now. Problem orders, payout holds and supplier issues will show up here.</p>
            )}
          </section>
        </div>
        <section className="card p-4 flex flex-col gap-3 self-start">
          <div>
            <h2 className="font-semibold">Set up your store</h2>
            <p className="hint">{left === 0 ? "All done." : `${left} ${left === 1 ? "step" : "steps"} left`}</p>
          </div>
          <ol className="flex flex-col gap-1">
            {steps.map((s) => (
              <li key={s.title}>
                {s.href && !s.done ? (
                  <Link href={s.href} className="flex gap-3 items-start px-2 py-2 rounded-md hover:bg-sunken">
                    <Check done={s.done} /><span className="text-sm font-medium">{s.title}</span>
                  </Link>
                ) : (
                  <div className="flex gap-3 items-start px-2 py-2">
                    <Check done={s.done} />
                    <span className={`text-sm ${s.done ? "text-muted line-through" : ""}`}>{s.title}</span>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}

function Check({ done }: { done: boolean }) {
  return (
    <span aria-hidden className={`mt-0.5 size-4 shrink-0 rounded-full border-2 grid place-items-center ${done ? "bg-accent border-accent" : "border-border-strong"}`}>
      {done && <svg viewBox="0 0 12 12" className="size-2.5 text-accent-ink" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2.5 6.5l2.2 2.2 4.8-5" /></svg>}
    </span>
  );
}
