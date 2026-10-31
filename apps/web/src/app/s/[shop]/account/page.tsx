import Link from "next/link";
import { awaitingReview, buyerOrders, formatBirthday, formatDeliveryDate, intervalLabel, subscriptionsForEmail, describeReferralProgram, describeRewards, formatMoney, myReferrals, referralCodeFor, REWARD_STEP, rewardsFor } from "@sf/core";
import { ReferralCard } from "@/components/ReferralCard";
import { currentBuyer } from "@/lib/buyer";
import { db, storeAddress } from "@/lib/server";
import { loadShop, storeBase, storeT } from "../data";
import { buyAgainAction, buyerSignOutAction, setBuyerMarketingAction } from "./actions";
import { SignInForm } from "./SignInForm";
import { WholesaleForm } from "./WholesaleForm";
import { BirthdayForm } from "./BirthdayForm";
import { RedeemForm } from "./RedeemForm";

export const metadata = { title: "Your account", robots: { index: false } };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  unfulfilled: "Confirmed",
  sent_to_supplier: "Being prepared",
  partially_shipped: "Partly shipped",
  shipped: "On its way",
  delivered: "Delivered",
  problem: "Being prepared",
};
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function AccountPage({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: handle } = await params;
  const shop = await loadShop(handle);
  const base = await storeBase(handle);
  const buyer = await currentBuyer(shop.id);

  if (!buyer) {
    return (
      <main className="max-w-md mx-auto px-4 sm:px-6 py-12 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Your orders</h1>
          <p className="text-muted">Sign in to see your orders from {shop.name}, track them, and check out faster next time.</p>
        </div>
        <div className="card p-6"><SignInForm handle={handle} /></div>
      </main>
    );
  }

  const orders = await buyerOrders(await db(), shop.id, buyer.email);
  const subs = (await subscriptionsForEmail(await db(), shop.id, buyer.email)).filter((s) => s.status !== "cancelled");
  // Things they bought that have arrived (or are on their way) and they haven't reviewed yet.
  const toReview = await awaitingReview(await db(), shop.id, orders.map((o) => o.id));
  const reviewList = orders.flatMap((o) => (toReview.get(o.id) ?? []).map((item) => ({ ...item, order: o })));
  const rewards = shop.rewardsEnabled ? await rewardsFor(await db(), shop, buyer.email) : null;
  const referCode = shop.referralProgram && orders.length ? await referralCodeFor(await db(), shop, buyer.id) : null;
  const referred = referCode ? await myReferrals(await db(), shop.id, buyer.id) : null;
  const t = referCode ? await storeT(handle) : null;
  // The fewest points that make at least 1.00 of credit, in whole hundreds.
  const minSwap = Math.max(REWARD_STEP, Math.ceil(100 / shop.rewardsValueMinor) * REWARD_STEP);
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight">Your orders</h1>
          <p className="text-muted">Signed in as {buyer.email}</p>
        </div>
        <form action={buyerSignOutAction.bind(null, handle)}><button className="btn btn-secondary">Sign out</button></form>
      </div>
      <form action={setBuyerMarketingAction.bind(null, handle, !buyer.acceptsMarketing)} className="card p-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <span>{buyer.acceptsMarketing ? `You get news and offers from ${shop.name} by email.` : `You don't get marketing emails from ${shop.name}.`}</span>
        <button className="btn btn-secondary">{buyer.acceptsMarketing ? "Stop news and offers" : "Send me news and offers"}</button>
      </form>
      {reviewList.length > 0 && (
        <section aria-labelledby="to-review-heading" className="card p-5 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="to-review-heading" className="font-semibold">Waiting for your review</h2>
            <p className="hint text-sm">Tell other shoppers what you thought. It only takes a minute.</p>
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {reviewList.slice(0, 10).map(({ productId, title, order }) => (
              <li key={`${order.id}:${productId}`} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <span className="text-sm">
                  {title} <span className="hint num">· order #{order.number}</span>
                </span>
                <Link href={`${base}/orders/${order.ref}#review`} className="btn btn-secondary" aria-label={`Review ${title}`}>Write a review</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {shop.birthdayOffer && (
        <section aria-labelledby="birthday-heading" className="card p-5 flex flex-col gap-3">
          <h2 id="birthday-heading" className="font-semibold">Your birthday</h2>
          <p className="text-sm">
            {buyer.birthday ? `We have ${formatBirthday(buyer.birthday)}. ` : ""}
            Tell us your birthday and we&apos;ll email you {shop.birthdayOffer.percentOff}% off that day
            {buyer.acceptsMarketing ? "." : ", once you say yes to news and offers."} We only ask for the month and day.
          </p>
          <BirthdayForm handle={handle} birthday={buyer.birthday} />
        </section>
      )}
      {shop.wholesaleEnabled && (
        <section id="wholesale" aria-labelledby="wholesale-heading" className="card p-5 flex flex-col gap-3">
          <h2 id="wholesale-heading" className="font-semibold">Buying for a business?</h2>
          {buyer.wholesaleStatus === "approved" ? (
            <p role="status">
              You get wholesale prices: {shop.wholesalePercentOff}% off everything while you&apos;re signed in
              {shop.wholesaleMinOrderMinor > 0 ? `, on orders of ${formatMoney(shop.wholesaleMinOrderMinor, shop.currency)} or more` : ""}.
            </p>
          ) : buyer.wholesaleStatus === "pending" ? (
            <p role="status">Thanks, {shop.name} is looking at your application for {buyer.wholesaleCompany}. We&apos;ll email you when they decide.</p>
          ) : (
            <>
              <p className="text-muted text-sm">
                {buyer.wholesaleStatus === "declined"
                  ? `${shop.name} couldn't offer wholesale prices last time. You can apply again.`
                  : `${shop.name} sells wholesale to shops and businesses. Apply and they'll email you when you're approved.`}
              </p>
              <WholesaleForm handle={handle} company={buyer.wholesaleCompany} />
            </>
          )}
        </section>
      )}
      {rewards && (
        <section id="rewards" aria-labelledby="rewards-heading" className="card p-5 flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="rewards-heading" className="font-semibold">Your points</h2>
            <span className="num text-lg font-semibold">{rewards.points.toLocaleString("en-US")}</span>
          </div>
          <p className="hint text-sm">{describeRewards(shop)}</p>
          {rewards.points >= minSwap ? (
            <p className="text-sm">Worth {formatMoney(rewards.creditMinor, shop.currency)} in store credit.</p>
          ) : (
            <p className="text-sm">Collect {minSwap.toLocaleString("en-US")} points to swap them for store credit.</p>
          )}
          <RedeemForm handle={handle} min={minSwap} max={Math.floor(Math.max(rewards.points, 0) / REWARD_STEP) * REWARD_STEP} />
          {rewards.entries.length > 0 && (
            <ul className="text-sm divide-y divide-border border-t border-border">
              {rewards.entries.map((e) => (
                <li key={e.id} className="flex justify-between gap-3 py-2">
                  <span>{e.label} <span className="hint">· {date.format(e.at)}</span></span>
                  <span className={`num ${e.points > 0 ? "text-success" : ""}`}>{e.points > 0 ? "+" : "−"}{Math.abs(e.points).toLocaleString("en-US")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {referCode && t && referred && shop.referralProgram && (
        <ReferralCard
          title={t.referTitle(shop.referralProgram.friendPercentOff)}
          body={t.referBody(shop.referralProgram.friendPercentOff, describeReferralProgram(shop.referralProgram, shop.currency).reward)}
          link={`${await storeAddress(shop)}/refer/${referCode}`}
          stats={referred.invited ? t.referStats(referred.invited, formatMoney(referred.creditMinor, shop.currency)) : null}
          labels={{ link: t.referLink, copy: t.referCopy, copied: t.referCopied }}
        />
      )}
      {subs.length > 0 && (
        <section aria-labelledby="subs-heading" className="card p-5 flex flex-col gap-3">
          <h2 id="subs-heading" className="font-semibold">Your subscriptions</h2>
          <ul className="text-sm divide-y divide-border border-t border-border">
            {subs.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span>
                  {intervalLabel(s.intervalDays)}, {s.percentOff}% off
                  <span className="hint"> · {s.status === "active" ? `next on ${formatDeliveryDate(s.nextOrderAt)}` : "paused"}</span>
                </span>
                <Link href={`${base}/subscriptions/${s.token}`} className="underline">Manage</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {orders.length === 0 ? (
        <div className="card p-6 flex flex-col gap-3 items-start">
          <p>No orders with this email yet.</p>
          <Link href={base || "/"} className="btn btn-primary">Start shopping</Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {orders.map((o) => (
            <li key={o.id} className="card p-5 flex flex-col gap-3" aria-label={`Order #${o.number}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold num">Order #{o.number}</span>
                <span className="hint">{date.format(o.paidAt)}</span>
              </div>
              <p className="text-sm">{o.items.map((i) => `${i.title}${i.quantity > 1 ? ` × ${i.quantity}` : ""}`).join(", ")}</p>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-3 text-sm">
                  <span className="pill pill-neutral">{o.paymentStatus === "refunded" ? "Refunded" : STATUS[o.fulfillmentStatus]}</span>
                  <span className="num">{formatMoney(o.totalMinor - o.refundedMinor, o.currency)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Link href={`${base}/orders/${o.ref}`} className="btn btn-secondary">Track</Link>
                  <form action={buyAgainAction.bind(null, handle, o.id)}><button className="btn btn-primary" aria-label={`Buy order #${o.number} again`}>Buy again</button></form>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
