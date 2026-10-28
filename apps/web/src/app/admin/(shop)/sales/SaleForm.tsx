"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { createSaleAction, type SaleState } from "../../sale-actions";

/** A datetime-local value read in the merchant's own time zone, sent as an exact time. */
const iso = (local: string) => (local ? new Date(local).toISOString() : "");

/** A sale filled in from a date ahead (Black Friday): its name and local start and end times. */
export type SalePlan = { title: string; starts: string; ends: string };

type Props = { products: { id: string; title: string }[]; collections: { id: string; title: string }[]; plan?: SalePlan | null };

export function SaleForm(props: Props) {
  const [state, action] = useActionState(createSaleAction, {} as SaleState);
  // Filled in from a date ahead only until that sale is added.
  return <Fields key={state.key} state={state} action={action} {...props} plan={state.key ? null : props.plan} />;
}

function Fields({ state, action, products, collections, plan }: Props & { state: SaleState; action: (f: FormData) => void }) {
  const [scope, setScope] = useState("all");
  const [starts, setStarts] = useState(plan?.starts ?? "");
  const [ends, setEnds] = useState(plan?.ends ?? "");
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError message={state.error} />
      {state.message && <p role="status" className="banner banner-success">{state.message}</p>}
      <div className="grid sm:grid-cols-[1fr_10rem] gap-3">
        <div className="field">
          <label className="label" htmlFor="title">Name</label>
          <input className="input" id="title" name="title" maxLength={60} required placeholder="Summer sale" defaultValue={plan?.title} />
        </div>
        <div className="field">
          <label className="label" htmlFor="percentOff">Discount (%)</label>
          <input className="input num" id="percentOff" name="percentOff" type="number" min={1} max={90} required defaultValue={20} />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="scope">What&apos;s on sale</label>
        <select className="input" id="scope" name="scope" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">Everything (except gift cards)</option>
          <option value="collection" disabled={!collections.length}>One collection</option>
          <option value="products">Chosen products</option>
        </select>
      </div>
      {scope === "collection" && (
        <div className="field">
          <label className="label" htmlFor="collectionId">Collection</label>
          <select className="input" id="collectionId" name="collectionId" required defaultValue="">
            <option value="" disabled>Pick a collection</option>
            {collections.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </div>
      )}
      {scope === "products" && (
        <fieldset className="field">
          <legend className="label mb-1">Products</legend>
          <div className="max-h-56 overflow-y-auto border border-border rounded-md p-2 flex flex-col gap-1">
            {products.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="productIds" value={p.id} />
                <span>{p.title}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="field">
          <label className="label" htmlFor="startsLocal">Starts</label>
          <input className="input" id="startsLocal" type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
          <span className="hint">Leave it empty to start now.</span>
          <input type="hidden" name="startsAt" value={iso(starts)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="endsLocal">Ends</label>
          <input className="input" id="endsLocal" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
          <span className="hint">Leave it empty to run until you end it.</span>
          <input type="hidden" name="endsAt" value={iso(ends)} />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="countdown" disabled={!ends} aria-describedby="countdown-hint" /> Count down to the end on the store
        </label>
        <p id="countdown-hint" className="hint text-sm">In the last 7 days, product pages in the sale show the time left, and a sale on everything gets a banner across the store. It needs an end time, and the clock is the real one: prices go back when it reaches zero.</p>
      </div>
      <SubmitButton className="btn btn-primary self-start" pendingText="Saving…">Add sale</SubmitButton>
    </form>
  );
}
