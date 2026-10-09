import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { buyerAmounts, formatMoney, getOrder, NotFoundError } from "@sf/core";
import { db, payments } from "@/lib/server";
import { SubmitButton } from "@/components/SubmitButton";
import { fakePayAction } from "../../actions";
import { loadShop, storeBase } from "../../data";
import { CardForm } from "./CardForm";

export const metadata = { title: "Payment" };

export default async function PayPage({ params }: { params: Promise<{ shop: string; orderId: string }> }) {
  const { shop: handle, orderId } = await params;
  const shop = await loadShop(handle);
  const base = await storeBase(handle);
  const order = await getOrder(await db(), shop.id, orderId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (order.paymentStatus !== "pending" && order.paymentStatus !== "failed") redirect(`${base}/orders/${order.paymentIntentId}`);
  const provider = payments();
  // What the buyer pays, in their own currency when they shopped in one.
  const due = buyerAmounts(order, order.lines);
  const money = (m: number) => formatMoney(m, due.currency);
  const payLabel = `Pay ${money(due.chargedMinor)}`;
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  let card: React.ReactNode = null;
  if (provider.name === "stripe" && publishableKey) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "https";
    const returnUrl = `${proto}://${host}${base}/orders/${order.paymentIntentId}`;
    card = <CardForm publishableKey={publishableKey} clientSecret={await provider.clientSecret(order.paymentIntentId!)} returnUrl={returnUrl} payLabel={payLabel} />;
  }

  return (
    <main className="max-w-md mx-auto px-4 sm:px-6 py-12 flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Payment</h1>
      {order.source === "payment_link" && (
        <div className="flex flex-col gap-2">
          <p>{shop.name} put together this order for {order.shippingAddress.name.split(" ")[0]}. It ships to {order.shippingAddress.line1}, {order.shippingAddress.city}.</p>
          {order.note && <p className="border-l-2 border-border pl-3 whitespace-pre-line text-muted">{order.note}</p>}
        </div>
      )}
      <dl className="card p-5 grid grid-cols-[1fr_auto] gap-y-1 num text-sm">
        {order.lines.map((l, n) => (
          <div key={l.id} className="contents">
            <dt>{l.title} <span className="hint">× {l.quantity}</span></dt><dd className="text-right">{money(due.lines[n]!)}</dd>
          </div>
        ))}
        {order.discountMinor > 0 && (
          <>
            <dt className="hint border-t border-border pt-2 mt-1">Discount ({order.discountCode})</dt>
            <dd className="text-right border-t border-border pt-2 mt-1">−{money(due.discountMinor)}</dd>
          </>
        )}
        <dt className={`hint ${order.discountMinor ? "" : "border-t border-border pt-2 mt-1"}`}>Shipping{order.discountCode && !order.shippingMinor && !order.discountMinor ? ` (${order.discountCode})` : order.shippingMethod ? ` (${order.shippingMethod})` : ""}</dt>
        <dd className={`text-right ${order.discountMinor ? "" : "border-t border-border pt-2 mt-1"}`}>{due.shippingMinor ? money(due.shippingMinor) : "Free"}</dd>
        {order.taxMinor > 0 && (
          <>
            <dt className="hint">{order.taxBreakdown.map((t) => t.label).join(", ") || "Tax"}{order.taxIncluded ? " (included)" : ""}</dt>
            <dd className="text-right">{money(due.taxMinor)}</dd>
          </>
        )}
        {due.giftCardMinor > 0 && (
          <>
            <dt className="hint">Total</dt><dd className="text-right">{money(due.totalMinor)}</dd>
            <dt className="hint">Gift card</dt><dd className="text-right">−{money(due.giftCardMinor)}</dd>
          </>
        )}
        <dt className="font-semibold text-base">Total due</dt><dd className="font-semibold text-base text-right">{money(due.chargedMinor)}</dd>
      </dl>
      {order.paymentStatus === "failed" && <p className="banner banner-critical">The last attempt didn't go through. You can try again.</p>}
      {provider.name === "fake" ? (
        <form action={fakePayAction.bind(null, handle, order.id)} className="card p-5 flex flex-col gap-4">
          <p className="banner banner-info">Test mode: no real card is charged.</p>
          <SubmitButton className="btn btn-primary btn-lg" pendingText="Paying…">{payLabel}</SubmitButton>
        </form>
      ) : card ?? <p className="banner banner-critical">Card payments aren't switched on for this store yet.</p>}
    </main>
  );
}
