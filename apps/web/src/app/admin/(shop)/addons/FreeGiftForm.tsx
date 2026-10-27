"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { setFreeGiftAction, type FreeGiftState } from "../../addon-actions";

/** The free gift's switch, what's given and the order amount. Submitted by hand so React doesn't reset the fields after an error. */
export function FreeGiftForm({ gift, choices, min }: { gift: { variantId: string } | null; choices: { id: string; title: string }[]; min: string }) {
  const [state, action, pending] = useActionState(setFreeGiftAction, {} as FreeGiftState);
  const [on, setOn] = useState(gift !== null);
  return (
    <form
      className="flex flex-col gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved !== undefined && !pending && !state.error && (
        <p role="status" className="banner banner-success">{state.saved ? "Saved. Carts show how much more it takes, and the gift is added once they get there." : "Saved. Orders don't get a free gift."}</p>
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Give a free gift with bigger orders
      </label>
      {on && (
        <div className="grid sm:grid-cols-[1fr_10rem] gap-3">
          <div className="field">
            <label className="label" htmlFor="gift-variant">Gift to give</label>
            <select className="input" id="gift-variant" name="variantId" required defaultValue={gift?.variantId ?? ""}>
              <option value="" disabled>Pick a product</option>
              {choices.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="gift-min">For orders over</label>
            <input className="input num" id="gift-min" name="min" inputMode="decimal" required placeholder="75.00" defaultValue={min} />
          </div>
        </div>
      )}
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save free gift"}</button>
      </div>
    </form>
  );
}
