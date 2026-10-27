"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { cancelRestockAction, createRestockAction, emailRestockAction, receiveRestockAction, type RestockState } from "../../restock-actions";

type Choice = { variantId: string; title: string; sku: string | null; stock: number | null; cost: string; suggested?: number };

// Submitted by hand so React doesn't empty what was typed when saving fails.
const submitWith = (action: (data: FormData) => void) => (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const data = new FormData(e.currentTarget);
  startTransition(() => action(data));
};

/** Who it's from, when it should come, and how many of each option at what cost. */
export function NewRestockForm({ choices, currencySymbol }: { choices: Choice[]; currencySymbol: string }) {
  const [state, action, pending] = useActionState(createRestockAction, {} as RestockState);
  return (
    <form className="flex flex-col gap-5" onSubmit={submitWith(action)}>
      <FormError message={state.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="field">
          <label className="label" htmlFor="supplierName">Ordered from</label>
          <input className="input" id="supplierName" name="supplierName" required maxLength={100} placeholder="Your supplier's name" />
        </div>
        <div className="field">
          <label className="label" htmlFor="supplierEmail">Supplier&apos;s email (optional)</label>
          <input className="input" id="supplierEmail" name="supplierEmail" type="email" maxLength={200} placeholder="To email them the order" />
        </div>
        <div className="field">
          <label className="label" htmlFor="expectedOn">Expected by (optional)</label>
          <input className="input" id="expectedOn" name="expectedOn" type="date" />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="note">Note (optional)</label>
        <textarea className="input" id="note" name="note" rows={2} maxLength={1000} placeholder="Their order number, tracking, anything to remember" />
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left hint">
              <th className="p-3 font-medium">Option</th>
              <th className="p-3 font-medium text-right">In stock</th>
              <th className="p-3 font-medium">Ordering</th>
              <th className="p-3 font-medium">Cost each ({currencySymbol})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {choices.map((c) => (
              <tr key={c.variantId}>
                <td className="p-3">{c.title}{c.sku && <span className="hint"> · {c.sku}</span>}</td>
                <td className="p-3 num text-right">{c.stock ?? "Not tracked"}</td>
                <td className="p-3"><input className="input num w-24" name={`qty.${c.variantId}`} inputMode="numeric" aria-label={`How many ${c.title}`} placeholder="0" defaultValue={c.suggested || ""} /></td>
                <td className="p-3"><input className="input num w-28" name={`cost.${c.variantId}`} inputMode="decimal" aria-label={`Cost of each ${c.title}`} defaultValue={c.cost} placeholder="Optional" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="submit" className="btn btn-primary self-start" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save restock order"}</button>
    </form>
  );
}

type Line = { id: string; title: string; quantity: number; receivedQuantity: number };

/** What arrived, line by line: everything still to come is filled in. */
export function ReceiveForm({ restockId, lines }: { restockId: string; lines: Line[] }) {
  const [state, action, pending] = useActionState(receiveRestockAction.bind(null, restockId), {} as RestockState);
  const open = lines.filter((l) => l.receivedQuantity < l.quantity);
  return (
    <form className="flex flex-col gap-3" onSubmit={submitWith(action)}>
      <FormError message={state.error} />
      {state.message && !pending && <p className="banner banner-success" role="status">{state.message}</p>}
      <ul className="flex flex-col gap-2">
        {open.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex-1 min-w-0" htmlFor={`recv-${l.id}`}>{l.title} <span className="hint num">· {l.quantity - l.receivedQuantity} to come</span></label>
            {/* Keyed by what's arrived so the box refills with what's left after each delivery. */}
            <input key={l.receivedQuantity} className="input num w-24" id={`recv-${l.id}`} name={`recv.${l.id}`} inputMode="numeric" defaultValue={l.quantity - l.receivedQuantity} aria-label={`${l.title} arrived`} />
          </li>
        ))}
      </ul>
      <button type="submit" className="btn btn-primary self-start" disabled={pending} aria-busy={pending}>{pending ? "Adding…" : "Add to stock"}</button>
    </form>
  );
}

export function CancelRestockButton({ restockId }: { restockId: string }) {
  const [state, action, pending] = useActionState(cancelRestockAction.bind(null, restockId), {} as RestockState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormError message={state.error} />
      <button className="btn btn-secondary text-critical self-start" disabled={pending}>Cancel the rest of this order</button>
    </form>
  );
}

/** Sends the order to the supplier by email, as a purchase order. */
export function EmailRestockForm({ restockId, email }: { restockId: string; email: string | null }) {
  const [state, action, pending] = useActionState(emailRestockAction.bind(null, restockId), {} as RestockState);
  return (
    <form className="flex flex-col gap-3" onSubmit={submitWith(action)}>
      <FormError message={state.error} />
      {state.message && !pending && <p className="banner banner-success" role="status">{state.message}</p>}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="field flex-1 min-w-56">
          <label className="label" htmlFor="restock-to">Send to</label>
          <input className="input" id="restock-to" name="to" type="email" required maxLength={200} defaultValue={email ?? ""} placeholder="orders@supplier.com" />
        </div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Sending…" : "Email this order"}</button>
      </div>
    </form>
  );
}
