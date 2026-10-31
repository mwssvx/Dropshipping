import Link from "next/link";
import { notFound } from "next/navigation";
import { can, countryName, daysPastDelivery, formatDeliveryWindow, orderDelivery, formatHandoverDay, storeHandoverOptions, crossesBorder, disputeEvidence, disputeReason, disputesForOrder, formatMoney, getOrder, ORDER_EMAIL_LABELS, orderEditOptions, listRefunds, replaceableLines, replacementBlocked, replacementsOf, listSupplierLinks, NotFoundError, orderDocuments, supplierLabel as labelFor, PLANS, PROBLEM_FIXES, type ProblemCode, formatShipsBy, preorderWaitingOn, isOrderBuyerBlocked, orderDownloads, DOWNLOADS_PER_ITEM, transferDueBy, orderParcels } from "@sf/core";
import { BlockBuyerForm } from "./BlockBuyerForm";
import { fulfillment, requireShop, storeAddress, suppliers, testPayments } from "@/lib/server";
import { OrderEditForm } from "@/components/OrderEditForm";
import { editOrderAction } from "../../../actions";
import { resetDownloadsAction } from "../../../digital-actions";
import { markTransferPaidAction } from "../../../bank-transfer-actions";
import { PaymentLinkActions } from "./PaymentLinkActions";
import { CheckTrackingButton, DeliveredButton, ManualTrackingForm, PickupButtons, RetryButton } from "./FulfillmentActions";
import { RefundForm } from "./RefundForm";
import { MoveDayForm } from "./MoveDayForm";
import { FixWithAiButton } from "./FixWithAiButton";
import { RiskActions } from "./RiskActions";
import { OrderNotesForm } from "./OrderNotesForm";
import { ReplacementForm } from "./ReplacementForm";
import { DisputeResponse, SimulateDecision, SimulateDispute } from "./DisputeActions";
import { FulfilmentStatus, PaymentStatus } from "@/components/Status";
import { PageHeader } from "../../PageHeader";

