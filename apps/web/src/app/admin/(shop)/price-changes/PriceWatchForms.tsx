"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { resolveCostChangeAction, setPriceWatchAction, simulateCostRiseAction, type PriceWatchState } from "../../price-watch-actions";

/** Submitted by hand so React doesn't reset the fields (and the checkbox) after an error. */
export function PriceWatchSettings({ minMarginPercent, autoReprice }: { minMarginPercent: number; autoReprice: boolean }) {
  const [state, action, pending] = useActionState(setPriceWatchAction, {} as PriceWatchState);
  const [margin, setMargin] = useState(String(minMarginPercent));
  const [auto, setAuto] = useState(autoReprice);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.done && !pending && <p className="banner banner-success" role="status">{state.done}</p>}
      <div className="field w-48">
        <label className="label" htmlFor="minMargin">Warn me below this margin (%)</label>
        <input className="input num" id="minMargin" name="minMarginPercent" inputMode="numeric" value={margin} onChange={(e) => setMargin(e.target.value)} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="autoReprice" className="mt-1" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        <span>
          Raise prices automatically with my pricing rule
          <span className="block hint">Prices only ever go up this way, and we email you each time. They never go down on their own.</span>
        </span>
      </label>
      <div><button className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save price watch"}</button></div>
    </form>
  );
}

export function ChangeActions({ id, raiseLabel }: { id: string; raiseLabel: string | null }) {
  const [raised, raise, raising] = useActionState(resolveCostChangeAction.bind(null, id, "raise"), {} as PriceWatchState);
  const [kept, keep, keeping] = useActionState(resolveCostChangeAction.bind(null, id, "keep"), {} as PriceWatchState);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FormError message={raised.error ?? kept.error} />
      {raiseLabel && <form action={raise}><button className="btn btn-primary btn-sm" disabled={raising || keeping}>{raiseLabel}</button></form>}
      <form action={keep}><button className="btn btn-secondary btn-sm" disabled={raising || keeping}>Keep price</button></form>
    </div>
  );
}

/** Test mode: the supplier of a product starts charging 90% of its price. */
export function SimulateRise({ products }: { products: { id: string; title: string }[] }) {
  const [state, action, pending] = useActionState(simulateCostRiseAction, {} as PriceWatchState);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <FormError message={state.error} />
      <div className="field">
        <label className="label" htmlFor="sim-product">Product</label>
        <select className="input" id="sim-product" name="productId">
          {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      </div>
      <button className="btn btn-secondary" disabled={pending}>{pending ? "Raising…" : "Simulate a supplier price rise"}</button>
    </form>
  );
}
