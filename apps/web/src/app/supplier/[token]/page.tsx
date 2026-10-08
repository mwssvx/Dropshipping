import { notFound } from "next/navigation";
import { CANT_SEND_REASONS, supplierPortal } from "@sf/core";
import { BRAND } from "@/lib/brand";
import { db } from "@/lib/server";
import { ShipForm } from "./PortalForms";

export const metadata = { title: "Orders to send", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** One of a store's own suppliers sees the orders they need to send and adds tracking. No account needed. */
export default async function SupplierPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const portal = await supplierPortal(await db(), token);
  if (!portal) notFound();
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="hint">{BRAND} · for {portal.supplier.name}</p>
        <h1 className="text-3xl font-bold tracking-tight">Orders to send for {portal.shop.name}</h1>
        <p className="text-muted">Add the tracking number once each parcel ships. The buyer gets it by email straight away.</p>
      </header>
      <section className="flex flex-col gap-4" aria-labelledby="to-send">
        <h2 id="to-send" className="font-semibold">To send ({portal.toSend.length})</h2>
        {portal.toSend.length === 0 && <p className="card p-5 hint">Nothing to send right now. New orders arrive by email too.</p>}
        {portal.toSend.map((o) => (
          <article key={o.id} className="card p-5 flex flex-col gap-4" aria-label={`Order ${o.ref}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">Order {o.ref}</h3>
              {o.placedAt && <span className="hint">Ordered {date.format(o.placedAt)}</span>}
            </div>
            <div className="grid sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="label">Items</p>
                <ul>{o.items.map((i, n) => <li key={n}>{i.quantity} × {i.title}{i.sku ? <span className="hint"> · SKU {i.sku}</span> : null}</li>)}</ul>
              </div>
              <div>
                <p className="label">Ship to</p>
                <address className="not-italic">{o.shipTo.map((l, n) => <span key={n} className="block">{l}</span>)}</address>
              </div>
            </div>
            <ShipForm token={token} id={o.id} reasons={CANT_SEND_REASONS} />
          </article>
        ))}
      </section>
      {portal.sent.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="sent">
          <h2 id="sent" className="font-semibold">Sent</h2>
          <ul className="card divide-y divide-border text-sm">
            {portal.sent.map((o) => (
              <li key={o.id} className="p-4 flex flex-wrap justify-between gap-2">
                <span>Order {o.ref} · {o.items.map((i) => `${i.quantity} × ${i.title}`).join(", ")}</span>
                <span className="hint">{o.carrier} {o.trackingNumber}{o.shippedAt ? ` · ${date.format(o.shippedAt)}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
