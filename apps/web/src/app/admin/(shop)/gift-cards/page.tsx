import Link from "next/link";
import { formatMoney, giftCardBonusNow, GIFT_CARD_PAGE_SIZE, GIFT_CARD_SEND_DAYS, giftCardProduct, listGiftCards, type GiftCardStatus } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { BonusForm, BulkForm, CardActions, IssueForm, SellForm } from "./GiftCardForms";

export const metadata = { title: "Gift cards" };

const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

const FILTERS: { key?: GiftCardStatus; label: string }[] = [
  { label: "All" },
  { key: "active", label: "Active" },
  { key: "used", label: "Used up" },
  { key: "off", label: "Turned off" },
];

export default async function GiftCardsPage({ searchParams }: { searchParams: Promise<{ q?: string; show?: string; page?: string }> }) {
  const { shop, db } = await requireShop("gift_cards");
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const sendDays = { min: day(0), max: day(GIFT_CARD_SEND_DAYS) };
  const params = await searchParams;
  const q = params.q?.trim().slice(0, 100) || undefined;
  const status = FILTERS.find((f) => f.key && f.key === params.show)?.key;
  const page = /^\d{1,5}$/.test(params.page ?? "") ? Math.max(1, Number(params.page)) : 1;
  const [{ cards, total, outstandingMinor }, product] = await Promise.all([listGiftCards(db, shop.id, { query: q, status, page }), giftCardProduct(db, shop.id)]);
  const pages = Math.max(1, Math.ceil(total / GIFT_CARD_PAGE_SIZE));
  const href = (change: { show?: GiftCardStatus | null; page?: number }) => {
    const next = new URLSearchParams();
    const show = change.show === undefined ? status : change.show;
    if (show) next.set("show", show);
    if (q) next.set("q", q);
    if (change.page && change.page > 1) next.set("page", String(change.page));
    const qs = next.toString();
    return `/admin/gift-cards${qs ? `?${qs}` : ""}#gc-list`;
  };
  const money = (m: number) => formatMoney(m, shop.currency);
  const symbol = money(0).replace(/[\d.,\s]/g, "");
  // Past offers are dropped from the page once their last day is gone.
  const bonus = shop.giftCardBonus && shop.giftCardBonus.to >= new Date().toISOString().slice(0, 10) ? shop.giftCardBonus : null;
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
        {product && (
          <section className="card p-5 flex flex-col gap-3" aria-labelledby="gc-bonus">
            <div>
              <h2 id="gc-bonus" className="font-semibold">Bonus card with gift cards</h2>
              <p className="text-sm hint">
                &quot;Buy {money(5000)} in gift cards, get a {money(1000)} bonus card&quot;: a holiday favourite that brings buyers back. While the dates
                last, the gift card&apos;s page says so, and anyone who buys gift cards gets a bonus card of their own by email once they pay. Refunding
                the order turns the bonus card off too.
              </p>
            </div>
            {bonus && (
              <p className="text-sm" role="status" aria-label="Bonus offer">
                {giftCardBonusNow(shop) ? <span className="pill pill-success mr-2">On now</span> : <span className="pill pill-info mr-2">Set</span>}
                {money(bonus.bonusMinor)} for every {money(bonus.everyMinor)}, on gift cards bought {date.format(new Date(`${bonus.from}T12:00:00Z`))} to {date.format(new Date(`${bonus.to}T12:00:00Z`))}.
                {bonus.usableFrom ? ` Usable from ${date.format(new Date(`${bonus.usableFrom}T12:00:00Z`))}.` : ""}
                {bonus.usableUntil ? ` Expires after ${date.format(new Date(`${bonus.usableUntil}T12:00:00Z`))}.` : ""}
              </p>
            )}
            <BonusForm
              on={!!bonus}
              currencySymbol={symbol}
              value={bonus && { every: (bonus.everyMinor / 100).toFixed(2), bonus: (bonus.bonusMinor / 100).toFixed(2), from: bonus.from, to: bonus.to, usableFrom: bonus.usableFrom ?? "", usableUntil: bonus.usableUntil ?? "" }}
            />
          </section>
        )}
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="gc-give">
          <div>
            <h2 id="gc-give" className="font-semibold">Give a gift card</h2>
            <p className="text-sm hint">For store credit instead of a refund, a thank-you, or a giveaway. The code is emailed to them.</p>
          </div>
          <IssueForm />
        </section>
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="gc-bulk">
          <div>
            <h2 id="gc-bulk" className="font-semibold">Give gift cards to many people</h2>
            <p className="text-sm hint">
              When a company buys gift cards for its team or clients, or for prize winners: paste everyone in, check the total, and each gets
              their own code by email, now or on the day you pick. Take payment from the company first, for example by invoice.
            </p>
          </div>
          <BulkForm days={sendDays} />
        </section>
        <section className="flex flex-col gap-3" aria-labelledby="gc-list">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="gc-list" className="font-semibold">Gift cards</h2>
            <span className="text-sm hint num">Unspent on active cards: {money(outstandingMinor)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <form action="/admin/gift-cards#gc-list" className="flex gap-2 flex-1 min-w-60" role="search">
              {status && <input type="hidden" name="show" value={status} />}
              <label htmlFor="gc-q" className="sr-only">Find a gift card</label>
              <input id="gc-q" name="q" type="search" defaultValue={q} placeholder="Code, last 4, email or order #" className="input flex-1" />
              <button className="btn btn-secondary">Find</button>
            </form>
            <nav className="flex flex-wrap gap-1 text-sm" aria-label="Gift card filter">
              {FILTERS.map((f) => (
                <Link key={f.label} href={href({ show: f.key ?? null, page: 1 })} aria-current={f.key === status ? "page" : undefined}
                  className={`px-2 py-1 rounded-md ${f.key === status ? "bg-sunken font-semibold" : "hint"}`}>{f.label}</Link>
              ))}
            </nav>
          </div>
          {q && (
            <p className="hint text-sm">
              {total} {total === 1 ? "card matches" : "cards match"} &ldquo;{q}&rdquo;. <Link href={`/admin/gift-cards${status ? `?show=${status}` : ""}#gc-list`} className="underline">Clear</Link>
            </p>
          )}
          {cards.length === 0 ? (
            <p className="hint">{q ? "No gift card matches. A full code, the last 4 characters, the email it went to or the order number all work." : status ? "None here." : "None yet."}</p>
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
                        {c.email} · {c.bonus && c.orderNumber ? `Bonus with order #${c.orderNumber}` : c.orderNumber ? `Bought on order #${c.orderNumber}` : c.fromName ? `Given by you, from ${c.fromName}` : "Given by you"} · {date.format(c.createdAt)}
                        {c.usableFrom && c.usableFrom > new Date() ? ` · Usable from ${date.format(c.usableFrom)}` : ""}
                        {c.expiresAt ? ` · ${c.expiresAt <= new Date() ? "Expired" : "Expires"} ${date.format(new Date(c.expiresAt.getTime() - 1))}` : ""}
                        {!c.sentAt && (c.scheduledFor ? ` · Sends on ${c.scheduledFor.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}` : " · Email not sent")}
                      </span>
                    </div>
                    <span className="num text-sm">{money(c.balanceMinor)} left of {money(c.initialMinor)}</span>
                    <CardActions id={c.id} disabled={!!c.disabledAt} usedUp={c.balanceMinor === 0} />
                  </li>
                );
              })}
            </ul>
          )}
          {pages > 1 && (
            <nav aria-label="Pages" className="flex items-center gap-3 text-sm">
              {page > 1 && <Link href={href({ page: page - 1 })} className="btn btn-secondary">← Newer</Link>}
              <span className="hint num">Page {Math.min(page, pages)} of {pages}</span>
              {page < pages && <Link href={href({ page: page + 1 })} className="btn btn-secondary ml-auto">Older →</Link>}
            </nav>
          )}
        </section>
      </div>
    </main>
  );
}
