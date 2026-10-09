"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { checkSupplierStockAction } from "../../../stock-actions";

/** Who's waiting for sold-out options, and a button to read the supplier's stock now. */
export function StockPanel({ productId, waiting, checkedAt, linked }: { productId: string; waiting: { option: string; count: number }[]; checkedAt: string | null; linked: boolean }) {
  const [state, action] = useActionState(checkSupplierStockAction.bind(null, productId), {});
  if (!linked && waiting.length === 0) return null;
  return (
    <form action={action} className="card p-4 flex flex-col gap-3" aria-label="Stock">
      {waiting.length > 0 && (
        <p className="banner banner-info">
          {waiting.map((w, i) => (
            <span key={i} className="block">
              {w.count === 1 ? "1 buyer is" : `${w.count} buyers are`} waiting for {w.option === "Default" ? "this" : w.option} to come back. They&apos;re emailed as soon as it has stock.
            </span>
          ))}
        </p>
      )}
      {linked && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm">
            <p className="font-medium">Supplier stock</p>
            <p className="hint">{checkedAt ? `Checked ${checkedAt}. It's checked again every day.` : "Checked every day, so you stop selling what they've run out of."}</p>
          </div>
          <SubmitButton className="btn btn-secondary" pendingText="Checking…">Check supplier now</SubmitButton>
        </div>
      )}
      <FormError message={state.error} />
      {state.message && <p className="banner banner-info" role="status">{state.message}</p>}
    </form>
  );
}
