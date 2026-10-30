import Link from "next/link";
import { compareDetail, compareProducts } from "@sf/core";
import { Price } from "@/components/Price";
import { buyerFx } from "@/lib/currency";
import { readCompare } from "@/lib/compare";
import { db } from "@/lib/server";
import { clearCompareAction, toggleCompareAction } from "../actions";
import { loadShop, localProducts, storeBase, storeT } from "../data";

export const metadata = { title: "Compare", robots: { index: false } };
export const dynamic = "force-dynamic";

/** The shopper's picks side by side: price, rating, options, stock and the details table. */
export default async function ComparePage({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: handle } = await params;
  const shop = await loadShop(handle);
  const [base, fx, t] = await Promise.all([storeBase(handle), buyerFx(shop), storeT(handle)]);
  const { products: raw, labels } = await compareProducts(await db(), shop.id, await readCompare(shop.id));
  const products = await localProducts(handle, raw);
  const row = (label: string, cells: React.ReactNode[]) => (
    <tr key={label} className="border-t border-border align-top">
      <th scope="row" className="py-3 pr-4 text-left text-sm font-medium text-muted w-32">{label}</th>
      {cells.map((c, i) => <td key={products[i]!.id} className="py-3 pr-4 text-sm">{c}</td>)}
    </tr>
  );

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{t.compareTitle}</h1>
        {products.length > 0 && (
          <form action={clearCompareAction.bind(null, handle)}>
            <button className="text-sm underline">{t.compareClear}</button>
          </form>
        )}
      </div>
      {products.length === 0 && <p className="text-muted">{t.compareEmpty}</p>}
      {products.length === 1 && <p className="text-muted">{t.compareOne}</p>}
      {products.length > 0 && (
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full min-w-[36rem] border-collapse" aria-label={t.compareTitle}>
            <thead>
              <tr>
                <td />
                {products.map((p) => {
                  const photo = p.imageUrl ?? p.variants.find((v) => v.imageUrl)?.imageUrl;
                  return (
                    <th key={p.id} scope="col" className="pb-4 pr-4 text-left align-top font-normal">
                      <div className="flex flex-col gap-2 max-w-56">
                        <Link href={`${base}/products/${p.handle}`} className="sf-media aspect-square rounded-lg bg-sunken overflow-hidden">
                          {photo && <img src={photo} alt="" className="size-full object-cover" />}
                        </Link>
                        <Link href={`${base}/products/${p.handle}`} className="font-medium hover:underline">{p.title}</Link>
                        <form action={toggleCompareAction.bind(null, handle, p.id, "compare")}>
                          <input type="hidden" name="on" value="0" />
                          <button className="text-sm hint hover:text-critical" aria-label={t.removeNamed(p.title)}>{t.remove}</button>
                        </form>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {row(t.comparePrice, products.map((p) => {
                const cheapest = p.variants.reduce((a, b) => (b.priceMinor < a.priceMinor ? b : a));
                const varies = p.variants.some((v) => v.priceMinor !== cheapest.priceMinor);
                return <span className="num">{varies && `${t.from} `}<Price minor={cheapest.priceMinor} compareAt={cheapest.compareAtMinor} currency={shop.currency} fx={fx} /></span>;
              }))}
              {row(t.compareRating, products.map((p) => (p.rating.count && p.rating.average !== null ? <span><span aria-hidden>★ </span>{p.rating.average} · {t.reviewCount(p.rating.count)}</span> : <span className="hint">{t.compareNoRating}</span>)))}
              {row(t.compareStock, products.map((p) => (p.soldOut ? <span className="pill pill-neutral">{t.soldOut}</span> : <span className="pill pill-success">{t.compareInStock}</span>)))}
              {products.some((p) => p.options.length) &&
                row(t.option, products.map((p) => (p.options.length ? <ul className="flex flex-col gap-1">{p.options.map((o) => <li key={o.name}><span className="hint">{o.name}:</span> {o.values.join(", ")}</li>)}</ul> : <span className="hint">—</span>)))}
              {labels.map((label) => row(label, products.map((p) => compareDetail(p.details, label) ?? <span className="hint">—</span>)))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
