import { PixelEvent } from "@/components/PixelEvent";
import { notFound } from "next/navigation";
import { buyerAmounts, buyerCancelOptions, buyerThread, formatDeliveryDate, formatDeliveryWindow, orderDelivery, intervalLabel, subscriptionForOrder, subscriptionOfferFor, postPurchaseOfferFor, postPurchaseOrder, countryName, orderEditOptions, describeReferralProgram, formatMoney, getOrderByPaymentIntent, listRefunds, NotFoundError, referralCodeForEmail, RETURN_REASON_LABELS, replacementsOf, returnOptions, reviewableItems, formatShipsBy, storePixels, surveyFor, orderDownloads, formatFileSize, transferDueBy } from "@sf/core";
import Link from "next/link";
import { db, fulfillment, storeAddress } from "@/lib/server";
import { OrderEditForm } from "@/components/OrderEditForm";
import { cancelOrderByBuyerAction, editOrderByBuyerAction } from "../../actions";
import { CancelOrder } from "./CancelOrder";
import { ReferralCard } from "@/components/ReferralCard";
import { loadShop, storeBase, storeLang, storeT } from "../../data";
import { ReviewForm } from "./ReviewForm";
import { QuestionForm } from "./QuestionForm";
import { ReturnForm } from "./ReturnForm";
import { PostPurchaseOffer } from "./PostPurchaseOffer";
import { SubscribeOffer } from "./SubscribeOffer";
import { SurveyQuestion } from "./SurveyQuestion";

const time = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const utc = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });

export const metadata = { title: "Order status", robots: { index: false } };

