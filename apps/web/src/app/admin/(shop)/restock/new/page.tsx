import Link from "next/link";
import { formatMoney, restockChoices, restockSuggestions, SUGGEST_DAYS } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../../PageHeader";
import { NewRestockForm } from "../RestockForms";

export const metadata = { title: "New restock order" };

export default async function NewRestockPage({ searchParams }: { searchParams: Promise<{ suggest?: string }> }) {
  const { suggest } = await searchParams;
  const { shop, db } = await requireShop("products");
  const choices = await restockChoices(db, shop.id);
  // ?suggest=60 fills in enough for the next 60 days at the pace of the last 30.
  const days = SUGGEST_DAYS.find((d) => String(d) === suggest) ?? null;
  const suggested = days ? await restockSuggestions(db, shop, days) : new Map<string, number>();
  return (
    <main className="pb-12">
      <PageHeader title="New restock order" back={<Link href="/admin/restock" className="hint hover:text-ink">← Restock orders</Link>} />
      <div className="px-4 sm:px-8 max-w-4xl">
        {choices.length === 0 ? (
          <p className="hint">Restock orders are for products you keep in stock yourself. Products from a supplier restock on their own.</p>
        ) : (
          <>
          <div className="card p-4 mb-5 flex flex-col gap-2 text-sm" role="region" aria-label="Suggested amounts">
            <p>
              {days === null
                ? "Fill in how many to order from what sold in the last 30 days:"
                : suggested.size
                  ? `Filled in with enough for the next ${days} days at the pace of the last 30, less what's on the shelf and on the way. Change anything before saving.`
                  : `Nothing needs ordering for the next ${days} days at the pace of the last 30.`}
            </p>
            <p className="flex flex-wrap gap-3">
              {SUGGEST_DAYS.map((d) => (
                <Link key={d} href={`/admin/restock/new?suggest=${d}`} className={d === days ? "font-semibold" : "underline"} aria-current={d === days ? "page" : undefined}>Enough for {d} days</Link>
              ))}
              {days !== null && <Link href="/admin/restock/new" className="underline">Clear</Link>}
            </p>
          </div>
          <NewRestockForm
            key={days ?? "none"}
            currencySymbol={formatMoney(0, shop.currency).replace(/[\d.,\s]/g, "")}
            choices={choices.map((c) => ({ variantId: c.variantId, title: c.title, sku: c.sku, stock: c.stock, cost: c.costMinor === null ? "" : (c.costMinor / 100).toFixed(2), suggested: suggested.get(c.variantId) }))}
          />
          </>
        )}
      </div>
    </main>
  );
}
