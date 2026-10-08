import Link from "next/link";
import { formatMoney, giftCardProduct, listGiftCards } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { CardActions, IssueForm, SellForm } from "./GiftCardForms";

export const metadata = { title: "Gift cards" };

const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function GiftCardsPage() {
  const { shop, db } = await requireShop("gift_cards");
  const [{ cards, outstandingMinor }, product] = await Promise.all([listGiftCards(db, shop.id), giftCardProduct(db, shop.id)]);
  const money = (m: number) => formatMoney(m, shop.currency);
  const symbol = money(0).replace(/[\d.,\s]/g, "");
  return (
    <main className="pb-12">
      <PageHeader title="Gift cards" />
      <div className="px-4 sm:px-8 flex flex-col gap-4 max-w-3xl">
        <p className="hint">
          Gift cards are free on every plan. Buyers enter the code in their cart, it never expires, and whatever isn&apos;t spent stays on the card.
          We only keep the last 4 characters of each code; the full code is emailed once.
        </p>
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="gc-sell">
          <h2 id="gc-sell" className="font-semibold">Sell gift cards on your store</h2>
          {product ? (
            <p className="text-sm">
              Your <Link href={`/admin/products/${product.id}`} className="underline">Gift card product</Link> is {product.status === "active" ? "live" : "a draft"}.
              Each one bought is emailed to the buyer as soon as they pay, with no shipping and no tax (tax is charged when it&apos;s spent).
            </p>
          ) : (
            <>
              <p className="text-sm hint">Adds a Gift card product with one option per amount. Codes are emailed to the buyer as soon as they pay.</p>
              <SellForm currencySymbol={symbol} />
            </>
          )}
        </section>
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="gc-give">
          <div>
            <h2 id="gc-give" className="font-semibold">Give a gift card</h2>
            <p className="text-sm hint">For store credit instead of a refund, a thank-you, or a giveaway. The code is emailed to them.</p>
          </div>
          <IssueForm />
        </section>
        <section className="flex flex-col gap-3" aria-labelledby="gc-list">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="gc-list" className="font-semibold">Gift cards</h2>
            <span className="text-sm hint num">Unspent on active cards: {money(outstandingMinor)}</span>
          </div>
          {cards.length === 0 ? (
            <p className="hint">None yet.</p>
          ) : (
            <ul className="card divide-y divide-border">
              {cards.map((c) => {
                const status = c.disabledAt ? "Turned off" : c.balanceMinor === 0 ? "Used up" : "Active";
                return (
                  <li key={c.id} className="p-4 flex flex-wrap items-center justify-between gap-3" aria-label={`Gift card ending ${c.last4}`}>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium num">
                        ···· {c.last4} <span className={`ml-1 pill ${status === "Active" ? "pill-success" : "pill-neutral"}`}>{status}</span>
                      </span>
                      <span className="text-sm hint">
                        {c.email} · {c.orderNumber ? `Bought on order #${c.orderNumber}` : "Given by you"} · {date.format(c.createdAt)}
                        {!c.sentAt && " · Email not sent"}
                      </span>
                    </div>
                    <span className="num text-sm">{money(c.balanceMinor)} left of {money(c.initialMinor)}</span>
                    <CardActions id={c.id} disabled={!!c.disabledAt} usedUp={c.balanceMinor === 0} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
