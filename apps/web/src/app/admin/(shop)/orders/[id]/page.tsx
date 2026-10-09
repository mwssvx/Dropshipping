import Link from "next/link";
import { notFound } from "next/navigation";
import { can, formatMoney, getOrder, listRefunds, listSupplierLinks, NotFoundError, supplierLabel as labelFor, PLANS, PROBLEM_FIXES, type ProblemCode } from "@sf/core";
import { requireShop, storeAddress, suppliers } from "@/lib/server";
import { PaymentLinkActions } from "./PaymentLinkActions";
import { CheckTrackingButton, ManualTrackingForm, RetryButton } from "./FulfillmentActions";
import { RefundForm } from "./RefundForm";
import { FixWithAiButton } from "./FixWithAiButton";
import { FulfilmentStatus, PaymentStatus } from "@/components/Status";
import { PageHeader } from "../../PageHeader";

const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ link?: string }> }) {
  const { id } = await params;
  const { link } = await searchParams;
  const { shop, db, role } = await requireShop("orders");
  const seesMoney = can(role, "money");
  const order = await getOrder(db, shop.id, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const money = (m: number) => formatMoney(m, order.currency);
  const cost = order.lines.reduce((s, l) => s + (l.unitCostMinor ?? 0) * l.quantity, 0);
  const knownCost = order.lines.every((l) => l.unitCostMinor != null);
  const a = order.shippingAddress;
  const [links, refunds, giftCard, returns] = await Promise.all([
    listSupplierLinks(db, shop.id),
    listRefunds(db, order.id),
    order.giftCardId ? db.query.giftCards.findFirst({ where: (g, { eq }) => eq(g.id, order.giftCardId!), columns: { last4: true } }) : undefined,
    db.query.returnRequests.findMany({ where: (r, { eq }) => eq(r.orderId, order.id), orderBy: (r, { desc }) => desc(r.createdAt) }),
  ]);
  const supplierLabel = (supplierId: string | null) => {
    if (!supplierId) return "Sent by you";
    return labelFor(suppliers(), links.find((l) => l.id === supplierId));
  };
  const EMAIL_LABEL = { order_confirmation: "Order confirmation", shipping_update: "Shipping update", delivered: "Delivery confirmation", refund: "Refund", support_reply: "Reply to a question", abandoned_cart: "Checkout reminder", payment_link: "Payment link" };
  const timeline = [
    { at: order.createdAt, text: "Order placed" },
    ...(order.paidAt
      ? [{ at: order.paidAt, text: order.giftCardMinor ? `Paid: ${money(order.giftCardMinor)} by gift card${order.totalMinor > order.giftCardMinor ? `, ${money(order.totalMinor - order.giftCardMinor)} by card` : ""}` : `Payment of ${money(order.totalMinor)} received` }]
      : []),
    ...order.fulfillments.flatMap((f) => [
      ...(f.placedAt ? [{ at: f.placedAt, text: `Sent to ${supplierLabel(f.supplierId)} (ref ${f.supplierOrderRef ?? "n/a"})` }] : []),
      ...(f.shippedAt ? [{ at: f.shippedAt, text: `Shipped with ${f.carrier}, tracking ${f.trackingNumber}` }] : []),
      ...(f.deliveredAt ? [{ at: f.deliveredAt, text: "Delivered" }] : []),
      ...(f.status === "failed" ? [{ at: f.updatedAt, text: f.problemCode && f.problemMessage?.includes("can't send it") ? f.problemMessage : `Supplier refused the order: ${f.problemMessage}` }] : []),
    ]),
    ...returns.map((r) => ({ at: r.createdAt, text: `Buyer asked to return ${r.items.map((i) => `${i.title} × ${i.quantity}`).join(", ")}` })),
    ...refunds.map((r) => ({ at: r.createdAt, text: `Refunded ${money(r.amountMinor)}${r.reason ? `: ${r.reason}` : ""}` })),
    ...order.fulfillments.flatMap((f) => (f.status === "cancelled" ? [{ at: f.updatedAt, text: `Supplier order cancelled (${supplierLabel(f.supplierId)})` }] : [])),
    ...order.emails.map((e) => ({
      at: e.sentAt ?? e.createdAt,
      text: `${EMAIL_LABEL[e.kind]} email ${e.status === "sent" ? "sent" : e.status === "failed" ? "failed to send" : "queued"} to ${e.to}`,
    })),
  ].sort((x, y) => y.at.getTime() - x.at.getTime());
  const problems = order.fulfillments.filter((f) => f.problemCode);
  const open = order.fulfillments.some((f) => (f.status === "placed" || f.status === "shipped") && f.supplierOrderRef);
  const paid = order.paymentStatus === "paid";
  const refundable = paid || order.paymentStatus === "partially_refunded";
  const feeBack = order.platformFeeMinor > 0;
  const feeKept = order.platformFeeMinor - refunds.reduce((s, r) => s + r.platformFeeRefundedMinor, 0);
  const net = order.totalMinor - order.refundedMinor - feeKept - order.processingFeeMinor;

  return (
    <main className="pb-12">
      <PageHeader title={`Order #${order.number}`} back={<Link href="/admin/orders" className="hint hover:text-ink">← Orders</Link>}
        actions={<div className="flex gap-2 items-center">{order.wholesale && <span className="pill pill-info">Wholesale order</span>}{order.source === "payment_link" && <span className="pill pill-info">Payment link</span>}<PaymentStatus value={order.paymentStatus} /><FulfilmentStatus value={order.fulfillmentStatus} /></div>} />
      <div className="px-4 sm:px-8 grid gap-6 lg:grid-cols-[1fr_320px] items-start">
        <div className="flex flex-col gap-6 min-w-0">
          {order.source === "payment_link" && (order.paymentStatus === "pending" || order.paymentStatus === "failed") && (
            <section className="card p-5 flex flex-col gap-3" aria-labelledby="pay-link">
              <h2 id="pay-link" className="font-semibold">Waiting for {order.shippingAddress.name.split(" ")[0]} to pay</h2>
              {link === "sent" && <p className="banner banner-success" role="status">Payment link emailed to {order.email}.</p>}
              {link === "unsent" && <p className="banner banner-warning" role="status">The order is ready, but the email didn&apos;t go out. Send it again or copy the link.</p>}
              {order.note && <p className="text-sm border-l-2 border-border pl-3 whitespace-pre-line">{order.note}</p>}
              <p className="text-sm hint">Once they pay, it goes to the supplier like any other order.</p>
              <PaymentLinkActions orderId={order.id} url={`${await storeAddress(shop)}/pay/${order.id}`} />
            </section>
          )}
          {returns[0] && (returns[0].status === "requested" || returns[0].status === "approved") && (
            <p className="banner banner-warning" role="status">
              {returns[0].status === "requested" ? "The buyer asked to return items from this order." : "You approved a return on this order and haven't refunded it yet."}{" "}
              <Link href="/admin/returns" className="underline">Answer it in Returns</Link>
            </p>
          )}
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
              {order.discountMinor > 0 && <><dt className="hint">Discount ({order.discountCode})</dt><dd>−{money(order.discountMinor)}</dd></>}
              {!order.discountMinor && order.discountCode && <><dt className="hint">Code</dt><dd>{order.discountCode} (free shipping)</dd></>}
              <dt className="hint">Shipping{order.shippingMethod ? ` (${order.shippingMethod})` : ""}</dt><dd>{order.shippingMinor ? money(order.shippingMinor) : "Free"}</dd>
              <dt className="hint">{order.taxBreakdown.length ? order.taxBreakdown.map((t) => t.label).join(", ") : "Tax"}{order.taxIncluded ? " (included)" : ""}</dt><dd>{money(order.taxMinor)}</dd>
              <dt className="font-semibold">Total</dt><dd className="font-semibold">{money(order.totalMinor)}</dd>
              {order.presentment && (
                <><dt className="hint">Buyer paid in {order.presentment.currency}</dt><dd>{formatMoney(order.presentment.totalMinor, order.presentment.currency)}</dd></>
              )}
              {order.giftCardMinor > 0 && (
                <><dt className="hint">Paid with gift card{giftCard ? ` ···· ${giftCard.last4}` : ""}</dt><dd>{money(order.giftCardMinor)}</dd></>
              )}
              {order.refundedMinor > 0 && <><dt className="hint">Refunded</dt><dd>−{money(order.refundedMinor)}</dd></>}
              {order.paidAt && seesMoney && (
                <>
                  <dt className="hint">Our fee{!order.platformFeeMinor ? " (none on your plan)" : feeKept < order.platformFeeMinor ? " (returned with the refund)" : ""}</dt><dd>−{money(feeKept)}</dd>
                  <dt className="hint">Card processing (est.)</dt><dd>−{money(order.processingFeeMinor)}</dd>
                  <dt className="font-semibold">You receive</dt><dd className="font-semibold">{money(net)}</dd>
                </>
              )}
              {knownCost && seesMoney && order.paymentStatus !== "refunded" && <><dt className="hint" title="What you receive, minus supplier cost. The shipping charge is assumed to cover the supplier's shipping.">Profit after supplier cost</dt><dd className="text-success font-semibold">{money(net - order.shippingMinor - cost)}</dd></>}
            </dl>
          </section>
          {problems.map((f) => (
            <section key={f.id} className="card border-critical p-5 flex flex-col gap-3" aria-labelledby={`problem-${f.id}`}>
              <h2 id={`problem-${f.id}`} className="font-semibold text-critical">
                {f.problemCode === "late_shipment" ? "Not shipped yet" : "The supplier couldn't take this order"}
              </h2>
              <p className="text-sm">{f.problemMessage}</p>
              <p className="text-sm"><span className="font-semibold">What to do: </span>{PROBLEM_FIXES[f.problemCode as ProblemCode] ?? PROBLEM_FIXES.unknown}</p>
              <div className="flex gap-2 flex-wrap items-start">
                {f.status === "failed" && <RetryButton orderId={order.id} />}
                <ManualTrackingForm orderId={order.id} primary={f.status !== "failed"} />
              </div>
              {f.status === "failed" && can(role, "assistant") && <FixWithAiButton orderId={order.id} />}
            </section>
          ))}
          <section className="card p-5 flex flex-col gap-4">
            <h2 className="font-semibold">Delivery</h2>
            {order.fulfillments.length === 0 ? (
              <p className="text-sm hint">
                {!paid
                  ? "Nothing is sent until the payment comes through."
                  : "These items aren't linked to a supplier, so you send them yourself. Add tracking when you do and we'll email the customer."}
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {order.fulfillments.map((f) => (
                  <li key={f.id} className="text-sm flex flex-col gap-1">
                    <span className="font-medium">{supplierLabel(f.supplierId)}</span>
                    {f.supplierOrderRef && <span className="hint num">Supplier order {f.supplierOrderRef}</span>}
                    {f.trackingNumber ? (
                      <span>
                        {f.carrier} ·{" "}
                        {f.trackingUrl ? <a className="underline num" href={f.trackingUrl} target="_blank" rel="noreferrer">{f.trackingNumber}</a> : <span className="num">{f.trackingNumber}</span>}
                      </span>
                    ) : f.status === "placed" ? (
                      <span className="hint">Waiting for the supplier to ship. We check for tracking automatically.</span>
                    ) : f.status === "failed" ? (
                      <span className="text-critical">Not placed. See the problem above.</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2 flex-wrap">
              {open && <CheckTrackingButton orderId={order.id} />}
              {paid && order.fulfillments.length === 0 && <ManualTrackingForm orderId={order.id} />}
            </div>
          </section>
          <section className="card p-5">
            <h2 className="font-semibold mb-3">Timeline</h2>
            <ol className="flex flex-col gap-3 border-l-2 border-border pl-4">
              {timeline.map((t, i) => (
                <li key={i} className="text-sm relative">
                  <span className="absolute -left-[23px] top-1.5 size-2.5 rounded-full bg-accent" aria-hidden />
                  {t.text} <span className="hint num">· {when.format(t.at)}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <aside className="flex flex-col gap-6">
        <div className="card p-5 flex flex-col gap-4 text-sm">
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
        </div>
        {(refundable || refunds.length > 0) && can(role, "refunds") && (
          <div className="card p-5 flex flex-col gap-3 text-sm">
            <h2 className="font-semibold">Refund</h2>
            {order.presentment && <p className="hint">The buyer paid in {order.presentment.currency}, so refunds go back in {order.presentment.currency} at the rate they paid (1 {order.currency} = {order.presentment.rate.toFixed(4)} {order.presentment.currency}). Enter the amount in {order.currency}.</p>}
            <RefundForm orderId={order.id} leftMinor={order.totalMinor - order.refundedMinor} currency={order.currency}
              feeNote={feeBack ? `Our ${PLANS.free.feeBps / 100}% fee comes back to you in proportion. The card processing fee isn't returned by the card network.` : null} />
          </div>
        )}
        </aside>
      </div>
    </main>
  );
}
