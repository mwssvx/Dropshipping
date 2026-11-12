import { PixelEvent } from "@/components/PixelEvent";
import { notFound } from "next/navigation";
import { canMarkArrived, buyerAmounts, formatHandoverDay, handoverDayOptions, buyerCancelOptions, buyerThread, formatDeliveryWindow, orderDelivery, subscriptionForOrder, subscriptionOfferFor, postPurchaseOfferFor, postPurchaseOrder, countryName, orderEditOptions, describeReferralProgram, formatMoney, getOrderByPaymentIntent, listRefunds, NotFoundError, referralCodeForEmail, RETURN_REASON_LABELS, replacementsOf, returnOptions, reviewableItems, formatShipsBy, storePixels, surveyFor, orderDownloads, formatFileSize, transferDueBy, orderParcels, parcelDeliveries } from "@sf/core";
import Link from "next/link";
import { db, fulfillment, storeAddress } from "@/lib/server";
import { OrderEditForm } from "@/components/OrderEditForm";
import { cancelOrderByBuyerAction, changeHandoverDayAction, editOrderByBuyerAction, markArrivedAction } from "../../actions";
import { MarkArrived } from "./MarkArrived";
import { CancelOrder } from "./CancelOrder";
import { ChangeDay } from "./ChangeDay";
import { ReferralCard } from "@/components/ReferralCard";
import { loadShop, storeBase, storeLang, storeT } from "../../data";
import { ReviewForm } from "./ReviewForm";
import { QuestionForm } from "./QuestionForm";
import { ReturnForm } from "./ReturnForm";
import { PostPurchaseOffer } from "./PostPurchaseOffer";
import { SubscribeOffer } from "./SubscribeOffer";
import { SurveyQuestion } from "./SurveyQuestion";
import { orderText } from "@/lib/order-text";


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
  // Words and dates in the store language the buyer is reading.
  const lang = await storeLang(handle);
  const o = orderText(lang);
  const locale = lang ?? "en-US";
  const day = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric" });
  const time = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const utc = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  const shortDay = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" });
  const longDate = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const dates = (w: Parameters<typeof formatDeliveryWindow>[0]) => formatDeliveryWindow(w, (d) => shortDay.format(d));
  // Amounts as the buyer paid them, in their own currency when they shopped in one.
  const refunds = order.presentment && order.refundedMinor ? await listRefunds(await db(), order.id) : [];
  const due = buyerAmounts(order, order.lines, order.presentment ? refunds.reduce((s, r) => s + (r.presentmentAmountMinor ?? 0), 0) : undefined);
  const money = (m: number) => formatMoney(m, due.currency);
  // Refer a friend: a paid buyer gets their share link here.
  const referCode = paid && order.paymentStatus !== "refunded" ? await referralCodeForEmail(await db(), shop, order.email) : null;
  const t = referCode ? await storeT(handle) : null;
  const referLink = referCode ? `${await storeAddress(shop)}/refer/${referCode}` : null;
  const shipped = order.fulfillments.filter((f) => f.trackingNumber);
  // An order from more than one supplier comes in separate parcels, each with its own tracking.
  const parcels = order.pickup || order.localDelivery ? [] : await orderParcels(await db(), order);
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
  // Each parcel's own dates, since a parcel from a nearby warehouse comes sooner than one from abroad.
  const parcelDates = paid && parcels.length > 1 ? await parcelDeliveries(await db(), shop, order, parcels) : new Map();
  // Shipped and not reported delivered: the buyer can say it arrived.
  const arrivedText = canMarkArrived(order) ? await storeT(handle) : null;
  // Paying by bank transfer: where to send it, or that it didn't arrive in time.
  const transfer = order.manualPayment === "bank_transfer" && (order.paymentStatus === "pending" || order.paymentStatus === "failed")
    ? { t: await storeT(handle), lang: (await storeLang(handle)) ?? "en", due: transferDueBy(shop, order) }
    : null;
  // Files bought as digital downloads, with how many times each link still works.
  const downloads = paid ? await orderDownloads(await db(), order.id) : [];
  const downloadProblem = download === "limit" ? o.downloadLimit
    : download === "refunded" ? o.downloadRefunded
    : download === "unpaid" ? o.downloadUnpaid : null;
  const pickupText = paid && (order.pickup || order.localDelivery) ? await storeT(handle) : null;
  const dayLang = locale;
  // Until the day before, the buyer can move their pickup or delivery to another open day.
  const dayOptions = pickupText ? handoverDayOptions(shop, order) : null;
  const changeDay = pickupText && dayOptions && order.handoverOn ? (
    <ChangeDay
      action={changeHandoverDayAction.bind(null, handle, ref)}
      day={order.handoverOn}
      dates={dayOptions.map((d) => [d, formatHandoverDay(d, dayLang)])}
      text={{ label: order.pickup ? pickupText.pickupDay : pickupText.deliveryDay, changeDay: pickupText.changeDay, saveDay: pickupText.saveDay, dayChanged: pickupText.dayChanged }}
    />
  ) : null;
  const steps = order.pickup ? [
    { label: o.stepConfirmed, done: paid },
    { label: o.stepPreparing, done: paid },
    { label: o.stepReady, done: !!order.pickupReadyAt },
    { label: o.stepPickedUp, done: order.fulfillmentStatus === "delivered" },
  ] : [
    { label: o.stepConfirmed, done: paid },
    { label: o.stepPreparing, done: order.localDelivery ? paid : order.fulfillments.some((f) => f.placedAt || f.shippedAt) },
    { label: o.stepOnWay, done: ["shipped", "delivered"].includes(order.fulfillmentStatus) },
    { label: o.stepDelivered, done: order.fulfillmentStatus === "delivered" },
  ];
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-8">
      {/* Reported once per order (the tags remember), and never for free replacements. */}
      {paid && !replacing && storePixels(shop) && (
        <PixelEvent name="purchase" data={{ ids: order.lines.map((l) => l.variantId).filter((id): id is string => !!id), value: order.totalMinor / 100, currency: order.currency, orderId: order.id }} />
      )}
      <div className="flex flex-col gap-2">
        <p className="hint num">{o.orderNumber(order.number)}</p>
        <h1 className="text-3xl font-bold tracking-tight">{replacing ? o.replacementTitle : paid || order.manualPayment === "bank_transfer" ? o.thanks((order.gift?.from ?? order.shippingAddress.name).split(" ")[0] ?? "") : o.waitingPayment}</h1>
        <p className="text-muted">{replacing ? o.replacementIntro(shop.name) : paid ? o.paidIntro(order.email) : order.manualPayment === "bank_transfer" ? o.transferIntro(order.email) : o.pendingIntro}</p>
        {paid && (
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href={`${base}/account`} className="underline">{o.allOrders}</Link>
            {!replacing && <a href={`${base}/orders/${ref}/invoice`} className="underline">{o.invoice(order.refundedMinor > 0)}</a>}
          </p>
        )}
        {order.paymentStatus === "pending" && (
          <Link href={`${base}/pay/${order.id}`} className="btn btn-primary self-start">{o.finishPaying}</Link>
        )}
      </div>
      {paid && !replacing && shop.thankYouNote && (
        <section className="card p-4 whitespace-pre-line" aria-label={o.noteFrom(shop.name)}>{shop.thankYouNote}</section>
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
      {answered && order.surveyAnswer && <p className="banner banner-success" role="status">{o.surveyThanks}</p>}
      {subscription && subscription.status !== "cancelled" && (
        <p className="banner banner-success" role="status">
          {justSubscribed ? o.subscribedNow : ""}
          {subscription.status === "active"
            ? o.subscriptionActive(o.every(subscription.intervalDays), subscription.percentOff, shortDay.format(subscription.nextOrderAt))
            : o.subscriptionPaused}
          <Link href={`${base}/subscriptions/${subscription.token}`} className="underline">{o.manageSubscription}</Link>
        </p>
      )}
      {paid && order.preorderShipsBy && order.fulfillmentStatus === "unfulfilled" && (
        <p className="banner banner-info" role="status">
          {o.preorder(lang ? longDate.format(new Date(`${order.preorderShipsBy}T12:00:00Z`)) : formatShipsBy(order.preorderShipsBy))}
        </p>
      )}
      {partOf && (
        <p className="banner banner-info">
          {o.subscriptionDelivery}<Link href={`${base}/subscriptions/${partOf.token}`} className="underline">{o.manageSubscription}</Link>
        </p>
      )}
      {added && (
        <p className="banner banner-success" role="status">
          {o.addedAs(added.number, formatMoney(added.totalMinor, added.currency))}<Link href={`${base}/orders/${added.paymentIntentId}`} className="underline">{o.seeIt}</Link>
        </p>
      )}
      {replaces && (
        <p className="banner banner-info">
          {o.replacementFor}<Link href={`${base}/orders/${replaces.paymentIntentId}`} className="underline">{o.orderLink(replaces.number)}</Link>.{order.note ? ` ${shop.name}: ${order.note}` : ""}
        </p>
      )}
      {replacements.map((r) => (
        <p key={r.id} className="banner banner-success" role="status">
          {o.replacementOnWay(r.number)}<Link href={`${base}/orders/${r.paymentIntentId}`} className="underline">{o.trackIt}</Link>
        </p>
      ))}
      {addedTo && (
        <p className="banner banner-info">
          {o.addedAfter}<Link href={`${base}/orders/${addedTo.paymentIntentId}`} className="underline">{o.orderLink(addedTo.number)}</Link>{o.addedAfterEnd}
        </p>
      )}
      {order.gift && (
        <section className="card p-5 flex flex-col gap-1 text-sm" aria-labelledby="gift-heading">
          <h2 id="gift-heading" className="font-semibold">{o.giftFor(order.shippingAddress.name)}</h2>
          {order.gift.message && <p className="whitespace-pre-line border-l-2 border-border pl-3">{order.gift.message}</p>}
          <p className="hint">
            {order.gift.recipientEmail ? o.giftEmail(order.gift.recipientEmail) : o.giftNoContact}
          </p>
        </section>
      )}
      {order.buyerNote && (
        <section className="card p-5 flex flex-col gap-1 text-sm" aria-labelledby="note-heading">
          <h2 id="note-heading" className="font-semibold">{o.yourNote}</h2>
          <p className="whitespace-pre-line">{order.buyerNote}</p>
        </section>
      )}
      {order.refundedMinor > 0 && (
        <p className="banner banner-info">
          {o.refund(order.paymentStatus === "refunded" ? null : money(due.refundedMinor), !!order.giftCardMinor)}
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
      <ol className="grid grid-cols-4 gap-2" aria-label={o.progress}>
        {steps.map((s) => (
          <li key={s.label} className="flex flex-col gap-2">
            <span className={`h-1.5 rounded-full ${s.done ? "bg-accent" : "bg-sunken"}`} />
            <span className={`text-xs ${s.done ? "font-semibold" : "hint"}`}>{s.label}</span>
          </li>
        ))}
      </ol>
      {arrives && <p className="text-sm">{o.expected}<strong>{dates(arrives)}</strong></p>}
      {arrivedText && <MarkArrived action={markArrivedAction.bind(null, handle, ref)} text={{ arrivedQuestion: arrivedText.arrivedQuestion, markArrived: arrivedText.markArrived, arrivedThanks: arrivedText.arrivedThanks }} />}
      {downloads.length > 0 && (
        <section id="downloads" className="card p-5 flex flex-col gap-2 text-sm" aria-labelledby="downloads-heading">
          <h2 id="downloads-heading" className="font-semibold">{o.downloads}</h2>
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
                <span className="hint num">{order.paymentStatus === "refunded" ? o.refunded : o.downloadsLeft(d.left)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {paid && parcels.length > 1 && (
        <section className="card p-5 flex flex-col gap-3 text-sm" aria-labelledby="parcels">
          <div>
            <h2 id="parcels" className="font-semibold">{o.parcels(parcels.length)}</h2>
            <p className="hint">{o.parcelsNote}</p>
          </div>
          <ol className="flex flex-col gap-3">
            {parcels.map((p, i) => {
              const s = p.shipment;
              return (
                <li key={p.key} className="flex flex-col gap-1" aria-label={o.parcel(i + 1)}>
                  <p className="font-medium">
                    {o.parcel(i + 1)}:{" "}
                    <span className="hint font-normal">
                      {s?.status === "delivered" ? o.stepDelivered : s?.trackingNumber ? o.stepOnWay : o.notShipped}
                    </span>
                  </p>
                  <p>{p.items.map((it) => (it.quantity > 1 ? `${it.title} × ${it.quantity}` : it.title)).join(", ")}</p>
                  {parcelDates.get(p.key) && <p>{o.expected}<strong>{dates(parcelDates.get(p.key)!)}</strong></p>}
                  {s?.trackingNumber && (
                    <p>
                      {s.carrier}:{" "}
                      {s.trackingUrl ? <a className="underline num" href={s.trackingUrl} target="_blank" rel="noreferrer">{s.trackingNumber}</a> : <span className="num">{s.trackingNumber}</span>}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {shipped.length > 0 && !(paid && parcels.length > 1) && (
        <section className="card p-5 flex flex-col gap-2 text-sm" aria-labelledby="tracking">
          <h2 id="tracking" className="font-semibold">{o.tracking}</h2>
          {shipped.map((f) => (
            <p key={f.id}>
              {f.carrier}:{" "}
              {f.trackingUrl ? <a className="underline num" href={f.trackingUrl} target="_blank" rel="noreferrer">{f.trackingNumber}</a> : <span className="num">{f.trackingNumber}</span>}
              {f.status === "delivered" && <span className="hint">{o.deliveredNote}</span>}
            </p>
          ))}
        </section>
      )}
      {paid && order.protectionMinor > 0 && order.paymentStatus !== "refunded" && (
        <p className="banner banner-info text-sm">
          <a className="underline-offset-2 hover:underline" href="#questions">{o.protectedNote(shop.name)}</a>
        </p>
      )}
      {pickupText && order.localDelivery && order.paymentStatus !== "refunded" && (
        <div className="banner banner-info text-sm" role="status">
          <p>
            {order.fulfillmentStatus === "delivered" ? pickupText.localDelivered(shop.name) : pickupText.localDeliveryWaiting(shop.name)}
            {order.fulfillmentStatus !== "delivered" && shop.localDeliveryArea?.note && <> {shop.localDeliveryArea.note.replace(/\.$/, "")}.</>}
            {order.fulfillmentStatus !== "delivered" && order.handoverOn && <> {pickupText.deliveryDay}: {formatHandoverDay(order.handoverOn, dayLang)}.</>}
          </p>
          {changeDay}
        </div>
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
          {order.fulfillmentStatus !== "delivered" && order.handoverOn && <p>{pickupText.pickupDay}: {formatHandoverDay(order.handoverOn, dayLang)}</p>}
          {changeDay}
        </section>
      )}
      {paid && shipped.length === 0 && !order.preorderShipsBy && !order.pickup && !order.localDelivery && (
        <p className="hint text-sm">
          {o.shipsSoon(order.lines.length !== 1, order.email)}
        </p>
      )}
      {lastEdit && (
        <p className="banner banner-info" role="status">
          {lastEdit.by === "buyer" && lastEdit.changes[0]?.startsWith("Cancelled")
            ? o.youCancelled(day.format(new Date(lastEdit.at)), order.paymentStatus === "refunded")
            : o.changed(lastEdit.by === "buyer", shop.name, day.format(new Date(lastEdit.at)), lastEdit.changes.join("; "))}
        </p>
      )}
      {edit?.canEdit && edit.until && (
        <section className="card p-5" aria-label={o.changeOrder}>
          <OrderEditForm action={editOrderByBuyerAction.bind(null, handle, ref)} address={edit.address} lines={edit.lines} countryName={countryName(edit.address.country)}
            summary={o.editSummary}
            note={o.editNote(utc.format(edit.until))} />
        </section>
      )}
      {cancel?.canCancel && cancel.until && <CancelOrder action={cancelOrderByBuyerAction.bind(null, handle, ref)} until={utc.format(cancel.until)} text={{ title: o.cancel.title, note: o.cancel.note(utc.format(cancel.until)), reason: o.cancel.reason, button: o.cancel.button, pending: o.cancel.pending }} />}
      <section className="card p-5 flex flex-col gap-3 text-sm">
        {order.lines.map((l, n) => (
          <div key={l.id} className="flex justify-between gap-3">
            <span>
              {l.title} × {l.quantity}
              {l.personalization && <span className="block hint">{l.personalization.map((p) => `${p.label}: ${p.value}`).join(" · ")}</span>}
              {l.preorder && <span className="block hint">{o.preorderLine}</span>}
            </span>
            <span className="num">{money(due.lines[n]!)}</span>
          </div>
        ))}
        {order.discountMinor > 0 && (
          <div className="flex justify-between gap-3 hint"><span>{order.discountCode ? o.discount(order.discountCode) : o.bundle(order.bundleTitle ?? "")}</span><span className="num">−{money(due.discountMinor)}</span></div>
        )}
        <div className="flex justify-between gap-3 hint"><span>{o.shipping(order.shippingMethod)}</span><span className="num">{due.shippingMinor ? money(due.shippingMinor) : o.free}</span></div>
        {due.protectionMinor > 0 && <div className="flex justify-between gap-3 hint"><span>{o.protection}</span><span className="num">{money(due.protectionMinor)}</span></div>}
        {due.giftWrapMinor > 0 && <div className="flex justify-between gap-3 hint"><span>{o.giftWrap}</span><span className="num">{money(due.giftWrapMinor)}</span></div>}
        {due.tipMinor > 0 && <div className="flex justify-between gap-3 hint"><span>{o.tip}</span><span className="num">{money(due.tipMinor)}</span></div>}
        {order.taxExemptId && <div className="flex justify-between gap-3 hint"><span>{o.taxExempt}</span><span className="num">{order.taxExemptId}</span></div>}
        {order.taxMinor > 0 && (
          <div className="flex justify-between gap-3 hint"><span>{order.taxBreakdown.map((t) => t.label).join(", ") || o.tax}{order.taxIncluded ? o.included : ""}</span><span className="num">{money(due.taxMinor)}</span></div>
        )}
        <div className="flex justify-between gap-3 border-t border-border pt-3 font-semibold"><span>{o.total}</span><span className="num">{money(due.totalMinor)}</span></div>
        {due.giftCardMinor > 0 && (
          <>
            <div className="flex justify-between gap-3 hint"><span>{o.paidGiftCard}</span><span className="num">−{money(due.giftCardMinor)}</span></div>
            <div className="flex justify-between gap-3 hint"><span>{o.paidCard}</span><span className="num">{money(due.chargedMinor)}</span></div>
          </>
        )}
      </section>
      {reviewable.length > 0 && (
        <section id="review" className="card p-5 flex flex-col gap-4" aria-labelledby="review-heading">
          <h2 id="review-heading" className="font-semibold">{o.reviewTitle}</h2>
          {shop.reviewRewardPercent && reviewable.some((i) => !i.review) && (
            <p className="text-sm">{o.reviewReward(shop.reviewRewardPercent)}</p>
          )}
          {reviewable.map((item) =>
            item.review ? (
              <p key={item.productId} className="text-sm">
                <span className="font-medium">{item.title}:</span> {o.reviewGiven(item.review.rating)}{" "}
                {item.review.status === "pending" ? o.reviewPending : o.reviewThanks}
                {item.review.rewardedAt && o.reviewRewarded(shop.reviewRewardPercent)}
              </p>
            ) : (
              <ReviewForm key={item.productId} handle={handle} orderRef={ref} productId={item.productId} title={item.title} name={(order.gift?.from ?? order.shippingAddress.name).split(" ")[0] ?? ""}
                rating={reviewable.filter((i) => !i.review).length === 1 ? tappedRating : undefined}
                text={{ thanks: o.review.thanks(item.title), rewardSent: o.review.rewardSent(shop.reviewRewardPercent ?? 0), reviewOf: o.review.reviewOf(item.title), rating: o.review.rating, stars: [1, 2, 3, 4, 5].map((n) => o.review.stars(n)), body: o.review.body, photos: o.review.photos, photosHint: o.review.photosHint, name: o.review.name, sending: o.review.sending, send: o.review.send }} />
            ),
          )}
        </section>
      )}
      {returns && (returns.latest || returns.canRequest || returns.blocked) && (
        <section id="returns" className="card p-5 flex flex-col gap-3" aria-labelledby="returns-heading">
          <h2 id="returns-heading" className="font-semibold">{o.returns}</h2>
          {returns.latest && (
            <div className="flex flex-col gap-1 text-sm" role="status">
              <p>
                {returns.latest.items.map((i) => `${i.title} × ${i.quantity}`).join(", ")}:{" "}
                {o.returnStatus(returns.latest.status, shop.name, returns.latest.resolvedMinor ? formatMoney(returns.latest.resolvedMinor, order.currency) : "", returns.latest.items.map((i) => i.exchangeTitle ?? i.title).join(", "))}
              </p>
              {returns.latest.merchantMessage && (returns.latest.status === "approved" || returns.latest.status === "declined" || returns.latest.status === "exchanged") && (
                <p className="border-l-2 border-border pl-3 whitespace-pre-line">{returns.latest.merchantMessage}</p>
              )}
            </div>
          )}
          {returns.blocked && !returns.open && <p className="text-sm hint">{returns.blocked}</p>}
          {returns.canRequest && (
            <ReturnForm handle={handle} orderRef={ref} lines={returns.lines.map((l) => ({ id: l.id, title: l.title, quantity: l.quantity, swaps: returns.exchanges[l.id] ?? [] }))}
              reasons={(Object.keys(RETURN_REASON_LABELS) as (keyof typeof RETURN_REASON_LABELS)[]).map((k): [string, string] => [k, o.reasons[k]])} closes={returns.closesAt ? day.format(returns.closesAt) : null}
              text={{ ...o.returnForm, until: returns.closesAt ? o.returnForm.until(day.format(returns.closesAt)) : "", swapFor: o.returnForm.swapFor("{title}") }} />
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
          <h2 id="questions" className="font-semibold">{o.questions}</h2>
          {thread.length > 0 && (
            <ol className="flex flex-col gap-3">
              {thread.map((m) => (
                <li key={m.id} className={`flex flex-col gap-1 max-w-[85%] ${m.author === "buyer" ? "self-end items-end" : "self-start"}`}>
                  <span className="hint">{m.author === "buyer" ? o.you : shop.name} · {time.format(m.createdAt)}</span>
                  <div className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-line ${m.author === "buyer" ? "bg-accent text-accent-ink" : "bg-sunken"}`}>{m.body}</div>
                </li>
              ))}
            </ol>
          )}
          <QuestionForm handle={handle} orderRef={ref} email={order.email}
            text={{ sent: o.question.sent(order.email), label: o.question.label, placeholder: o.question.placeholder, sending: o.question.sending, send: o.question.send }} />
        </section>
      )}
    </main>
  );
}
