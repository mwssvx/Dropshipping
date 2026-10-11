"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { soldOutAction, type BadgeState } from "../../badge-actions";

const CHOICES = [
  { value: "last", label: "After everything that can be bought", hint: "Shoppers see what they can order first." },
  { value: "show", label: "Where they are", hint: "Your own order, sold out or not." },
  { value: "hide", label: "Hidden", hint: "Left out until they're back in stock." },
] as const;

/** Where sold-out products go in collections, search and the home page. */
export function SoldOutForm({ value }: { value: string }) {
  const [state, action, pending] = useActionState(soldOutAction, {} as BadgeState);
  return (
    // Submitted by hand so React doesn't reset the choice after an error.
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved && !pending && !state.error && <p className="banner banner-success" role="status">Saved. Your store&apos;s lists follow it now.</p>}
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Sold-out products go</legend>
        {CHOICES.map((c) => (
          <label key={c.value} className="flex items-start gap-2 text-sm">
            <input type="radio" name="soldOut" value={c.value} defaultChecked={value === c.value} className="mt-1" />
            <span>
              {c.label}
              <span className="hint block">{c.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save sold-out setting"}</button>
      </div>
    </form>
  );
}
