"use client";
import { useActionState } from "react";
import { stayAfterAddAction, type BadgeState } from "../../badge-actions";

/** Whether "Add to cart" opens the cart or keeps the shopper where they were. */
export function AfterAddForm({ stay }: { stay: boolean }) {
  const [state, action, pending] = useActionState(stayAfterAddAction, {} as BadgeState);
  return (
    <form action={action} className="flex flex-col gap-3">
      {state.saved && !pending && <p className="banner banner-success" role="status">Saved. &ldquo;Add to cart&rdquo; in your store follows it now.</p>}
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="sr-only">After a shopper adds to the cart</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="afterAdd" value="cart" defaultChecked={!stay} />
          Open the cart
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="afterAdd" value="stay" defaultChecked={stay} />
          Stay on the page and show a note with the cart and checkout
        </label>
      </fieldset>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save cart setting"}</button>
      </div>
    </form>
  );
}
