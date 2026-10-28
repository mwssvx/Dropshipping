"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { tagCustomersAction, type TagAllState } from "../../customer-actions";

/** Adds or removes one tag on every customer the list shows now, across all its pages. */
export function TagEveryoneForm({ count, q, tag, filter, country, code, product, tags }: { count: number; q?: string; tag?: string; filter?: string; country?: string; code?: string; product?: string; tags: string[] }) {
  const [state, action, pending] = useActionState(tagCustomersAction, {} as TagAllState);
  return (
    <form action={action} className="flex flex-col gap-2 mt-2">
      {q && <input type="hidden" name="q" value={q} />}
      {tag && <input type="hidden" name="listTag" value={tag} />}
      {filter && <input type="hidden" name="filter" value={filter} />}
      {country && <input type="hidden" name="country" value={country} />}
      {code && <input type="hidden" name="code" value={code} />}
      {product && <input type="hidden" name="product" value={product} />}
      <p className="hint">
        {count
          ? `Changes all ${count === 1 ? "1 customer" : `${count.toLocaleString("en-US")} customers`} in this list, on every page. Tag a group, then give them a code for tagged customers or an email campaign.`
          : "Nobody is in this list now."}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="field">
          <label className="label" htmlFor="tag-everyone">Tag for everyone here</label>
          <input className="input w-48" id="tag-everyone" name="tag" required maxLength={30} list="tag-everyone-tags" placeholder="vip" autoComplete="off" />
          <datalist id="tag-everyone-tags">{tags.map((t) => <option key={t} value={t} />)}</datalist>
        </div>
        <button className="btn btn-secondary" name="intent" value="add" disabled={pending}>Add tag</button>
        <button className="btn btn-secondary" name="intent" value="remove" disabled={pending}>Remove tag</button>
      </div>
      <FormError message={state.error} />
      {state.done && <p className="banner banner-success" role="status">{state.done}.</p>}
    </form>
  );
}
