"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";

export type OrderEditState = { error?: string; message?: string };
type Address = { name: string; line1: string; line2?: string; city: string; region?: string; postalCode: string; country: string };
type Line = { id: string; title: string; quantity: number; variantId: string | null; choices: { variantId: string; title: string }[] };

/**
 * Change the delivery address, or another size of an item at the same price, before the order
 * ships. Used on the admin order page and on the buyer's order page.
 */
export function OrderEditForm({ action, address, lines, countryName, summary, note }: {
  action: (state: OrderEditState, form: FormData) => Promise<OrderEditState>;
  address: Address;
  lines: Line[];
  countryName: string;
  summary: string;
  note?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const swappable = lines.filter((l) => l.choices.length > 1);
  const field = (name: keyof Address, label: string, required = true) => (
    <div className="field">
      <label className="label" htmlFor={`edit-${name}`}>{label}</label>
      <input className="input" id={`edit-${name}`} name={name} defaultValue={address[name] ?? ""} required={required} autoComplete="off" />
    </div>
  );
  return (
    <details className="group" open={!!state.error}>
      <summary className="cursor-pointer font-medium">{summary}</summary>
      {/* Remount after a save so the fields show what was saved. */}
      <form action={formAction} key={state.message ?? ""} className="flex flex-col gap-4 pt-4">
        {note && <p className="hint text-sm">{note}</p>}
        <FormError message={state.error} />
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="label mb-2">Deliver to</legend>
          {field("name", "Name")}
          {field("line1", "Street address")}
          {field("line2", "Apartment, suite (optional)", false)}
          {field("city", "City")}
          {field("region", "State or region (optional)", false)}
          {field("postalCode", "Postal code")}
          <p className="hint text-sm sm:col-span-2">In {countryName}. To send it to another country, the order has to be cancelled and placed again.</p>
        </fieldset>
        {swappable.length > 0 && (
          <fieldset className="flex flex-col gap-3">
            <legend className="label mb-2">Items</legend>
            {swappable.map((l) => (
              <div key={l.id} className="field">
                <label className="label" htmlFor={`edit-line-${l.id}`}>{l.title}{l.quantity > 1 ? ` × ${l.quantity}` : ""}</label>
                <select className="input" id={`edit-line-${l.id}`} name={`line:${l.id}`} defaultValue={l.variantId ?? ""}>
                  {l.choices.map((c) => <option key={c.variantId} value={c.variantId}>{c.title}</option>)}
                </select>
              </div>
            ))}
          </fieldset>
        )}
        <SubmitButton className="btn btn-primary self-start" pendingText="Saving…">Save changes</SubmitButton>
      </form>
      {state.message && <p role="status" className="banner banner-info mt-3">{state.message}</p>}
    </details>
  );
}

