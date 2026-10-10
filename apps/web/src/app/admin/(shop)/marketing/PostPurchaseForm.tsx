"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { setPostPurchaseOfferAction } from "../../growth-actions";

type Offer = { productId: string; percentOff: number; active: boolean } | null;

/** Controlled fields, so what the merchant picked stays after an error. */
export function PostPurchaseForm({ offer, products }: { offer: Offer; products: { id: string; title: string }[] }) {
  const [state, action] = useActionState(setPostPurchaseOfferAction, {});
  const [on, setOn] = useState(!!offer?.active);
  const [productId, setProductId] = useState(offer?.productId ?? "");
  const [percent, setPercent] = useState(String(offer?.percentOff ?? 15));
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      {state.saved && <p role="status" className="banner banner-info">{on ? "Saved. Buyers see it on their order page right after paying." : "Turned off."}</p>}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="on" checked={on} onChange={(e) => setOn(e.target.checked)} /> Offer one more product right after checkout
      </label>
      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <div className="field">
          <label className="label" htmlFor="ppProduct">Product to offer</label>
          <select className="input" id="ppProduct" name="productId" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Pick a product</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="ppPercent">Buyer saves (%)</label>
          <input className="input num" id="ppPercent" name="percentOff" inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value)} />
        </div>
      </div>
      <div><SubmitButton pendingText="Saving…">Save after-checkout offer</SubmitButton></div>
    </form>
  );
}
