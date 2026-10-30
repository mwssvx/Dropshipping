"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { planDailyDealsAction, type SaleState } from "../../sale-actions";

type Props = { products: { id: string; title: string }[]; today: string; firstFree: string; max: number };

export function DailyDealsForm(props: Props) {
  const [state, action] = useActionState(planDailyDealsAction, {} as SaleState);
  return <Fields key={state.key} state={state} action={action} {...props} />;
}

/** One product picker per day, in the order the deals run. */
function Fields({ state, action, products, today, firstFree, max }: Props & { state: SaleState; action: (f: FormData) => void }) {
  const [days, setDays] = useState(Math.min(3, max));
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError message={state.error} />
      {state.message && <p role="status" className="banner banner-success">{state.message}</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="field">
          <label className="label" htmlFor="dealStart">First deal on</label>
          <input className="input" id="dealStart" name="dealStart" type="date" min={today} defaultValue={firstFree} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="dealPercent">Price cut each day (%)</label>
          <input className="input num" id="dealPercent" name="dealPercent" type="number" min={1} max={90} required defaultValue={30} />
        </div>
      </div>
      <ol className="flex flex-col gap-2">
        {Array.from({ length: days }, (_, i) => (
          <li key={i} className="field">
            <label className="label" htmlFor={`deal-day-${i}`}>Day {i + 1}</label>
            <select className="input" id={`deal-day-${i}`} name="dealProductIds" defaultValue="">
              <option value="">Pick a product</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-3 items-center">
        {days < max && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDays((d) => d + 1)}>
            Add a day
          </button>
        )}
        <SubmitButton className="btn btn-primary" pendingText="Planning…">Plan the deals</SubmitButton>
      </div>
    </form>
  );
}
