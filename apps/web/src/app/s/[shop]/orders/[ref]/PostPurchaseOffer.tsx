"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { acceptPostPurchaseAction } from "../../actions";

type Option = { id: string; title: string; price: string; offer: string; charge: string };

/** One more product, added to the same card with one click, shown just after paying. */
export function PostPurchaseOffer({ handle, orderRef, title, imageUrl, percentOff, until, options }: {
  handle: string;
  orderRef: string;
  title: string;
  imageUrl: string | null;
  percentOff: number;
  until: string;
  options: Option[];
}) {
  const [state, action] = useActionState(acceptPostPurchaseAction.bind(null, handle, orderRef), {});
  const [variantId, setVariantId] = useState(options[0]!.id);
  const picked = options.find((o) => o.id === variantId) ?? options[0]!;
  return (
    <section className="card p-5 flex flex-col gap-3 border-accent" aria-labelledby="pp-heading">
      <p className="hint text-sm">Only on this page, until {until}</p>
      <div className="flex gap-4 items-start">
        {imageUrl && <img src={imageUrl} alt="" className="size-20 rounded object-cover shrink-0" />}
        <div className="flex flex-col gap-1">
          <h2 id="pp-heading" className="font-semibold text-lg">Add {title} for {percentOff}% off?</h2>
          <p className="num">
            {picked.price !== picked.offer && <s className="hint mr-2">{picked.price}</s>}
            <span className="font-semibold">{picked.offer}</span>
          </p>
        </div>
      </div>
      <form action={action} className="flex flex-col gap-3">
        <FormError message={state.error} />
        {options.length > 1 ? (
          <div className="field max-w-xs">
            <label className="label" htmlFor="pp-variant">Option</label>
            <select className="input" id="pp-variant" name="variantId" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
              {options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
            </select>
          </div>
        ) : (
          <input type="hidden" name="variantId" value={variantId} />
        )}
        <SubmitButton className="btn btn-primary self-start" pendingText="Adding…">Add to my order · {picked.charge}</SubmitButton>
        <p className="hint text-sm">Charged to the card you just used, with no extra shipping. It may arrive separately.</p>
      </form>
    </section>
  );
}
