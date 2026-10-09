import type { Sort } from "@sf/core";
import { storeText, type StoreText } from "@/lib/store-text";

export type BrowseParams = { q?: string; sort?: string; min?: string; max?: string; stock?: string };

/** "12" or "12.50" in the buyer's currency, as minor units; anything else means no limit. */
export const priceParam = (raw?: string) => {
  const n = Number((raw ?? "").replace(/[^\d.]/g, ""));
  return raw && raw.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

export function browseOptions(p: BrowseParams) {
  return { q: p.q?.slice(0, 200), sort: p.sort, minMinor: priceParam(p.min), maxMinor: priceParam(p.max), inStock: p.stock === "1" };
}

/**
 * Sort and filter controls for the search and collection pages. A plain GET form, so it works
 * before any script loads and every result page has its own shareable address.
 */
export function BrowseBar({ action, params, sort, currency, search, count, t = storeText(null) }: { action: string; params: BrowseParams; sort: Sort; currency: string; search?: boolean; count: number; t?: StoreText }) {
  // The first choice is the page's natural order, sent as no sort at all, so a new search goes
  // back to best match instead of keeping the last page's order.
  const q = params.q?.trim();
  const natural = search ? (q ? t.sorts.relevance : t.sorts.newest) : t.sorts.featured;
  const sorts = (["best_selling", "price_asc", "price_desc", "newest"] as const).filter((s) => !(search && !q && s === "newest"));
  return (
    <form action={action} method="get" role="search" aria-label={search ? t.searchStore : t.sortAndFilter} className="flex flex-col gap-4">
      {search && (
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="q">{t.search}</label>
          <input className="input flex-1" id="q" name="q" type="search" defaultValue={params.q ?? ""} placeholder={t.searchProducts} autoFocus={!params.q} maxLength={200} />
          <button className="btn btn-primary">{t.search}</button>
        </div>
      )}
      {!search && params.q && <input type="hidden" name="q" value={params.q} />}
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <div className="field">
          <label className="label" htmlFor="sort">{t.sortBy}</label>
          <select className="input" id="sort" name="sort" defaultValue={(sorts as readonly string[]).includes(sort) ? sort : ""}>
            <option value="">{natural}</option>
            {sorts.map((s) => <option key={s} value={s}>{t.sorts[s]}</option>)}
          </select>
        </div>
        <fieldset className="flex items-end gap-2">
          <legend className="label mb-1">{t.priceIn(currency)}</legend>
          <label className="sr-only" htmlFor="min">{t.lowestPrice}</label>
          <input className="input w-24 num" id="min" name="min" inputMode="decimal" placeholder={t.from} defaultValue={params.min ?? ""} />
          <span className="pb-2.5 hint" aria-hidden>–</span>
          <label className="sr-only" htmlFor="max">{t.highestPrice}</label>
          <input className="input w-24 num" id="max" name="max" inputMode="decimal" placeholder={t.to} defaultValue={params.max ?? ""} />
        </fieldset>
        <label className="flex items-center gap-2 pb-2.5">
          <input type="checkbox" name="stock" value="1" defaultChecked={params.stock === "1"} /> {t.inStockOnly}
        </label>
        <button className="btn btn-secondary">{t.apply}</button>
        <span className="hint pb-2.5 ml-auto" role="status">{t.productCount(count)}</span>
      </div>
    </form>
  );
}
