"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { ProductStatus } from "@/components/Status";
import { bulkEditAction, undoBulkEditAction, type BulkState } from "../../bulk-actions";

export type BulkRow = { id: string; title: string; imageUrl: string | null; status: "draft" | "active" | "archived"; scheduled: boolean; price: string; margin: number | null };
export type RecentEdit = { id: string; summary: string; when: string; undone: boolean; canUndo: boolean };

const KINDS = [
  ["active", "Publish on the store"],
  ["draft", "Hide from the store (draft)"],
  ["archived", "Archive"],
  ["price", "Change prices by a percent"],
  ["compare_at", "Show a \"was\" price"],
  ["clear_compare_at", "Remove the \"was\" price"],
  ["add", "Add to a collection"],
  ["remove", "Take out of a collection"],
  ["add_tag", "Add a tag"],
  ["remove_tag", "Remove a tag"],
  ["ships_from", "Set where they ship from"],
] as const;
type Kind = (typeof KINDS)[number][0];

export function BulkProducts({ rows, collections, tags = [], recent, total = rows.length, list = {}, maxAll = 500, home = "US" }: {
  rows: BulkRow[];
  collections: { id: string; title: string }[];
  tags?: string[];
  recent: RecentEdit[];
  /** How many products the list holds across all its pages, and its search and filters. */
  total?: number;
  list?: Record<string, string>;
  maxAll?: number;
  /** The store's country, which an empty Ships from means. */
  home?: string;
}) {
  const [state, action] = useActionState(bulkEditAction, {} as BulkState);
  // Controlled, because React clears a form's own fields after each submit.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<Kind>("price");
  const [percent, setPercent] = useState("10");
  const [ending, setEnding] = useState("none");
  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? "");
  const [tag, setTag] = useState("");
  const [country, setCountry] = useState("");
  const [belowCost, setBelowCost] = useState(false);
  // Every product in the list, on every page, rather than the ones ticked here.
  const [everything, setEverything] = useState(false);
  const toggle = (id: string) => {
    setEverything(false);
    setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const all = picked.size === rows.length && rows.length > 0;
  const count = everything ? total : picked.size;
  // A preview is for the products and change it was made from; touching either asks again.
  const key = JSON.stringify([everything ? "all" : [...picked].sort(), kind, percent, ending, collectionId, tag, country]);
  const preview = state.preview && state.key === key ? state.preview : null;
  const needsCollection = kind === "add" || kind === "remove";

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        {everything ? (
          <>
            <input type="hidden" name="all" value="1" />
            {Object.entries(list).map(([k, v]) => <input key={k} type="hidden" name={`list.${k}`} value={v} />)}
          </>
        ) : (
          [...picked].map((id) => <input key={id} type="hidden" name="ids" value={id} />)
        )}
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="percent" value={percent} />
        <input type="hidden" name="ending" value={ending} />
        <input type="hidden" name="collectionId" value={collectionId} />
        <input type="hidden" name="tag" value={tag} />
        <input type="hidden" name="country" value={country} />
        <input type="hidden" name="key" value={key} />
        {belowCost && <input type="hidden" name="belowCost" value="on" />}
        {state.done && (
          <p className="banner banner-success" role="status">{state.done}.</p>
        )}
        {picked.size > 0 && (
          <section className="card p-4 flex flex-col gap-3" aria-label="Change selected products">
            <div className="flex flex-wrap items-end gap-3">
              <p className="font-medium self-center">{count === 1 ? "1 product selected" : `${count.toLocaleString("en-US")} products selected`}</p>
              <div className="field">
                <label className="label" htmlFor="bulk-kind">Change</label>
                <select className="input" id="bulk-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                  {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              {(kind === "price" || kind === "compare_at") && (
                <div className="field">
                  <label className="label" htmlFor="bulk-percent">{kind === "price" ? "By percent (minus to lower)" : "Percent above the price"}</label>
                  <input className="input w-28 num" id="bulk-percent" inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value)} />
                </div>
              )}
              {kind === "price" && (
                <div className="field">
                  <label className="label" htmlFor="bulk-ending">Round to</label>
                  <select className="input" id="bulk-ending" value={ending} onChange={(e) => setEnding(e.target.value)}>
                    <option value="none">Don&apos;t round</option>
                    <option value="99">.99</option>
                    <option value="95">.95</option>
                    <option value="00">Whole amounts</option>
                  </select>
                </div>
              )}
              {needsCollection && (
                collections.length ? (
                  <div className="field">
                    <label className="label" htmlFor="bulk-collection">Collection</label>
                    <select className="input" id="bulk-collection" value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
                      {collections.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                  </div>
                ) : (
                  <p className="hint self-center">No collections yet. <Link href="/admin/collections/new" className="underline">Make one</Link>.</p>
                )
              )}
              {(kind === "add_tag" || kind === "remove_tag") && (
                <div className="field">
                  <label className="label" htmlFor="bulk-tag">Tag</label>
                  <input className="input w-40" id="bulk-tag" list="bulk-tags" value={tag} maxLength={30} onChange={(e) => setTag(e.target.value)} placeholder="summer" />
                  <datalist id="bulk-tags">{tags.map((t) => <option key={t} value={t} />)}</datalist>
                </div>
              )}
              {kind === "ships_from" && (
                <div className="field">
                  <label className="label" htmlFor="bulk-country">Ships from (country code)</label>
                  <input className="input w-40 uppercase" id="bulk-country" value={country} maxLength={2} onChange={(e) => setCountry(e.target.value)} placeholder={home} aria-describedby="bulk-country-hint" />
                  <span className="hint text-sm" id="bulk-country-hint">Empty for {home}, your store&apos;s country.</span>
                </div>
              )}
              <button type="submit" className="btn btn-secondary" name="intent" value="preview">Preview</button>
            </div>
            {all && total > rows.length && (
              <p className="text-sm" role="note">
                {everything ? (
                  <>All {total.toLocaleString("en-US")} products in this list are selected, on every page.{" "}
                    <button type="button" className="underline" onClick={() => setEverything(false)}>Just the {rows.length} on this page</button></>
                ) : total <= maxAll ? (
                  <>All {rows.length} on this page are selected.{" "}
                    <button type="button" className="underline" onClick={() => setEverything(true)}>Select all {total.toLocaleString("en-US")} in this list</button></>
                ) : (
                  <span className="hint">All {rows.length} on this page are selected. A change can cover up to {maxAll} products, so narrow the list with a search or filter to change all {total.toLocaleString("en-US")}.</span>
                )}
              </p>
            )}
            <FormError message={state.key === key ? state.error : undefined} />
            {preview && (
              <div className="flex flex-col gap-3">
                {preview.changes.length === 0 ? (
                  <p className="hint">{preview.full > 0 ? "Nothing to change: those products already have that tag or 20 tags." : "Nothing to change: those products already look like that."}</p>
                ) : (
                  <>
                    <div className="overflow-x-auto max-h-72">
                      <table className="table min-w-[480px]" aria-label="What will change">
                        <thead><tr><th>Product</th><th>Now</th><th>After</th></tr></thead>
                        <tbody>
                          {preview.changes.slice(0, 50).map((c, i) => (
                            <tr key={i}>
                              <td>{c.product}{c.variant && c.variant !== "Default" ? <span className="hint"> · {c.variant}</span> : null}</td>
                              <td className="num">{c.before || <span className="hint">—</span>}</td>
                              <td className="num">{c.after || <span className="hint">—</span>}{c.belowCost && <span className="pill pill-critical ml-2">Below cost</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {preview.changes.length > 50 && <p className="hint">And {preview.changes.length - 50} more.</p>}
                    {preview.skipped > 0 && <p className="hint">Gift cards keep their prices ({preview.skipped} skipped).</p>}
                    {preview.full > 0 && <p className="hint">{preview.full === 1 ? "1 product already has" : `${preview.full} products already have`} 20 tags, so {preview.full === 1 ? "it was" : "they were"} left out.</p>}
                    {preview.belowCost > 0 && (
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={belowCost} onChange={(e) => setBelowCost(e.target.checked)} /> Sell below cost ({preview.belowCost === 1 ? "1 option" : `${preview.belowCost} options`})
                      </label>
                    )}
                    <button type="submit" className="btn btn-primary self-start" name="intent" value="apply">
                      Apply to {preview.products === 1 ? "1 product" : `${preview.products} products`}
                    </button>
                    <p className="hint">You can undo this for 7 days.</p>
                  </>
                )}
              </div>
            )}
          </section>
        )}
      </form>

      <div className="card overflow-x-auto">
        <table className="table min-w-[600px]">
          <thead>
            <tr>
              <th className="w-10">
                <input type="checkbox" aria-label="Select all products" checked={all} onChange={() => { setEverything(false); setPicked(all ? new Set() : new Set(rows.map((r) => r.id))); }} />
              </th>
              <th>Product</th><th>Status</th><th className="text-right">Price</th><th className="text-right">Margin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-sunken">
                <td><input type="checkbox" aria-label={`Select ${p.title}`} checked={picked.has(p.id)} onChange={() => toggle(p.id)} /></td>
                <td>
                  <Link href={`/admin/products/${p.id}`} className="flex items-center gap-3 font-medium">
                    {p.imageUrl ? <img src={p.imageUrl} alt="" className="size-10 rounded-md object-cover bg-sunken" /> : <span className="size-10 rounded-md bg-sunken" />}
                    {p.title}
                  </Link>
                </td>
                <td><ProductStatus value={p.scheduled ? "scheduled" : p.status} /></td>
                <td className="text-right num">{p.price}</td>
                <td className="text-right num">{p.margin === null ? <span className="hint">—</span> : `${p.margin}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {recent.length > 0 && (
        <section className="card p-4 flex flex-col gap-2" aria-labelledby="recent-changes">
          <h2 id="recent-changes" className="font-semibold">Recent changes</h2>
          <ul className="flex flex-col gap-2">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span>{r.summary}</span>
                <span className="hint">{r.when}</span>
                {r.undone ? <span className="pill pill-neutral">Undone</span> : r.canUndo ? <UndoButton id={r.id} summary={r.summary} /> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function UndoButton({ id, summary }: { id: string; summary: string }) {
  const [state, action] = useActionState(undoBulkEditAction.bind(null, id), {} as BulkState);
  return (
    <form action={action} className="flex items-center gap-2">
      <button type="submit" className="btn btn-secondary btn-sm" aria-label={`Undo: ${summary}`}>Undo</button>
      {state.error && <span className="hint" role="alert">{state.error}</span>}
      {state.done && <span className="hint" role="status">{state.done}.</span>}
    </form>
  );
}
