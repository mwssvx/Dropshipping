import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney, getOrder, NotFoundError } from "@sf/core";
import { requireShop } from "@/lib/server";
import { FulfilmentStatus, PaymentStatus } from "@/components/Status";
import { PageHeader } from "../../PageHeader";

const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { shop, db } = await requireShop();
  const order = await getOrder(db, shop.id, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const money = (m: number) => formatMoney(m, order.currency);
  const cost = order.lines.reduce((s, l) => s + (l.unitCostMinor ?? 0) * l.quantity, 0);
  const knownCost = order.lines.every((l) => l.unitCostMinor != null);
  const a = order.shippingAddress;
  const timeline = [
    { at: order.createdAt, text: "Order placed" },
    ...(order.paidAt ? [{ at: order.paidAt, text: `Payment of ${money(order.totalMinor)} received` }] : []),
  ].reverse();

  return (
    <main className="pb-12">
      <PageHeader title={`Order #${order.number}`} back={<Link href="/admin/orders" className="hint hover:text-ink">← Orders</Link>}
        actions={<div className="flex gap-2 items-center"><PaymentStatus value={order.paymentStatus} /><FulfilmentStatus value={order.fulfillmentStatus} /></div>} />
      <div className="px-4 sm:px-8 grid gap-6 lg:grid-cols-[1fr_320px] items-start">
        <div className="flex flex-col gap-6 min-w-0">
          <section className="card">
            <h2 className="font-semibold px-5 pt-4 pb-2">Items</h2>
            <ul className="divide-y divide-border">
              {order.lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-4 px-5 py-3 text-sm">
                  <span>{l.title} <span className="hint">× {l.quantity}</span></span>
                  <span className="num">{money(l.unitPriceMinor * l.quantity)}</span>
                </li>
              ))}
            </ul>
            <dl className="border-t border-border px-5 py-4 text-sm grid grid-cols-[1fr_auto] gap-y-1 num">
              <dt className="hint">Subtotal</dt><dd>{money(order.subtotalMinor)}</dd>
              <dt className="hint">Shipping</dt><dd>{order.shippingMinor ? money(order.shippingMinor) : "Free"}</dd>
              <dt className="hint">Tax</dt><dd>{money(order.taxMinor)}</dd>
              <dt className="font-semibold">Total</dt><dd className="font-semibold">{money(order.totalMinor)}</dd>
              {knownCost && <><dt className="hint">Profit after supplier cost</dt><dd className="text-success font-semibold">{money(order.subtotalMinor - cost)}</dd></>}
            </dl>
          </section>
          <section className="card p-5">
            <h2 className="font-semibold mb-3">Timeline</h2>
            <ol className="flex flex-col gap-3 border-l-2 border-border pl-4">
              {timeline.map((t) => (
                <li key={t.text} className="text-sm relative">
                  <span className="absolute -left-[23px] top-1.5 size-2.5 rounded-full bg-accent" aria-hidden />
                  {t.text} <span className="hint num">· {when.format(t.at)}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <aside className="card p-5 flex flex-col gap-4 text-sm">
          <div>
            <h2 className="font-semibold mb-1">Customer</h2>
            <p>{a.name}</p>
            <p className="hint break-all">{order.email}</p>
          </div>
          <div>
            <h2 className="font-semibold mb-1">Ship to</h2>
            <address className="not-italic hint">
              {a.line1}{a.line2 ? <>, {a.line2}</> : null}<br />{a.city}{a.region ? `, ${a.region}` : ""} {a.postalCode}<br />{a.country}
            </address>
          </div>
        </aside>
      </div>
    </main>
  );
}
