"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { lowestPriceAction, type SaleState } from "../../sale-actions";

const CHOICES = [
  { value: "eu", label: "Visitors in Europe", hint: "Where the law asks for it: the EU, the rest of the EEA, the UK and Switzerland." },
  { value: "everyone", label: "Everyone", hint: "Honest pricing builds trust anywhere." },
  { value: "off", label: "Nobody", hint: "Only if you don't sell to Europe." },
] as const;

/** Who sees the lowest price of the 30 days before a discount. */
export function LowestPriceForm({ value }: { value: string }) {
  const [state, action, pending] = useActionState(lowestPriceAction, {} as SaleState);
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
      {state.message && !pending && !state.error && <p className="banner banner-success" role="status">Saved. Product pages follow it now.</p>}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium mb-1">Show it to</legend>
        {CHOICES.map((c) => (
          <label key={c.value} className="flex items-start gap-2 text-sm">
            <input type="radio" name="note" value={c.value} defaultChecked={value === c.value} className="mt-1" />
            <span>
              {c.label}
              <span className="hint block">{c.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}