const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ link?: string; replacement?: string; downloads?: string; transfer?: string }> }) {
  const { id } = await params;
  const { link, replacement: justSent, downloads: downloadsReset, transfer } = await searchParams;
  const { shop, db, role } = await requireShop("orders");
  const seesMoney = can(role, "money");
  const order = await getOrder(db, shop.id, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const downloads = await orderDownloads(db, order.id);
  const money = (m: number) => formatMoney(m, order.currency);
  const cost = order.lines.reduce((s, l) => s + (l.unitCostMinor ?? 0) * l.quantity, 0);
  const knownCost = order.lines.every((l) => l.unitCostMinor != null);
  const a = order.shippingAddress;
  const edit = ["paid"].includes(order.paymentStatus) && can(role, "orders") ? await orderEditOptions(await fulfillment(), shop.id, order.id, "merchant") : null;
  // Linked orders: the one this was added to after checkout, or the one added to this.
  // Replacements: the order this one replaces, those sent for it, and what could be sent again.
  const [original, replacements, replaceable] = await Promise.all([
    order.replacesOrderId ? db.query.orders.findFirst({ where: (o, { eq }) => eq(o.id, order.replacesOrderId!), columns: { id: true, number: true } }) : undefined,
    replacementsOf(db, order.id),
    !replacementBlocked(order) && can(role, "orders") ? replaceableLines(db, order.id) : Promise.resolve([]),
  ]);
  const [parent, child] = await Promise.all([
    order.parentOrderId ? db.query.orders.findFirst({ where: (o, { eq }) => eq(o.id, order.parentOrderId!), columns: { id: true, number: true } }) : undefined,
    db.query.orders.findFirst({ where: (o, { eq }) => eq(o.parentOrderId, order.id), columns: { id: true, number: true, paymentStatus: true } }),
  ]);
  const [links, refunds, giftCard, returns, documents] = await Promise.all([
    listSupplierLinks(db, shop.id),
    listRefunds(db, order.id),
    order.giftCardId ? db.query.giftCards.findFirst({ where: (g, { eq }) => eq(g.id, order.giftCardId!), columns: { last4: true } }) : undefined,
    db.query.returnRequests.findMany({ where: (r, { eq }) => eq(r.orderId, order.id), orderBy: (r, { desc }) => desc(r.createdAt) }),
    orderDocuments(db, order.id),
  ]);
  // In an order from more than one supplier (or with the store's own stock), what's in each parcel.
  const parcels = order.pickup || order.localDelivery ? [] : await orderParcels(db, order);
  const itemsOf = (fulfillmentId: string) => parcels.find((p) => p.shipment?.id === fulfillmentId)?.items;
  const listed = (items: { title: string; quantity: number }[]) => items.map((i) => (i.quantity > 1 ? `${i.title} × ${i.quantity}` : i.title)).join(", ");
  // The store's own items still to post, while suppliers send the rest.
  const ownWaiting = order.paymentStatus === "paid" ? parcels.find((p) => p.key === "own" && !p.shipment?.trackingNumber) : undefined;
  const supplierLabel = (supplierId: string | null) => {
    if (!supplierId) return "Sent by you";
    return labelFor(suppliers(), links.find((l) => l.id === supplierId));
  };
  const timeline = [
    { at: order.createdAt, text: "Order placed" },
    ...(order.paidAt
      ? [{ at: order.paidAt, text: order.giftCardMinor ? `Paid: ${money(order.giftCardMinor)} by gift card${order.totalMinor > order.giftCardMinor ? `, ${money(order.totalMinor - order.giftCardMinor)} by card` : ""}` : `Payment of ${money(order.totalMinor)} received` }]
      : []),
    ...order.fulfillments.flatMap((f) => [
      ...(f.placedAt ? [{ at: f.placedAt, text: `Sent to ${supplierLabel(f.supplierId)} (ref ${f.supplierOrderRef ?? "n/a"})${f.backupNote ? `. ${f.backupNote}` : ""}` }] : []),
      ...(f.shippedAt && f.trackingNumber ? [{ at: f.shippedAt, text: `Shipped with ${f.carrier}, tracking ${f.trackingNumber}` }] : []),
      ...(f.deliveredAt ? [{ at: f.deliveredAt, text: order.pickup ? "Picked up" : "Delivered" }] : []),
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
      text: `${ORDER_EMAIL_LABELS[e.kind]} email ${e.status === "sent" ? "sent" : e.status === "failed" ? "failed to send" : "queued"} to ${e.to}`,
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
  // The store can move a pickup or local delivery to any day in the buyer's window, today included.
  const moveOptions = (order.pickup || order.localDelivery) ? storeHandoverOptions(shop, order) : null;
  const moveDay = moveOptions && order.handoverOn ? <MoveDayForm orderId={order.id} day={order.handoverOn} dates={moveOptions.map((d) => [d, formatHandoverDay(d)])} /> : null;
  const blocked = await isOrderBuyerBlocked(db, shop.id, order);
  const waitingFor = order.preorderShipsBy && order.fulfillmentStatus === "unfulfilled" && order.paymentStatus === "paid" ? await preorderWaitingOn(db, order.id) : [];
  const RISK_LABEL = { low: "Low risk", medium: "Medium risk", high: "High risk" } as const;
  // Chargebacks: the latest one, and the evidence we'd send while it waits for an answer.
  const dispute = seesMoney ? ((await disputesForOrder(db, order.id))[0] ?? null) : null;
  const evidence = dispute?.status === "needs_response" && dispute.orderId ? await disputeEvidence(db, shop, dispute.id) : null;
  const DISPUTE_STATUS = { needs_response: "Needs your answer", under_review: "Bank reviewing", won: "Won", lost: "Lost", closed: "Closed" } as const;
  const longDay = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  // When it should arrive, worked out the same way as the buyer's order page, even if the store hides dates from buyers.
  const arrives = refundable ? await orderDelivery(db, shop, order, { evenIfHidden: true }) : null;
  const pastDue = daysPastDelivery(arrives, order);

  return (
    <main className="pb-12">
      <PageHeader title={`Order #${order.number}`} back={<Link href="/admin/orders" className="hint hover:text-ink">← Orders</Link>}
        actions={<div className="flex gap-2 items-center">{order.wholesale && <span className="pill pill-info">Wholesale order</span>}{order.source === "payment_link" && <span className="pill pill-info">Payment link</span>}{order.source === "post_purchase" && <span className="pill pill-info">Added after checkout</span>}{order.source === "replacement" && <span className="pill pill-info">Replacement</span>}{order.source === "subscription" && <Link href="/admin/subscriptions" className="pill pill-info">Subscription</Link>}<PaymentStatus value={order.paymentStatus} />{held ? <span className="pill pill-warning">On hold</span> : <FulfilmentStatus value={order.fulfillmentStatus} />}</div>} />
      <div className="px-4 sm:px-8 grid gap-6 lg:grid-cols-[1fr_320px] items-start">
        <div className="flex flex-col gap-6 min-w-0">
          {justSent && order.source === "replacement" && (
            <p className="banner banner-success" role="status">Replacement sent as order #{order.number}. {order.email} has been emailed, and it&apos;s gone to the supplier.</p>
          )}
          {transfer === "paid" && order.manualPayment === "bank_transfer" && (
            <p className="banner banner-success" role="status">Marked as paid. {order.email} gets their confirmation, and the order goes ahead like any other.</p>
          )}
          {order.manualPayment === "bank_transfer" && (order.paymentStatus === "pending" || order.paymentStatus === "failed") && (
            <section className="card p-5 flex flex-col gap-3" aria-labelledby="transfer-heading">
              <h2 id="transfer-heading" className="font-semibold">Waiting for a bank transfer</h2>
              <p className="text-sm">
                {order.shippingAddress.name.split(" ")[0]} chose to pay <strong className="num">{money(order.totalMinor - order.giftCardMinor)}</strong> by bank transfer, with the reference <strong className="num">Order {order.number}</strong>.{" "}
                {order.paymentStatus === "failed"
                  ? "It didn't arrive in time, so they were told the order is no longer held. If it arrives now, you can still mark it as paid."
                  : `It should arrive by ${longDay.format(transferDueBy(shop, order) ?? new Date())}.`}
              </p>
              <p className="text-sm hint">Check your bank. Nothing goes to the supplier until you mark it as paid.</p>
              {can(role, "money") && (
                <form action={markTransferPaidAction.bind(null, order.id)}>
                  <button type="submit" className="btn btn-primary">Mark as paid</button>
                </form>
              )}
            </section>
          )}
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
          {waitingFor.length > 0 && (
            <section className="card border-warning p-5 flex flex-col gap-2" aria-labelledby="preorder-heading">
              <h2 id="preorder-heading" className="font-semibold">Pre-order: waiting for stock</h2>
              <p className="text-sm">
                Promised to ship by {formatShipsBy(order.preorderShipsBy!)}. It goes to the supplier as soon as the daily stock check sees{" "}
                {waitingFor.join(", ")} back in stock.
                {order.preorderShipsBy! < new Date() && " The date has passed: let the buyer know, refund them, or source it elsewhere and add tracking."}
              </p>
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
          {dispute && (
            <section id="dispute" className={`card p-5 flex flex-col gap-3 ${dispute.status === "needs_response" ? "border-critical" : ""}`} aria-labelledby="dispute-heading">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="dispute-heading" className="font-semibold">{dispute.inquiry ? "Question from the buyer's bank" : "Disputed"}: {formatMoney(dispute.amountMinor, dispute.currency)}</h2>
                <span className={`pill ${dispute.status === "needs_response" || dispute.status === "lost" ? "pill-critical" : dispute.status === "won" ? "pill-success" : "pill-neutral"}`}>{DISPUTE_STATUS[dispute.status]}</span>
              </div>
              <p className="text-sm"><span className="font-medium">{disputeReason(dispute.reason).label}.</span> {disputeReason(dispute.reason).tip}</p>
              {dispute.status === "needs_response" && (
                <p className="text-sm">
                  {dispute.evidenceDueBy && <>Answer by <strong>{longDay.format(dispute.evidenceDueBy)}</strong>. </>}
                  {dispute.inquiry ? "Nothing has been taken back yet." : "The money is held until the bank decides."}
                </p>
              )}
              {evidence && (
                <>
                  <h3 className="font-medium text-sm">What we&apos;ll send</h3>
                  <ul className="text-sm flex flex-col gap-1" aria-label="Evidence">
                    {evidence.checks.map((c) => (
                      <li key={c.label}>
                        <span aria-hidden className={c.ok ? "text-success" : "hint"}>{c.ok ? "✓" : "○"}</span> <span className="font-medium">{c.label}</span>
                        <span className="sr-only">{c.ok ? " (included)" : " (missing)"}</span> <span className="hint">· {c.detail}</span>
                      </li>
                    ))}
                  </ul>
                  <details className="text-sm">
                    <summary className="cursor-pointer">See everything we&apos;ll send</summary>
                    <pre className="whitespace-pre-wrap text-xs bg-sunken rounded p-3 mt-2">{evidence.evidence.uncategorizedText}</pre>
                  </details>
                  <DisputeResponse disputeId={dispute.id} />
                </>
              )}
              {dispute.status === "under_review" && (
                <p className="text-sm" role="status">
                  {dispute.submittedAt ? `Evidence sent on ${longDay.format(dispute.submittedAt)}. ` : ""}The bank is reviewing it, which can take a couple of months. We&apos;ll show the result here.
                </p>
              )}
              {dispute.note && dispute.status !== "needs_response" && <p className="text-sm border-l-2 border-border pl-3">Your note: {dispute.note}</p>}
              {dispute.status === "won" && <p className="banner banner-success" role="status">You won. The money is back in your balance.</p>}
              {dispute.status === "lost" && <p className="banner banner-critical" role="status">The buyer kept the money. It counts against this order&apos;s profit, with the dispute fee.</p>}
              {testPayments() && dispute.status === "under_review" && <SimulateDecision disputeId={dispute.id} />}
            </section>
          )}
          {testPayments() && seesMoney && ["paid", "partially_refunded"].includes(order.paymentStatus) && (!dispute || ["won", "lost", "closed"].includes(dispute.status)) && (
            <details className="card p-4 text-sm">
              <summary className="cursor-pointer">Test mode: simulate a dispute</summary>
              <div className="pt-3"><SimulateDispute orderId={order.id} /></div>
            </details>
          )}
          {returns[0] && (returns[0].status === "requested" || returns[0].status === "approved") && (
            <p className="banner banner-warning" role="status">
              {returns[0].status === "requested" ? (returns[0].giftReturn ? `${returns[0].giftReturn.name}, who got it as a gift, asked to return items from this order.` : "The buyer asked to return items from this order.") : "You approved a return on this order and haven't refunded it yet."}{" "}
              <Link href="/admin/returns" className="underline">Answer it in Returns</Link>
            </p>
          )}
          <section className="card">
            <h2 className="font-semibold px-5 pt-4 pb-2">Items</h2>
            <ul className="divide-y divide-border">
              {order.lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-4 px-5 py-3 text-sm">
                  <span>
                    {l.title} <span className="hint">× {l.quantity}</span>
                    {l.preorder && <span className="pill ml-2">Pre-order</span>}
                    {l.personalization && (
                      <span className="block mt-1" aria-label="Personalisation">
                        {l.personalization.map((p) => (
                          <span key={p.fieldId} className="block"><span className="hint">{p.label}:</span> <q className="font-medium">{p.value}</q></span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="num">{money(l.unitPriceMinor * l.quantity)}</span>
                </li>
              ))}
            </ul>
            <dl className="border-t border-border px-5 py-4 text-sm grid grid-cols-[1fr_auto] gap-y-1 num">
              <dt className="hint">Subtotal</dt><dd>{money(order.subtotalMinor)}</dd>
              {order.discountMinor > 0 && <><dt className="hint">{order.discountCode ? `Discount (${order.discountCode})` : `Bundle (${order.bundleTitle})`}</dt><dd>−{money(order.discountMinor)}</dd></>}
              {!order.discountMinor && order.discountCode && <><dt className="hint">Code</dt><dd>{order.discountCode} (free shipping)</dd></>}
              <dt className="hint">Shipping{order.shippingMethod ? ` (${order.shippingMethod})` : ""}</dt><dd>{order.shippingMinor ? money(order.shippingMinor) : "Free"}</dd>
              {order.protectionMinor > 0 && <><dt className="hint">Delivery protection</dt><dd>{money(order.protectionMinor)}</dd></>}
              {order.giftWrapMinor > 0 && <><dt className="hint">Gift wrapping</dt><dd>{money(order.giftWrapMinor)}</dd></>}
              {order.tipMinor > 0 && <><dt className="hint">Tip from the buyer</dt><dd>{money(order.tipMinor)}</dd></>}
              {order.taxExemptId ? (
                <><dt className="hint">Tax (exempt, {order.taxExemptId})</dt><dd>{money(0)}</dd></>
              ) : (
                <><dt className="hint">{order.taxBreakdown.length ? order.taxBreakdown.map((t) => t.label).join(", ") : "Tax"}{order.taxIncluded ? " (included)" : ""}</dt><dd>{money(order.taxMinor)}</dd></>
              )}
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
          {downloads.length > 0 && (
            <section id="downloads" className="card p-5 flex flex-col gap-3" aria-labelledby="downloads-heading">
              <h2 id="downloads-heading" className="font-semibold">Downloads</h2>
              {downloadsReset && <p className="banner banner-success" role="status">Done. Every link on this order works {DOWNLOADS_PER_ITEM} times again for each one bought.</p>}
              <ul className="text-sm flex flex-col gap-1">
                {downloads.map((d) => (
                  <li key={d.lineId} className="flex justify-between gap-2">
                    <span>{d.title} <span className="hint">· {d.fileName}</span></span>
                    <span className="num">Downloaded {d.used} of {d.allowed} times</span>
                  </li>
                ))}
              </ul>
              <p className="hint text-sm">The buyer downloads from their order page and their confirmation email. If they used up their downloads, you can give them back.</p>
              {downloads.some((d) => d.used > 0) && (
                <form action={resetDownloadsAction.bind(null, order.id)}>
                  <button type="submit" className="btn btn-secondary">Give downloads back</button>
                </form>
              )}
            </section>
          )}
          {order.pickup ? (
            <section className="card p-5 flex flex-col gap-3" aria-labelledby="pickup-heading">
              <h2 id="pickup-heading" className="font-semibold">Picking up</h2>
              {order.handoverOn && <p className="text-sm font-medium">Collecting on {formatHandoverDay(order.handoverOn)}</p>}
              {moveDay}
              <p className="text-sm">
                {order.fulfillmentStatus === "delivered"
                  ? `Picked up on ${longDay.format(order.fulfillments.find((f) => f.deliveredAt)?.deliveredAt ?? order.updatedAt)}.`
                  : !refundable
                    ? "Nothing to get ready until the payment comes through."
                    : order.pickupReadyAt
                      ? `Ready since ${longDay.format(order.pickupReadyAt)}. ${order.email} was emailed where to collect it. Press Picked up when they have it.`
                      : "The buyer is collecting this from you, so there's nothing to ship. Press Ready for pickup when it's packed and we'll email them where to collect it."}
              </p>
              {refundable && !held && order.fulfillmentStatus !== "delivered" && <PickupButtons orderId={order.id} ready={!!order.pickupReadyAt} />}
            </section>
          ) : order.localDelivery ? (
            <section className="card p-5 flex flex-col gap-3" aria-labelledby="local-delivery-heading">
              <h2 id="local-delivery-heading" className="font-semibold">You&apos;re delivering this</h2>
              {order.handoverOn && <p className="text-sm font-medium">Deliver on {formatHandoverDay(order.handoverOn)}</p>}
              {moveDay}
              <p className="text-sm">
                {order.fulfillmentStatus === "delivered"
                  ? `Delivered on ${longDay.format(order.fulfillments.find((f) => f.deliveredAt)?.deliveredAt ?? order.updatedAt)}.`
                  : !refundable
                    ? "Nothing to deliver until the payment comes through."
                    : `The buyer chose local delivery, so you drop it off at the address here. Press Delivered when it's at their door and we'll email ${order.email}.`}
              </p>
              {refundable && !held && order.fulfillmentStatus !== "delivered" && <DeliveredButton orderId={order.id} />}
            </section>
          ) : (
          <section className="card p-5 flex flex-col gap-4">
            <h2 className="font-semibold">Delivery</h2>
            {arrives && (
              <p id="expected-delivery" className="text-sm">
                {order.fulfillmentStatus === "shipped" ? "Should arrive" : "Expected to arrive"} <strong className="num">{formatDeliveryWindow(arrives, (d) => longDay.format(d))}</strong>
                {pastDue > 0 && <span className="pill pill-warning ml-2">{pastDue === 1 ? "1 day" : `${pastDue} days`} past its delivery date</span>}
                {!shop.deliveryEstimates && <span className="hint block">Buyers don&apos;t see this date because delivery dates are off in Shipping settings.</span>}
              </p>
            )}
            {order.fulfillments.length === 0 ? (
              <p className="text-sm hint">
                {!paid
                  ? "Nothing is sent until the payment comes through."
                  : "These items aren't linked to a supplier, so you send them yourself. Add tracking when you do and we'll email the customer."}
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {order.fulfillments.filter((f) => !(ownWaiting?.shipment?.id === f.id)).map((f) => (
                  <li key={f.id} className="text-sm flex flex-col gap-1">
                    <span className="font-medium">{supplierLabel(f.supplierId)}</span>
                    {itemsOf(f.id) && <span>{listed(itemsOf(f.id)!)}</span>}
                    {f.supplierOrderRef && <span className="hint num">Supplier order {f.supplierOrderRef}</span>}
                    {f.backupNote && f.status !== "cancelled" && <span className="pill pill-info self-start">Sent to backup</span>}
                    {f.backupNote && f.status !== "cancelled" && <span className="hint">{f.backupNote}</span>}
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
                {ownWaiting && (
                  <li className="text-sm flex flex-col gap-1" aria-label="Your own parcel">
                    <span className="font-medium">Sent by you</span>
                    <span>{listed(ownWaiting.items)}</span>
                    <span className="hint">These are your own stock, so they go in a parcel you post. Add its tracking and we&apos;ll email the buyer about this parcel.</span>
                    <ManualTrackingForm orderId={order.id} own primary />
                  </li>
                )}
              </ul>
            )}
            <div className="flex gap-2 flex-wrap">
              {open && <CheckTrackingButton orderId={order.id} />}
              {paid && order.fulfillments.length === 0 && <ManualTrackingForm orderId={order.id} />}
            </div>
          </section>
          )}
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
            {blocked ? (
              <p className="mt-2 flex flex-wrap gap-2 items-center"><span className="pill pill-critical">Blocked from checking out</span><Link href="/admin/blocked" className="underline">See blocked buyers</Link></p>
            ) : (
              can(role, "customers") && <div className="mt-2 flex flex-col"><BlockBuyerForm orderId={order.id} /></div>
            )}
          </div>
          <div>
            <h2 className="font-semibold mb-1">{order.pickup ? "Buyer's address (picking up)" : order.localDelivery ? "Deliver to" : "Ship to"}</h2>
            <address className="not-italic hint">
              {order.gift && <>{a.name}<br /></>}
              {a.line1}{a.line2 ? <>, {a.line2}</> : null}<br />{a.city}{a.region ? `, ${a.region}` : ""} {a.postalCode}<br />{a.country}
              {a.phone && <><br /><a className="underline" href={`tel:${a.phone.replace(/[^\d+]/g, "")}`}>{a.phone}</a></>}
            </address>
            {order.paymentStatus !== "pending" && order.paymentStatus !== "failed" && (
              <p className="flex flex-wrap gap-x-4">
                <Link href={`/admin/orders/${order.id}/packing-slip`} className="underline">Packing slip</Link>
                {!order.pickup && !order.localDelivery && crossesBorder(order, shop) && <Link href={`/admin/orders/${order.id}/customs`} className="underline">Customs form</Link>}
              </p>
            )}
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
              <h2 id="gift-heading" className="font-semibold mb-1">Gift <span className="pill pill-info ml-1">Gift</span>{order.giftWrapMinor > 0 && <span className="pill pill-warning ml-1">Wrap it</span>}</h2>
              <p className="hint">From {order.gift.from} to {a.name}</p>
              {order.gift.message && <p className="whitespace-pre-line border-l-2 border-border pl-3 mt-1">{order.gift.message}</p>}
              <p className="hint mt-1">{order.gift.recipientEmail ? `We email ${order.gift.recipientEmail} when it ships, without prices.` : "No recipient email, so only the buyer hears from us."}</p>
            </section>
          )}
          {original && (
            <p>A free replacement for <Link href={`/admin/orders/${original.id}`} className="underline">order #{original.number}</Link>.{order.note ? ` You told the buyer: ${order.note}` : ""}</p>
          )}
          {replacements.length > 0 && (
            <p>Replacement{replacements.length > 1 ? "s" : ""} sent: {replacements.map((r, i) => <span key={r.id}>{i ? ", " : ""}<Link href={`/admin/orders/${r.id}`} className="underline">order #{r.number}</Link></span>)}.</p>
          )}
          {parent && (
            <p>Added after checkout to <Link href={`/admin/orders/${parent.id}`} className="underline">order #{parent.number}</Link>, on the same card.</p>
          )}
          {child && child.paymentStatus !== "pending" && (
            <p>The buyer added <Link href={`/admin/orders/${child.id}`} className="underline">order #{child.number}</Link> after checkout.</p>
          )}
          {order.visitSource && <p>The buyer came from {order.visitSource}.</p>}
          {order.buyerNote && (
            <section aria-labelledby="buyer-note-heading">
              <h2 id="buyer-note-heading" className="font-semibold mb-1">Note from the customer</h2>
              <p className="whitespace-pre-line border-l-2 border-border pl-3">{order.buyerNote}</p>
              <p className="hint mt-1">The supplier doesn&apos;t see this. If it changes how the order ships, tell them.</p>
            </section>
          )}
        </div>
        <section className="card p-5 flex flex-col gap-3 text-sm" aria-labelledby="notes-heading">
          <h2 id="notes-heading" className="font-semibold">Your note and tags</h2>
          <OrderNotesForm id={order.id} note={order.staffNote ?? ""} tags={order.tags.join(", ")} />
        </section>
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
        {order.surveyAnswer && (
          <p className="card p-5 text-sm">
            <span className="hint">Heard about you from:</span> <Link href="/admin/survey" className="font-medium">{order.surveyAnswer}</Link>{order.surveyOther ? ` (${order.surveyOther})` : ""}
          </p>
        )}
        {order.ageConfirmed && (
          <p className="card p-5 text-sm">
            <span className="pill pill-warning">Buyer confirmed {order.ageConfirmed}+</span> Something in this order has a minimum age. Ask the courier to check ID on delivery, or check it yourself at pickup.
          </p>
        )}
        {order.protectionMinor > 0 && (
          <p className="card p-5 text-sm">
            <span className="pill pill-success">Protected delivery</span> The buyer paid {money(order.protectionMinor)} to protect it. If it&apos;s lost or arrives damaged, send it again for free{replaceable.length > 0 ? " below" : " once it has shipped"}.
          </p>
        )}
        {replaceable.length > 0 && (
          <div className="card p-5 flex flex-col gap-3 text-sm">
            <ReplacementForm orderId={order.id} lines={replaceable.map((l) => ({ id: l.id, title: l.title, quantity: l.quantity }))} />
          </div>
        )}
        {(refundable || refunds.length > 0) && order.totalMinor > 0 && can(role, "refunds") && (
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
