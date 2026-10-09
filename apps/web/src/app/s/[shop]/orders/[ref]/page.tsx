import { notFound } from "next/navigation";
import { buyerAmounts, buyerThread, formatMoney, getOrderByPaymentIntent, listRefunds, NotFoundError, reviewableItems } from "@sf/core";
import Link from "next/link";
import { db } from "@/lib/server";
import { loadShop, storeBase } from "../../data";
import { ReviewForm } from "./ReviewForm";
import { QuestionForm } from "./QuestionForm";

const time = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const metadata = { title: "Order status", robots: { index: false } };

export default async function OrderStatusPage({ params }: { params: Promise<{ shop: string; ref: string }> }) {
  const { shop: handle, ref } = await params;
  const shop = await loadShop(handle);
  const order = await getOrderByPaymentIntent(await db(), shop.id, ref).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const paid = ["paid", "partially_refunded", "refunded"].includes(order.paymentStatus);
  const thread = paid ? await buyerThread(await db(), shop.id, ref) : [];
  const reviewable = paid ? await reviewableItems(await db(), shop.id, ref) : [];
  const base = await storeBase(handle);
  // Amounts as the buyer paid them, in their own currency when they shopped in one.
  const refunds = order.presentment && order.refundedMinor ? await listRefunds(await db(), order.id) : [];
  const due = buyerAmounts(order, order.lines, order.presentment ? refunds.reduce((s, r) => s + (r.presentmentAmountMinor ?? 0), 0) : undefined);
  const money = (m: number) => formatMoney(m, due.currency);
  const shipped = order.fulfillments.filter((f) => f.trackingNumber);
  const steps = [
    { label: "Order confirmed", done: paid },
    { label: "Being prepared", done: order.fulfillments.some((f) => f.placedAt || f.shippedAt) },
    { label: "On its way", done: ["shipped", "delivered"].includes(order.fulfillmentStatus) },
    { label: "Delivered", done: order.fulfillmentStatus === "delivered" },
  ];
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="hint num">Order #{order.number}</p>
        <h1 className="text-3xl font-bold tracking-tight">{paid ? `Thank you, ${order.shippingAddress.name.split(" ")[0]}!` : "We're waiting for your payment"}</h1>
        <p className="text-muted">{paid ? `We've emailed a receipt to ${order.email}. This page updates as your order moves.` : "If you've paid, this page updates in a moment."}</p>
        {paid && <Link href={`${base}/account`} className="text-sm underline self-start">See all your orders</Link>}
        {order.paymentStatus === "pending" && (
          <Link href={`${base}/pay/${order.id}`} className="btn btn-primary self-start">Finish paying</Link>
        )}
      </div>
      {order.refundedMinor > 0 && (
        <p className="banner banner-info">
          {order.paymentStatus === "refunded" ? "This order was refunded" : `${money(due.refundedMinor)} was refunded`}
          {order.giftCardMinor
            ? " to how you paid: card refunds take 5 to 10 business days, and gift card refunds can be used right away."
            : " to the card you paid with. Banks usually show it within 5 to 10 business days."}
        </p>
      )}
      <ol className="grid grid-cols-4 gap-2" aria-label="Order progress">
        {steps.map((s) => (
          <li key={s.label} className="flex flex-col gap-2">
            <span className={`h-1.5 rounded-full ${s.done ? "bg-accent" : "bg-sunken"}`} />
            <span className={`text-xs ${s.done ? "font-semibold" : "hint"}`}>{s.label}</span>
          </li>
        ))}
      </ol>
      {shipped.length > 0 && (
        <section className="card p-5 flex flex-col gap-2 text-sm" aria-labelledby="tracking">
          <h2 id="tracking" className="font-semibold">Tracking</h2>
          {shipped.map((f) => (
            <p key={f.id}>
              {f.carrier}:{" "}
              {f.trackingUrl ? <a className="underline num" href={f.trackingUrl} target="_blank" rel="noreferrer">{f.trackingNumber}</a> : <span className="num">{f.trackingNumber}</span>}
              {f.status === "delivered" && <span className="hint"> · delivered</span>}
            </p>
          ))}
        </section>
      )}
      {paid && shipped.length === 0 && (
        <p className="hint text-sm">
          {order.lines.length === 1 ? "Your item usually ships" : "Your items usually ship"} within a few days. We&apos;ll email tracking to {order.email} as soon as it&apos;s on its way.
        </p>
      )}
      <section className="card p-5 flex flex-col gap-3 text-sm">
        {order.lines.map((l, n) => (
          <div key={l.id} className="flex justify-between gap-3"><span>{l.title} × {l.quantity}</span><span className="num">{money(due.lines[n]!)}</span></div>
        ))}
        {order.discountMinor > 0 && (
          <div className="flex justify-between gap-3 hint"><span>Discount ({order.discountCode})</span><span className="num">−{money(due.discountMinor)}</span></div>
        )}
        <div className="flex justify-between gap-3 hint"><span>Shipping{order.shippingMethod ? ` (${order.shippingMethod})` : ""}</span><span className="num">{due.shippingMinor ? money(due.shippingMinor) : "Free"}</span></div>
        {order.taxMinor > 0 && (
          <div className="flex justify-between gap-3 hint"><span>{order.taxBreakdown.map((t) => t.label).join(", ") || "Tax"}{order.taxIncluded ? " (included)" : ""}</span><span className="num">{money(due.taxMinor)}</span></div>
        )}
        <div className="flex justify-between gap-3 border-t border-border pt-3 font-semibold"><span>Total</span><span className="num">{money(due.totalMinor)}</span></div>
        {due.giftCardMinor > 0 && (
          <>
            <div className="flex justify-between gap-3 hint"><span>Paid with gift card</span><span className="num">−{money(due.giftCardMinor)}</span></div>
            <div className="flex justify-between gap-3 hint"><span>Paid by card</span><span className="num">{money(due.chargedMinor)}</span></div>
          </>
        )}
      </section>
      {reviewable.length > 0 && (
        <section id="review" className="card p-5 flex flex-col gap-4" aria-labelledby="review-heading">
          <h2 id="review-heading" className="font-semibold">How was it?</h2>
          {reviewable.map((item) =>
            item.review ? (
              <p key={item.productId} className="text-sm">
                <span className="font-medium">{item.title}:</span> you gave it {item.review.rating} of 5 stars.{" "}
                {item.review.status === "pending" ? "It shows on the store once the shop has had a look." : "Thank you!"}
              </p>
            ) : (
              <ReviewForm key={item.productId} handle={handle} orderRef={ref} productId={item.productId} title={item.title} name={order.shippingAddress.name.split(" ")[0] ?? ""} />
            ),
          )}
        </section>
      )}
      {paid && (
        <section className="card p-5 flex flex-col gap-4" aria-labelledby="questions">
          <h2 id="questions" className="font-semibold">Questions</h2>
          {thread.length > 0 && (
            <ol className="flex flex-col gap-3">
              {thread.map((m) => (
                <li key={m.id} className={`flex flex-col gap-1 max-w-[85%] ${m.author === "buyer" ? "self-end items-end" : "self-start"}`}>
                  <span className="hint">{m.author === "buyer" ? "You" : shop.name} · {time.format(m.createdAt)}</span>
                  <div className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-line ${m.author === "buyer" ? "bg-accent text-accent-ink" : "bg-sunken"}`}>{m.body}</div>
                </li>
              ))}
            </ol>
          )}
          <QuestionForm handle={handle} orderRef={ref} email={order.email} />
        </section>
      )}
    </main>
  );
}
