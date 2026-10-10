"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { draftSizeChartAction } from "../../size-chart-actions";

export function DraftForm({ products }: { products: { id: string; title: string }[] }) {
  const [state, action] = useActionState(draftSizeChartAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="field flex-1 min-w-56">
          <label className="label" htmlFor="draftProduct">Product</label>
          <select className="input" id="draftProduct" name="productId" required defaultValue="">
            <option value="" disabled>Pick a product</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
        <SubmitButton pendingText="Drafting…">Draft with AI</SubmitButton>
      </div>
    </form>
  );
}
