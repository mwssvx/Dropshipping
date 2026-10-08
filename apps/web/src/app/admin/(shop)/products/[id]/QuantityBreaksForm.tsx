"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "../../../actions";
import { quantityBreaksAction } from "../../../wholesale-actions";

const ROWS = 3;

export function QuantityBreaksForm({ productId, tiers }: { productId: string; tiers: { minQty: number; percentOff: number }[] }) {
  const [state, action] = useActionState(quantityBreaksAction.bind(null, productId), {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-success" role="status">Quantity discounts saved.</p>}
      <div className="flex flex-col gap-2">
        {Array.from({ length: ROWS }, (_, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <span>Buy</span>
            <input className="input num w-20" name="minQty" type="number" min={2} max={99} defaultValue={tiers[i]?.minQty ?? ""} aria-label={`Quantity ${i + 1}`} />
            <span>or more, save</span>
            <input className="input num w-20" name="percentOff" type="number" min={1} max={80} defaultValue={tiers[i]?.percentOff ?? ""} aria-label={`Percent off ${i + 1}`} />
            <span>%</span>
          </div>
        ))}
      </div>
      <SubmitButton className="btn btn-secondary self-start">Save quantity discounts</SubmitButton>
    </form>
  );
}
