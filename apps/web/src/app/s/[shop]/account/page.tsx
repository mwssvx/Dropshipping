import Link from "next/link";
import { awaitingReview, buyerOrders, formatBirthday, formatDeliveryDate, intervalLabel, subscriptionsForEmail, describeReferralProgram, describeRewards, formatMoney, myReferrals, referralCodeFor, REWARD_STEP, rewardsFor } from "@sf/core";
import { ReferralCard } from "@/components/ReferralCard";
import { currentBuyer } from "@/lib/buyer";
import { db, storeAddress } from "@/lib/server";
import { accountText } from "@/lib/account-text";
import { loadShop, storeBase, storeLang, storeT } from "../data";
import { buyAgainAction, buyerSignOutAction, setBuyerMarketingAction } from "./actions";
import { SignInForm } from "./SignInForm";
import { WholesaleForm } from "./WholesaleForm";
import { BirthdayForm } from "./BirthdayForm";
import { RedeemForm } from "./RedeemForm";

export const metadata = { title: "Your account", robots: { index: false } };
export const dynamic = "force-dynamic";


export default async function AccountPage({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: handle } = await params;
  const shop = await loadShop(handle);
  const base = await storeBase(handle);
  const buyer = await currentBuyer(shop.id);
  const lang = await storeLang(handle);
  const a = accountText(lang);
  const date = new Intl.DateTimeFormat(a.locale, { month: "short", day: "numeric", year: "numeric" });
  const nextDate = new Intl.DateTimeFormat(a.locale, { weekday: "short", month: "short", day: "numeric" });
  const birthdayDate = new Intl.DateTimeFormat(a.locale, { month: "long", day: "numeric", timeZone: "UTC" });
  const num = (n: number) => n.toLocaleString(a.locale);

  if (!buyer) {
    return (
      <main className="max-w-md mx-auto px-4 sm:px-6 py-12 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">{a.title}</h1>
          <p className="text-muted">{a.signInIntro(shop.name)}</p>
        </div>
        <div className="card p-6"><SignInForm handle={handle} lang={lang} /></div>
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
          <h1 className="text-3xl font-bold tracking-tight">{a.title}</h1>
          <p className="text-muted">{a.signedInAs(buyer.email)}</p>
        </div>
        <form action={buyerSignOutAction.bind(null, handle)}><button className="btn btn-secondary">{a.signOut}</button></form>
      </div>
      <form action={setBuyerMarketingAction.bind(null, handle, !buyer.acceptsMarketing)} className="card p-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <span>{buyer.acceptsMarketing ? a.marketingOn(shop.name) : a.marketingOff(shop.name)}</span>
        <button className="btn btn-secondary">{buyer.acceptsMarketing ? a.stopMarketing : a.startMarketing}</button>
      </form>
      {reviewList.length > 0 && (
        <section aria-labelledby="to-review-heading" className="card p-5 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="to-review-heading" className="font-semibold">{a.toReview}</h2>
            <p className="hint text-sm">{a.toReviewHint}</p>
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {reviewList.slice(0, 10).map(({ productId, title, order }) => (
              <li key={`${order.id}:${productId}`} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <span className="text-sm">
                  {title} <span className="hint num">{a.orderSuffix(order.number)}</span>
                </span>
                <Link href={`${base}/orders/${order.ref}#review`} className="btn btn-secondary" aria-label={a.reviewOf(title)}>{a.writeReview}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {shop.birthdayOffer && (
        <section aria-labelledby="birthday-heading" className="card p-5 flex flex-col gap-3">
          <h2 id="birthday-heading" className="font-semibold">{a.birthday}</h2>
          <p className="text-sm">
            {buyer.birthday ? a.birthdayHave(lang ? birthdayDate.format(new Date(`2000-${buyer.birthday}T00:00:00Z`)) : formatBirthday(buyer.birthday) ?? buyer.birthday) : ""}
            {a.birthdayAsk(shop.birthdayOffer.percentOff, buyer.acceptsMarketing)}
          </p>
          <BirthdayForm handle={handle} birthday={buyer.birthday} lang={lang} />
        </section>
      )}
      {shop.wholesaleEnabled && (
        <section id="wholesale" aria-labelledby="wholesale-heading" className="card p-5 flex flex-col gap-3">
          <h2 id="wholesale-heading" className="font-semibold">{a.wholesale}</h2>
          {buyer.wholesaleStatus === "approved" ? (
            <p role="status">
              {a.wholesaleApproved(shop.wholesalePercentOff, shop.wholesaleMinOrderMinor > 0 ? formatMoney(shop.wholesaleMinOrderMinor, shop.currency) : null)}
            </p>
          ) : buyer.wholesaleStatus === "pending" ? (
            <p role="status">{a.wholesalePending(shop.name, buyer.wholesaleCompany ?? "")}</p>
          ) : (
            <>
              <p className="text-muted text-sm">
                {buyer.wholesaleStatus === "declined"
                  ? a.wholesaleDeclined(shop.name)
                  : a.wholesaleAsk(shop.name)}
              </p>
              <WholesaleForm handle={handle} company={buyer.wholesaleCompany} lang={lang} />
            </>
          )}
        </section>
      )}
      {rewards && (
        <section id="rewards" aria-labelledby="rewards-heading" className="card p-5 flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="rewards-heading" className="font-semibold">{a.points}</h2>
            <span className="num text-lg font-semibold">{num(rewards.points)}</span>
          </div>
          <p className="hint text-sm">{describeRewards(shop)}</p>
          {rewards.points >= minSwap ? (
            <p className="text-sm">{a.pointsWorth(formatMoney(rewards.creditMinor, shop.currency))}</p>
          ) : (
            <p className="text-sm">{a.pointsCollect(num(minSwap))}</p>
          )}
          <RedeemForm handle={handle} lang={lang} min={minSwap} max={Math.floor(Math.max(rewards.points, 0) / REWARD_STEP) * REWARD_STEP} />
          {rewards.entries.length > 0 && (
            <ul className="text-sm divide-y divide-border border-t border-border">
              {rewards.entries.map((e) => (
                <li key={e.id} className="flex justify-between gap-3 py-2">
                  <span>{e.label} <span className="hint">· {date.format(e.at)}</span></span>
                  <span className={`num ${e.points > 0 ? "text-success" : ""}`}>{e.points > 0 ? "+" : "−"}{num(Math.abs(e.points))}</span>
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
          <h2 id="subs-heading" className="font-semibold">{a.subscriptions}</h2>
          <ul className="text-sm divide-y divide-border border-t border-border">
            {subs.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span>
                  {a.subLine(lang ? a.every(s.intervalDays) : intervalLabel(s.intervalDays), s.percentOff)}
                  <span className="hint"> · {s.status === "active" ? a.subNext(lang ? nextDate.format(s.nextOrderAt) : formatDeliveryDate(s.nextOrderAt)) : a.subPaused}</span>
                </span>
                <Link href={`${base}/subscriptions/${s.token}`} className="underline">{a.manage}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {orders.length === 0 ? (
        <div className="card p-6 flex flex-col gap-3 items-start">
          <p>{a.noOrders}</p>
          <Link href={base || "/"} className="btn btn-primary">{a.startShopping}</Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {orders.map((o) => (
            <li key={o.id} className="card p-5 flex flex-col gap-3" aria-label={a.order(o.number)}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold num">{a.order(o.number)}</span>
                <span className="hint">{date.format(o.paidAt)}</span>
              </div>
              <p className="text-sm">{o.items.map((i) => `${i.title}${i.quantity > 1 ? ` × ${i.quantity}` : ""}`).join(", ")}</p>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-3 text-sm">
                  <span className="pill pill-neutral">{o.paymentStatus === "refunded" ? a.refunded : a.status[o.fulfillmentStatus as keyof typeof a.status]}</span>
                  <span className="num">{formatMoney(o.totalMinor - o.refundedMinor, o.currency)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Link href={`${base}/orders/${o.ref}`} className="btn btn-secondary">{a.track}</Link>
                  <form action={buyAgainAction.bind(null, handle, o.id)}><button className="btn btn-primary" aria-label={a.buyAgainLabel(o.number)}>{a.buyAgain}</button></form>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