export default async function OrderStatusPage({ params, searchParams }: { params: Promise<{ shop: string; ref: string }>; searchParams: Promise<{ subscribed?: string; answered?: string; download?: string; rate?: string }> }) {
  const { shop: handle, ref } = await params;
  const { subscribed: justSubscribed, answered, download, rate } = await searchParams;
  // The stars a buyer tapped in the review request email, picked for them on the form.
  const tappedRating = /^[1-5]$/.test(rate ?? "") ? Number(rate) : undefined;
  const shop = await loadShop(handle);
  const order = await getOrderByPaymentIntent(await db(), shop.id, ref).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const paid = ["paid", "partially_refunded", "refunded"].includes(order.paymentStatus);
  const thread = paid ? await buyerThread(await db(), shop.id, ref) : [];
  const reviewable = paid ? await reviewableItems(await db(), shop.id, ref) : [];
  const base = await storeBase(handle);
  const returns = paid ? await returnOptions(await db(), shop, order) : null;
  const day = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" });
  // Amounts as the buyer paid them, in their own currency when they shopped in one.
  const refunds = order.presentment && order.refundedMinor ? await listRefunds(await db(), order.id) : [];
  const due = buyerAmounts(order, order.lines, order.presentment ? refunds.reduce((s, r) => s + (r.presentmentAmountMinor ?? 0), 0) : undefined);
  const money = (m: number) => formatMoney(m, due.currency);
  // Refer a friend: a paid buyer gets their share link here.
  const referCode = paid && order.paymentStatus !== "refunded" ? await referralCodeForEmail(await db(), shop, order.email) : null;
  const t = referCode ? await storeT(handle) : null;
  const referLink = referCode ? `${await storeAddress(shop)}/refer/${referCode}` : null;
  const shipped = order.fulfillments.filter((f) => f.trackingNumber);
  const edit = order.paymentStatus === "paid" ? await orderEditOptions(await fulfillment(), shop.id, order.id, "buyer") : null;
  const cancel = order.paymentStatus === "paid" ? await buyerCancelOptions(await fulfillment(), shop.id, order.id) : null;
  const lastEdit = order.edits.at(-1);
  // The after-checkout offer, what the buyer added with it, or the order this one was added to.
  const offer = await postPurchaseOfferFor(await db(), shop, order);
  const added = paid ? await postPurchaseOrder(await db(), order.id) : null;
  const addedTo = order.parentOrderId ? await (await db()).query.orders.findFirst({ where: (o, { eq }) => eq(o.id, order.parentOrderId!), columns: { number: true, paymentIntentId: true } }) : null;
  // A free replacement: the order it replaces, or the replacements sent for this one.
  const replacing = order.source === "replacement";
  const replaces = order.replacesOrderId ? await (await db()).query.orders.findFirst({ where: (o, { eq }) => eq(o.id, order.replacesOrderId!), columns: { number: true, paymentIntentId: true } }) : null;
  const replacements = paid ? await replacementsOf(await db(), order.id) : [];
  // Subscribe and save: the offer, the subscription started from this order, or the one that placed it.
  const subOffer = paid ? await subscriptionOfferFor(await db(), shop, order) : null;
  const subscription = paid ? await subscriptionForOrder(await db(), order.id) : null;
  const partOf = order.subscriptionId ? await (await db()).query.subscriptions.findFirst({ where: (s, { eq }) => eq(s.id, order.subscriptionId!), columns: { token: true, status: true } }) : null;
  const survey = surveyFor(shop, order);
  const arrives = paid ? await orderDelivery(await db(), shop, order) : null;
  // Paying by bank transfer: where to send it, or that it didn't arrive in time.
  const transfer = order.manualPayment === "bank_transfer" && (order.paymentStatus === "pending" || order.paymentStatus === "failed")
    ? { t: await storeT(handle), lang: (await storeLang(handle)) ?? "en", due: transferDueBy(shop, order) }
    : null;
  // Files bought as digital downloads, with how many times each link still works.
  const downloads = paid ? await orderDownloads(await db(), order.id) : [];
  const downloadProblem = download === "limit" ? "That download has been used the most times it can be. Ask the store below if you need it again."
    : download === "refunded" ? "This item was refunded, so its download is closed."
    : download === "unpaid" ? "Downloads open once the order is paid." : null;
  const pickupText = paid && (order.pickup || order.localDelivery) ? await storeT(handle) : null;
  const steps = order.pickup ? [
    { label: "Order confirmed", done: paid },
    { label: "Being prepared", done: paid },
    { label: "Ready to pick up", done: !!order.pickupReadyAt },
    { label: "Picked up", done: order.fulfillmentStatus === "delivered" },
  ] : [
    { label: "Order confirmed", done: paid },
    { label: "Being prepared", done: order.localDelivery ? paid : order.fulfillments.some((f) => f.placedAt || f.shippedAt) },
    { label: "On its way", done: ["shipped", "delivered"].includes(order.fulfillmentStatus) },
    { label: "Delivered", done: order.fulfillmentStatus === "delivered" },
  ];
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-8">
      {/* Reported once per order (the tags remember), and never for free replacements. */}
      {paid && !replacing && storePixels(shop) && (
        <PixelEvent name="purchase" data={{ ids: order.lines.map((l) => l.variantId).filter((id): id is string => !!id), value: order.totalMinor / 100, currency: order.currency, orderId: order.id }} />
      )}
      <div className="flex flex-col gap-2">
        <p className="hint num">Order #{order.number}</p>
        <h1 className="text-3xl font-bold tracking-tight">{replacing ? "Your replacement" : paid || order.manualPayment === "bank_transfer" ? `Thank you, ${(order.gift?.from ?? order.shippingAddress.name).split(" ")[0]}!` : "We're waiting for your payment"}</h1>
        <p className="text-muted">{replacing ? `${shop.name} is sending this at no charge. This page updates as it moves.` : paid ? `We've emailed a receipt to ${order.email}. This page updates as your order moves.` : order.manualPayment === "bank_transfer" ? `We've emailed ${order.email} how to pay. Your order starts as soon as the transfer arrives.` : "If you've paid, this page updates in a moment."}</p>
        {paid && (
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href={`${base}/account`} className="underline">See all your orders</Link>
            {!replacing && <a href={`${base}/orders/${ref}/invoice`} className="underline">Invoice{order.refundedMinor > 0 ? " and credit notes" : ""}</a>}
          </p>
        )}
        {order.paymentStatus === "pending" && (
          <Link href={`${base}/pay/${order.id}`} className="btn btn-primary self-start">Finish paying</Link>
        )}
      </div>
      {paid && !replacing && shop.thankYouNote && (
        <section className="card p-4 whitespace-pre-line" aria-label={`A note from ${shop.name}`}>{shop.thankYouNote}</section>
      )}
      {offer && (
        <PostPurchaseOffer handle={handle} orderRef={ref} title={offer.product.title} imageUrl={offer.product.imageUrl} percentOff={offer.percentOff}
          until={`${utc.format(offer.expiresAt)} UTC`}
          options={offer.variants.map((v) => ({ id: v.id, title: v.title, price: formatMoney(v.priceMinor, shop.currency), offer: formatMoney(v.offerMinor, shop.currency), charge: formatMoney(v.chargeMinor, shop.currency) }))} />
      )}
      {subOffer && (
        <SubscribeOffer handle={handle} orderRef={ref} percentOff={subOffer.percentOff} each={formatMoney(subOffer.eachMinor, shop.currency)}
          intervals={subOffer.intervals.map((i) => ({ days: i.days, label: i.label }))}
          items={subOffer.items.map((i) => ({ title: i.title, quantity: i.quantity, price: formatMoney(i.priceMinor, shop.currency), offer: formatMoney(i.offerMinor, shop.currency) }))} />
      )}
      {/* After the offers, which only last a while. */}
      {survey && <SurveyQuestion handle={handle} orderRef={ref} question={survey.question} options={survey.options} other={survey.other} />}
      {answered && order.surveyAnswer && <p className="banner banner-success" role="status">Thanks for telling us.</p>}
      {subscription && subscription.status !== "cancelled" && (
        <p className="banner banner-success" role="status">
          {justSubscribed ? "You're subscribed. " : ""}
          {subscription.status === "active"
            ? `${intervalLabel(subscription.intervalDays)} we'll send this again for ${subscription.percentOff}% less. Next delivery: ${formatDeliveryDate(subscription.nextOrderAt)}. `
            : "Your subscription from this order is paused. "}
          <Link href={`${base}/subscriptions/${subscription.token}`} className="underline">Manage subscription</Link>
        </p>
      )}
      {paid && order.preorderShipsBy && order.fulfillmentStatus === "unfulfilled" && (
        <p className="banner banner-info" role="status">
          This is a pre-order. It ships by {formatShipsBy(order.preorderShipsBy)}, and we'll email you tracking as soon as it's on its way.
        </p>
      )}
      {partOf && (
        <p className="banner banner-info">
          A delivery from your subscription, charged to your saved card. <Link href={`${base}/subscriptions/${partOf.token}`} className="underline">Manage subscription</Link>
        </p>
      )}
      {added && (
        <p className="banner banner-success" role="status">
          Added as order #{added.number} and charged {formatMoney(added.totalMinor, added.currency)} to the same card. <Link href={`${base}/orders/${added.paymentIntentId}`} className="underline">See it</Link>
        </p>
      )}
      {replaces && (
        <p className="banner banner-info">
          A free replacement for <Link href={`${base}/orders/${replaces.paymentIntentId}`} className="underline">order #{replaces.number}</Link>.{order.note ? ` ${shop.name}: ${order.note}` : ""}
        </p>
      )}
      {replacements.map((r) => (
        <p key={r.id} className="banner banner-success" role="status">
          A replacement is on its way as order #{r.number}, at no charge. <Link href={`${base}/orders/${r.paymentIntentId}`} className="underline">Track it</Link>
        </p>
      ))}
      {addedTo && (
        <p className="banner banner-info">
          You added this after checking out, to the same card as <Link href={`${base}/orders/${addedTo.paymentIntentId}`} className="underline">order #{addedTo.number}</Link>. It may arrive separately.
        </p>
      )}
      {order.gift && (
        <section className="card p-5 flex flex-col gap-1 text-sm" aria-labelledby="gift-heading">
          <h2 id="gift-heading" className="font-semibold">A gift for {order.shippingAddress.name}</h2>
          {order.gift.message && <p className="whitespace-pre-line border-l-2 border-border pl-3">{order.gift.message}</p>}
          <p className="hint">
            {order.gift.recipientEmail ? `We'll email ${order.gift.recipientEmail} when it ships, with your message and tracking but no prices.` : "We won't contact them. Share the tracking below if you like."}
          </p>
        </section>
      )}
      {order.buyerNote && (
        <section className="card p-5 flex flex-col gap-1 text-sm" aria-labelledby="note-heading">
          <h2 id="note-heading" className="font-semibold">Your note to the store</h2>
          <p className="whitespace-pre-line">{order.buyerNote}</p>
        </section>
      )}
      {order.refundedMinor > 0 && (
        <p className="banner banner-info">
          {order.paymentStatus === "refunded" ? "This order was refunded" : `${money(due.refundedMinor)} was refunded`}
          {order.giftCardMinor
            ? " to how you paid: card refunds take 5 to 10 business days, and gift card refunds can be used right away."
            : " to the card you paid with. Banks usually show it within 5 to 10 business days."}
        </p>
      )}
      {transfer && order.paymentStatus === "pending" && (
        <section id="transfer" className="card p-5 flex flex-col gap-2 text-sm" aria-labelledby="transfer-heading">
          <h2 id="transfer-heading" className="font-semibold">{transfer.t.payByTransfer}</h2>
          <p>{transfer.t.transferSend(money(due.chargedMinor), new Intl.DateTimeFormat(transfer.lang, { weekday: "long", month: "long", day: "numeric" }).format(transfer.due ?? new Date()))}</p>
          <p className="whitespace-pre-line border-l-2 border-border pl-3 num">{shop.bankTransfer?.details}</p>
          <p className="font-semibold num">{transfer.t.transferReference(order.number)}</p>
          <p className="hint">{transfer.t.transferNote}</p>
          <p><Link href={`${base}/pay/${order.id}`} className="underline">{transfer.t.payByCardInstead}</Link></p>
        </section>
      )}
      {transfer && order.paymentStatus === "failed" && (
        <p className="banner banner-warning" role="status">
          {transfer.t.transferLapsed} <Link href={`${base}/pay/${order.id}`} className="underline">{transfer.t.payByCardInstead}</Link>
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
      {arrives && <p className="text-sm">Expected delivery: <strong>{formatDeliveryWindow(arrives)}</strong></p>}
      {downloads.length > 0 && (
        <section id="downloads" className="card p-5 flex flex-col gap-2 text-sm" aria-labelledby="downloads-heading">
          <h2 id="downloads-heading" className="font-semibold">Your downloads</h2>
          {downloadProblem && <p className="banner banner-warning" role="alert">{downloadProblem}</p>}
          <ul className="flex flex-col gap-2">
            {downloads.map((d) => (
              <li key={d.lineId} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  {d.title}: {order.paymentStatus === "refunded" || d.left === 0
                    ? <span className="hint">{d.fileName}</span>
                    : <a className="underline" href={`${base}/orders/${ref}/download/${d.lineId}`} download>{d.fileName}</a>}
                  <span className="hint"> · {formatFileSize(d.bytes)}</span>
                </span>
                <span className="hint num">{order.paymentStatus === "refunded" ? "Refunded" : d.left === 1 ? "1 download left" : `${d.left} downloads left`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
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
      {paid && order.protectionMinor > 0 && order.paymentStatus !== "refunded" && (
        <p className="banner banner-info text-sm">
          Your delivery is protected. If it&apos;s lost or arrives damaged, <a className="underline" href="#questions">tell {shop.name} below</a> and they&apos;ll send it again for free.
        </p>
      )}
      {pickupText && order.localDelivery && order.paymentStatus !== "refunded" && (
        <p className="banner banner-info text-sm" role="status">
          {order.fulfillmentStatus === "delivered" ? pickupText.localDelivered(shop.name) : pickupText.localDeliveryWaiting(shop.name)}
          {order.fulfillmentStatus !== "delivered" && shop.localDeliveryArea?.note && <> {shop.localDeliveryArea.note.replace(/\.$/, "")}.</>}
        </p>
      )}
      {pickupText && order.pickup && order.paymentStatus !== "refunded" && (
        <section className="banner banner-info text-sm flex flex-col gap-1" role="status" aria-label={pickupText.pickUp}>
          {order.fulfillmentStatus === "delivered" ? (
            <p>{pickupText.pickedUp}</p>
          ) : order.pickupReadyAt && shop.localPickup ? (
            <>
              <p className="font-semibold">{pickupText.pickupReady}</p>
              <p className="whitespace-pre-line">{shop.localPickup.address}</p>
              {shop.localPickup.instructions && <p className="whitespace-pre-line">{shop.localPickup.instructions}</p>}
            </>
          ) : (
            <p>{pickupText.pickupWaiting}</p>
          )}
        </section>
      )}
      {paid && shipped.length === 0 && !order.preorderShipsBy && !order.pickup && !order.localDelivery && (
        <p className="hint text-sm">
          {order.lines.length === 1 ? "Your item usually ships" : "Your items usually ship"} within a few days. We&apos;ll email tracking to {order.email} as soon as it&apos;s on its way.
        </p>
      )}
      {lastEdit && (
        <p className="banner banner-info" role="status">
          {lastEdit.by === "buyer" && lastEdit.changes[0]?.startsWith("Cancelled")
            ? `You cancelled this order on ${day.format(new Date(lastEdit.at))}.${order.paymentStatus === "refunded" ? " The refund is on its way to your card, and we've emailed you." : ""}`
            : <>{lastEdit.by === "buyer" ? "You changed this order" : `${shop.name} changed this order`} on {day.format(new Date(lastEdit.at))}: {lastEdit.changes.join("; ")}.</>}
        </p>
      )}
      {edit?.canEdit && edit.until && (
        <section className="card p-5" aria-label="Change your order">
          <OrderEditForm action={editOrderByBuyerAction.bind(null, handle, ref)} address={edit.address} lines={edit.lines} countryName={countryName(edit.address.country)}
            summary="Wrong address, or need another size?"
            note={`You can change it here until ${utc.format(edit.until)} UTC, as long as it hasn't shipped.`} />
        </section>
      )}
      {cancel?.canCancel && cancel.until && <CancelOrder action={cancelOrderByBuyerAction.bind(null, handle, ref)} until={utc.format(cancel.until)} />}
      <section className="card p-5 flex flex-col gap-3 text-sm">
        {order.lines.map((l, n) => (
          <div key={l.id} className="flex justify-between gap-3">
            <span>
              {l.title} × {l.quantity}
              {l.personalization && <span className="block hint">{l.personalization.map((p) => `${p.label}: ${p.value}`).join(" · ")}</span>}
              {l.preorder && <span className="block hint">Pre-order</span>}
            </span>
            <span className="num">{money(due.lines[n]!)}</span>
          </div>
        ))}
        {order.discountMinor > 0 && (
          <div className="flex justify-between gap-3 hint"><span>{order.discountCode ? `Discount (${order.discountCode})` : `Bundle (${order.bundleTitle})`}</span><span className="num">−{money(due.discountMinor)}</span></div>
        )}
        <div className="flex justify-between gap-3 hint"><span>Shipping{order.shippingMethod ? ` (${order.shippingMethod})` : ""}</span><span className="num">{due.shippingMinor ? money(due.shippingMinor) : "Free"}</span></div>
        {due.protectionMinor > 0 && <div className="flex justify-between gap-3 hint"><span>Delivery protection</span><span className="num">{money(due.protectionMinor)}</span></div>}
        {due.giftWrapMinor > 0 && <div className="flex justify-between gap-3 hint"><span>Gift wrapping</span><span className="num">{money(due.giftWrapMinor)}</span></div>}
        {due.tipMinor > 0 && <div className="flex justify-between gap-3 hint"><span>Tip</span><span className="num">{money(due.tipMinor)}</span></div>}
        {order.taxExemptId && <div className="flex justify-between gap-3 hint"><span>Tax exempt</span><span className="num">{order.taxExemptId}</span></div>}
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
          {shop.reviewRewardPercent && reviewable.some((i) => !i.review) && (
            <p className="text-sm">Leave a review, good or bad, and we&apos;ll email you {shop.reviewRewardPercent}% off your next order as a thank you.</p>
          )}
          {reviewable.map((item) =>
            item.review ? (
              <p key={item.productId} className="text-sm">
                <span className="font-medium">{item.title}:</span> you gave it {item.review.rating} of 5 stars.{" "}
                {item.review.status === "pending" ? "It shows on the store once the shop has had a look." : "Thank you!"}
                {item.review.rewardedAt && ` We've emailed you ${shop.reviewRewardPercent ? `${shop.reviewRewardPercent}% off` : "a thank-you code for"} your next order.`}
              </p>
            ) : (
              <ReviewForm key={item.productId} handle={handle} orderRef={ref} productId={item.productId} title={item.title} name={(order.gift?.from ?? order.shippingAddress.name).split(" ")[0] ?? ""}
                rating={reviewable.filter((i) => !i.review).length === 1 ? tappedRating : undefined} />
            ),
          )}
        </section>
      )}
      {returns && (returns.latest || returns.canRequest || returns.blocked) && (
        <section id="returns" className="card p-5 flex flex-col gap-3" aria-labelledby="returns-heading">
          <h2 id="returns-heading" className="font-semibold">Returns</h2>
          {returns.latest && (
            <div className="flex flex-col gap-1 text-sm" role="status">
              <p>
                {returns.latest.items.map((i) => `${i.title} × ${i.quantity}`).join(", ")}:{" "}
                {{
                  requested: `you asked for a return. ${shop.name} will email you when they've looked at it.`,
                  approved: `${shop.name} approved your return.`,
                  refunded: `refunded ${returns.latest.resolvedMinor ? formatMoney(returns.latest.resolvedMinor, order.currency) : ""}.`,
                  credited: `${returns.latest.resolvedMinor ? formatMoney(returns.latest.resolvedMinor, order.currency) : ""} in store credit, sent by email.`,
                  replaced: `${shop.name} is sending a replacement. There's nothing to send back.`,
                  exchanged: `${shop.name} is sending ${returns.latest.items.map((i) => i.exchangeTitle ?? i.title).join(", ")} in exchange.`,
                  declined: `${shop.name} couldn't accept this return.`,
                }[returns.latest.status]}
              </p>
              {returns.latest.merchantMessage && (returns.latest.status === "approved" || returns.latest.status === "declined" || returns.latest.status === "exchanged") && (
                <p className="border-l-2 border-border pl-3 whitespace-pre-line">{returns.latest.merchantMessage}</p>
              )}
            </div>
          )}
          {returns.blocked && !returns.open && <p className="text-sm hint">{returns.blocked}</p>}
          {returns.canRequest && (
            <ReturnForm handle={handle} orderRef={ref} lines={returns.lines.map((l) => ({ id: l.id, title: l.title, quantity: l.quantity, swaps: returns.exchanges[l.id] ?? [] }))}
              reasons={Object.entries(RETURN_REASON_LABELS)} closes={returns.closesAt ? day.format(returns.closesAt) : null} />
          )}
        </section>
      )}
      {referLink && t && shop.referralProgram && (
        <ReferralCard
          title={t.referTitle(shop.referralProgram.friendPercentOff)}
          body={t.referBody(shop.referralProgram.friendPercentOff, describeReferralProgram(shop.referralProgram, shop.currency).reward)}
          link={referLink}
          labels={{ link: t.referLink, copy: t.referCopy, copied: t.referCopied }}
        />
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
