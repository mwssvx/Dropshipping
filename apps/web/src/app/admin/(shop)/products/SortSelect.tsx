"use client";

const SORTS = [
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["title", "Title A to Z"],
  ["title_desc", "Title Z to A"],
  ["updated", "Recently changed"],
  ["price", "Price, low to high"],
  ["price_desc", "Price, high to low"],
] as const;

/** Sort for the product list. Part of the search form, so changing it keeps the search and filters. */
export function SortSelect({ value }: { value: string }) {
  return (
    <>
      <label className="sr-only" htmlFor="product-sort">Sort products</label>
      <select className="input w-auto" id="product-sort" name="sort" defaultValue={value} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
    </>
  );
}
