import Link from "next/link";
import { notFound } from "next/navigation";
import { can, countryName, formatMoney, getOrder, orderEditOptions, listRefunds, listSupplierLinks, NotFoundError, orderDocuments, supplierLabel as labelFor, PLANS, PROBLEM_FIXES, type ProblemCode } from "@sf/core";
import { fulfillment, requireShop, storeAddress, suppliers } from "@/lib/server";
import { OrderEditForm } from "@/components/OrderEditForm";
import { editOrderAction } from "../../../actions";
import { PaymentLinkActions } from "./PaymentLinkActions";
import { CheckTrackingButton, ManualTrackingForm, RetryButton } from "./FulfillmentActions";
import { RefundForm } from "./RefundForm";
import { FixWithAiButton } from "./FixWithAiButton";
import { RiskActions } from "./RiskActions";
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
  const edit = ["paid"].includes(order.paymentStatus) && can(role, "orders") ? await orderEditOptions(await fulfillment(), shop.id, order.id, "merchant") : null;
  const [links, refunds, giftCard, returns, documents] = await Promise.all([
    listSupplierLinks(db, shop.id),
    listRefunds(db, order.id),
    order.giftCardId ? db.query.giftCards.findFirst({ where: (g, { eq }) => eq(g.id, order.giftCardId!), columns: { last4: true } }) : undefined,
    db.query.returnRequests.findMany({ where: (r, { eq }) => eq(r.orderId, order.id), orderBy: (r, { desc }) => desc(r.createdAt) }),
    orderDocuments(db, order.id),
  ]);
  const supplierLabel = (supplierId: string | null) => {
    if (!supplierId) return "Sent by you";
    return labelFor(suppliers(), links.find((l) => l.id === supplierId));
  };
  const EMAIL_LABEL = { order_confirmation: "Order confirmation", shipping_update: "Shipping update", delivered: "Delivery confirmation", refund: "Refund", support_reply: "Reply to a question", abandoned_cart: "Checkout reminder", payment_link: "Payment link", gift_shipped: "Gift heads-up", order_link: "Order link (Track your order)", order_updated: "Order change" };
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
    ...(order.risk && (order.heldAt || order.riskReviewedAt) ? [{ at: new Date(order.risk.checkedAt), text: `Held for a risk check (${order.risk.level} risk)` }] : []),
    ...(order.riskReviewedAt ? [{ at: order.riskReviewedAt, text: "Checked and sent on to the supplier" }] : []),
    ...order.edits.map((e) => ({ at: new Date(e.at), text: `Changed by ${e.by === "buyer" ? "the customer" : "you"}: ${e.changes.join("; ")}` })),
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
  const held = !!order.heldAt && refundable;
  const RISK_LABEL = { low: "Low risk", medium: "Medium risk", high: "High risk" } as const;

  return (
    <main className="pb-12">
      <PageHeader title={`Order #${order.number}`} back={<Link href="/admin/orders" className="hint hover:text-ink">← Orders</Link>}
        actions={<div className="flex gap-2 items-center">{order.wholesale && <span className="pill pill-info">Wholesale order</span>}{order.source === "payment_link" && <span className="pill pill-info">Payment link</span>}<PaymentStatus value={order.paymentStatus} />{held ? <span className="pill pill-warning">On hold</span> : <FulfilmentStatus value={order.fulfillmentStatus} />}</div>} />
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
          {held && order.risk && (
            <section className="card border-warning p-5 flex flex-col gap-3" aria-labelledby="held-heading">
              <h2 id="held-heading" className="font-semibold">On hold: {RISK_LABEL[order.risk.level].toLowerCase()}</h2>
              <p className="text-sm">This order looked risky, so it hasn&apos;t gone to the supplier. If the card was stolen, refunding now means you don&apos;t pay for goods you&apos;d lose to a chargeback.</p>
              <ul className="text-sm list-disc pl-5 flex flex-col gap-1">
                {order.risk.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
              <p className="text-sm hint">The buyer got their usual confirmation and isn&apos;t told about the hold.</p>
              <RiskActions orderId={order.id} canRefund={can(role, "refunds")} />
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
              {order.discountMinor > 0 && <><dt className="hint">{order.discountCode ? `Discount (${order.discountCode})` : `Bundle (${order.bundleTitle})`}</dt><dd>−{money(order.discountMinor)}</dd></>}
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
          {edit?.canEdit && (
            <section className="card p-5 flex flex-col gap-2" aria-labelledby="edit-heading">
              <h2 id="edit-heading" className="font-semibold">Change the order</h2>
              <OrderEditForm action={editOrderAction.bind(null, order.id)} address={edit.address} lines={edit.lines} countryName={countryName(edit.address.country)}
                summary="Change the address or a size"
                note="Until it ships. We cancel the supplier order and place it again with the change, then email the customer. Sizes listed are the ones at the same price and in stock." />
            </section>
          )}
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
            <p>{order.gift?.from ?? a.name}</p>
            <p className="hint break-all">{order.email}</p>
            {order.customerId && <Link href={`/admin/customers/${order.customerId}`} className="underline">View customer</Link>}
          </div>
          <div>
            <h2 className="font-semibold mb-1">Ship to</h2>
            <address className="not-italic hint">
              {order.gift && <>{a.name}<br /></>}
              {a.line1}{a.line2 ? <>, {a.line2}</> : null}<br />{a.city}{a.region ? `, ${a.region}` : ""} {a.postalCode}<br />{a.country}
            </address>
          </div>
          {order.risk && !held && (
            <section aria-labelledby="risk-heading">
              <h2 id="risk-heading" className="font-semibold mb-1">Risk check <span className={`pill ml-1 ${order.risk.level === "low" ? "pill-success" : order.risk.level === "medium" ? "pill-warning" : "pill-critical"}`}>{RISK_LABEL[order.risk.level]}</span></h2>
              {order.risk.reasons.length ? (
                <ul className="hint list-disc pl-5">{order.risk.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              ) : (
                <p className="hint">Nothing unusual.</p>
              )}
            </section>
          )}
          {order.gift && (
            <section aria-labelledby="gift-heading">
              <h2 id="gift-heading" className="font-semibold mb-1">Gift <span className="pill pill-info ml-1">Gift</span></h2>
              <p className="hint">From {order.gift.from} to {a.name}</p>
              {order.gift.message && <p className="whitespace-pre-line border-l-2 border-border pl-3 mt-1">{order.gift.message}</p>}
              <p className="hint mt-1">{order.gift.recipientEmail ? `We email ${order.gift.recipientEmail} when it ships, without prices.` : "No recipient email, so only the buyer hears from us."}</p>
            </section>
          )}
        </div>
        {documents.length > 0 && (
          <section className="card p-5 flex flex-col gap-2 text-sm" aria-labelledby="invoices-heading">
            <h2 id="invoices-heading" className="font-semibold">Invoices</h2>
            <ul className="flex flex-col gap-1">
              {documents.map((d) => (
                <li key={d.id}>
                  <Link className="underline" href={`/admin/orders/${order.id}/invoice?doc=${d.id}`}>{d.kind === "invoice" ? "Invoice" : "Credit note"} {d.number}</Link>
                </li>
              ))}
            </ul>
            <p className="hint">The buyer can open these from their order page too.</p>
          </section>
        )}
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
