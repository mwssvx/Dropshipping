import Link from "next/link";
import { formatMoney, listCostChanges, productChoices } from "@sf/core";
import { requireShop, testPayments } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { ChangeActions, PriceWatchSettings, SimulateRise } from "./PriceWatchForms";

export const metadata = { title: "Price changes" };

const STATUS = { open: "Needs a look", repriced: "Raised automatically", raised: "Price raised", kept: "Price kept" } as const;
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default async function PriceChangesPage() {
  const { shop, db } = await requireShop("products");
  const [changes, products] = await Promise.all([listCostChanges(db, shop), testPayments() ? productChoices(db, shop.id) : []]);
  const money = (m: number) => formatMoney(m, shop.currency);
  const open = changes.filter((c) => c.status === "open");
  const done = changes.filter((c) => c.status !== "open");
  return (
    <main className="pb-12">
      <PageHeader title="Price changes" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-4xl">
        <p className="text-sm">
          We check your suppliers&apos; prices every day. When one charges more for an item, it shows here with your margin before and after.
          If the margin drops below what you want, we email you once. Raising uses your <Link href="/admin/pricing" className="underline">pricing rule</Link>.
        </p>

        <section className="card p-5 flex flex-col gap-3" aria-labelledby="watch-heading">
          <h2 id="watch-heading" className="font-semibold">Price watch</h2>
          <PriceWatchSettings minMarginPercent={shop.minMarginPercent} autoReprice={shop.autoReprice} />
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="open-heading">
          <h2 id="open-heading" className="font-semibold">Needs a look</h2>
          {open.length ? (
            <ul className="card divide-y divide-border" aria-label="Price rises to look at">
              {open.map((c) => (
                <li key={c.id} className="p-4 flex flex-wrap items-center justify-between gap-3 text-sm" aria-label={c.title}>
                  <div className="flex flex-col gap-1 min-w-56">
                    <span className="font-medium">{c.title}</span>
                    <span className="hint num">
                      Cost {money(c.costBeforeMinor)} → {money(c.costAfterMinor)} · price {money(c.currentPriceMinor)} · since {date.format(c.createdAt)}
                    </span>
                    <span className={c.belowTarget ? "text-critical" : "hint"}>
                      Margin {c.marginBefore}% → {c.marginNow}%{c.belowTarget ? `, below your ${shop.minMarginPercent}%` : ""}
                    </span>
                  </div>
                  <ChangeActions id={c.id} raiseLabel={c.suggestedPriceMinor > c.currentPriceMinor ? `Raise to ${money(c.suggestedPriceMinor)}` : null} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">No supplier price rises to look at.</p>
          )}
        </section>

        {done.length > 0 && (
          <section className="flex flex-col gap-3" aria-labelledby="done-heading">
            <h2 id="done-heading" className="font-semibold">Dealt with</h2>
            <ul className="card divide-y divide-border" aria-label="Price rises dealt with">
              {done.map((c) => (
                <li key={c.id} className="p-4 flex flex-wrap items-center justify-between gap-3 text-sm" aria-label={c.title}>
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">{c.title}</span>
                    <span className="hint num">
                      Cost {money(c.costBeforeMinor)} → {money(c.costAfterMinor)} · price {money(c.priceMinor)}{c.newPriceMinor ? ` → ${money(c.newPriceMinor)}` : ""}
                    </span>
                  </div>
                  <span className={`pill ${c.status === "kept" ? "pill-neutral" : "pill-success"}`}>{STATUS[c.status]}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {testPayments() && products.length > 0 && (
          <details className="card p-4 text-sm">
            <summary className="cursor-pointer">Test mode: simulate a supplier price rise</summary>
            <div className="pt-3"><SimulateRise products={products.map((p) => ({ id: p.id, title: p.title }))} /></div>
          </details>
        )}
      </div>
    </main>
  );
}
