"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { stockCountAction, type CountState } from "../../../inventory-actions";

type Option = { variantId: string; title: string; sku: string | null; stock: number | null };

export function StockCountForm({ options }: { options: Option[] }) {
  const [state, action, pending] = useActionState(stockCountAction, {} as CountState);
  return (
    // Submitted by hand so an error keeps what was typed; a new key after saving empties the boxes.
    <form
      key={state.key ?? "count"}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.message && <p className="banner banner-success" role="status">{state.message}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left hint">
              <th className="p-3 font-medium">Option</th>
              <th className="p-3 font-medium text-right">Expected</th>
              <th className="p-3 font-medium">Counted</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {options.map((o) => (
              <tr key={o.variantId}>
                <td className="p-3">{o.title}{o.sku && <span className="hint"> · {o.sku}</span>}</td>
                <td className="p-3 num text-right">{o.stock ?? "Not counted"}</td>
                <td className="p-3"><input className="input num w-24" name={`count.${o.variantId}`} inputMode="numeric" aria-label={`Counted ${o.title}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="submit" className="btn btn-primary self-start" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save count"}</button>
    </form>
  );
}
