import { notFound } from "next/navigation";
import { formatMoney, getOrderByPaymentIntent, NotFoundError } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop } from "../../data";

export const metadata = { title: "Order status", robots: { index: false } };

export default async function OrderStatusPage({ params }: { params: Promise<{ shop: string; ref: string }> }) {
  const { shop: handle, ref } = await params;
  const shop = await loadShop(handle);
  const order = await getOrderByPaymentIntent(await db(), shop.id, ref).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const paid = order.paymentStatus === "paid";
  const steps = [
    { label: "Order confirmed", done: paid },
    { label: "Sent to our warehouse", done: order.fulfillmentStatus !== "unfulfilled" },
    { label: "On its way", done: ["shipped", "delivered"].includes(order.fulfillmentStatus) },
    { label: "Delivered", done: order.fulfillmentStatus === "delivered" },
  ];
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="hint num">Order #{order.number}</p>
        <h1 className="text-3xl font-bold tracking-tight">{paid ? `Thank you, ${order.shippingAddress.name.split(" ")[0]}!` : "We're waiting for your payment"}</h1>
        <p className="text-muted">{paid ? `We've emailed a receipt to ${order.email}. This page updates as your order moves.` : "If you've paid, this page updates in a moment."}</p>
      </div>
      <ol className="grid grid-cols-4 gap-2" aria-label="Order progress">
        {steps.map((s) => (
          <li key={s.label} className="flex flex-col gap-2">
            <span className={`h-1.5 rounded-full ${s.done ? "bg-accent" : "bg-sunken"}`} />
            <span className={`text-xs ${s.done ? "font-semibold" : "hint"}`}>{s.label}</span>
          </li>
        ))}
      </ol>
      <section className="card p-5 flex flex-col gap-3 text-sm">
        {order.lines.map((l) => (
          <div key={l.id} className="flex justify-between gap-3"><span>{l.title} × {l.quantity}</span><span className="num">{formatMoney(l.unitPriceMinor * l.quantity, order.currency)}</span></div>
        ))}
        <div className="flex justify-between gap-3 border-t border-border pt-3 font-semibold"><span>Total</span><span className="num">{formatMoney(order.totalMinor, order.currency)}</span></div>
      </section>
    </main>
  );
}
