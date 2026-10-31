import type { Facet, Sort } from "@sf/core";
import { storeText, type StoreText } from "@/lib/store-text";
import Link from "next/link";
import { SearchSuggest } from "./SearchSuggest";

export type BrowseParams = { q?: string; sort?: string; min?: string; max?: string; stock?: string; sale?: string; opt?: string | string[]; page?: string };

/** "12" or "12.50" in the buyer's currency, as minor units; anything else means no limit. */
export const priceParam = (raw?: string) => {
  const n = Number((raw ?? "").replace(/[^\d.]/g, ""));
  return raw && raw.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

/** Chosen options from the address, sent as opt=Size:M&opt=Color:Black. */
export function optionParams(raw: BrowseParams["opt"]) {
  const out: Record<string, string[]> = {};
  for (const item of (Array.isArray(raw) ? raw : raw ? [raw] : []).slice(0, 40)) {
    const i = item.indexOf(":");
    if (i <= 0) continue;
    const name = item.slice(0, i).trim().slice(0, 40);
    const value = item.slice(i + 1).trim().slice(0, 60);
    if (name && value) (out[name] ??= []).push(value);
  }
  return out;
}

export function browseOptions(p: BrowseParams) {
  return { q: p.q?.slice(0, 200), sort: p.sort, minMinor: priceParam(p.min), maxMinor: priceParam(p.max), inStock: p.stock === "1", onSale: p.sale === "1", options: optionParams(p.opt) };
}

/**
 * Sort and filter controls for the search and collection pages. A plain GET form, so it works
 * before any script loads and every result page has its own shareable address.
 */
export function BrowseBar({ action, params, sort, natural: naturalSort = "featured", currency, search, count, facets = [], t = storeText(null) }: { action: string; params: BrowseParams; sort: Sort; natural?: Sort; currency: string; search?: boolean; count: number; facets?: Facet[]; t?: StoreText }) {
  const chosen = optionParams(params.opt);
  const isChosen = (name: string, value: string) => Object.entries(chosen).some(([n, vs]) => n.toLowerCase() === name.toLowerCase() && vs.includes(value));
  // The first choice is the page's natural order, sent as no sort at all, so a new search goes
  // back to best match instead of keeping the last page's order. A collection's natural order is
  // the one its merchant picked; "Featured" is then a choice of its own.
  const q = params.q?.trim();
  const natural = search ? (q ? t.sorts.relevance : t.sorts.newest) : t.sorts[naturalSort];
  const sorts = search
    ? (["best_selling", "price_asc", "price_desc", "newest"] as const).filter((s) => !(!q && s === "newest"))
    : (["featured", "best_selling", "price_asc", "price_desc", "newest"] as const).filter((s) => s !== naturalSort);
  return (
    <form action={action} method="get" role="search" aria-label={search ? t.searchStore : t.sortAndFilter} className="flex flex-col gap-4">
      {search && (
        <div className="flex gap-2">
          <SearchSuggest
            suggestUrl={`${action}/suggest`}
            defaultValue={params.q ?? ""}
            placeholder={t.searchProducts}
            autoFocus={!params.q}
            labels={{ search: t.search, suggestions: t.suggestions, soldOut: t.soldOut, seeAll: t.seeAllResults("%s") }}
          />
          <button className="btn btn-primary">{t.search}</button>
        </div>
      )}
      {!search && params.q && <input type="hidden" name="q" value={params.q} />}
      {facets.length > 0 && (
        <div className="flex flex-wrap gap-3 text-sm">
          {facets.map((f) => {
            const picked = f.values.filter((v) => isChosen(f.name, v.value)).length;
            return (
              <details key={f.name} className="card px-3 py-2" open={picked > 0}>
                <summary className="cursor-pointer font-medium">{f.name}{picked > 0 ? ` (${picked})` : ""}</summary>
                <fieldset className="flex flex-wrap gap-x-4 gap-y-2 pt-2">
                  <legend className="sr-only">{f.name}</legend>
                  {f.values.map((v) => (
                    <label key={v.value} className="flex items-center gap-2">
                      <input type="checkbox" name="opt" value={`${f.name}:${v.value}`} defaultChecked={isChosen(f.name, v.value)} /> {v.value} <span className="hint">({v.count})</span>
                    </label>
                  ))}
                </fieldset>
              </details>
            );
          })}
        </div>
      )}
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
        <label className="flex items-center gap-2 pb-2.5">
          <input type="checkbox" name="sale" value="1" defaultChecked={params.sale === "1"} /> {t.onSaleOnly}
        </label>
        <button className="btn btn-secondary">{t.apply}</button>
        <span className="hint pb-2.5 ml-auto" role="status">{t.productCount(count)}</span>
      </div>
    </form>
  );
}

/**
 * Under a long grid: how many products are showing, and a link that shows the next lot on the same
 * page, landing on the first new product. Filters and sorting keep their place in the address.
 */
export function ShowMore({ action, params, page, shown, total, t = storeText(null) }: { action: string; params: BrowseParams; page: number; shown: number; total: number; t?: StoreText }) {
  if (page === 1 && shown >= total) return null;
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k === "page" || v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) next.append(k, one);
  }
  next.set("page", String(page + 1));
  return (
    <div className="flex flex-col items-center gap-3">
      <p className="hint" role="status">{t.showingOf(shown, total)}</p>
      {shown < total && <Link href={`${action}?${next.toString()}#item-${shown + 1}`} className="btn btn-secondary">{t.showMore}</Link>}
    </div>
  );
}
