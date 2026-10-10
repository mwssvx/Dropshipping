"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { addAdSpendAction, type AdSpendState } from "../../profit-actions";

export function AdSpendForm({ today, channels, products, symbol }: { today: string; channels: { value: string; label: string }[]; products: { id: string; title: string }[]; symbol: string }) {
  const [state, action] = useActionState(addAdSpendAction, {} as AdSpendState);
  const v = state.values ?? { day: today, channel: channels[0]!.value, amount: "", productId: "", note: "" };
  return (
    // Keyed by what was last sent, so the fields show it again after the action.
    <form key={JSON.stringify(state)} action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-success" role="status">Ad spend added.</p>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="field">
          <label className="label" htmlFor="ad-day">Day</label>
          <input className="input" type="date" id="ad-day" name="day" defaultValue={v.day} max={today} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="ad-channel">Where</label>
          <select className="input" id="ad-channel" name="channel" defaultValue={v.channel}>
            {channels.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="ad-amount">Amount spent ({symbol})</label>
          <input className="input num" id="ad-amount" name="amount" inputMode="decimal" placeholder="25.00" defaultValue={v.amount} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="ad-product">For product</label>
          <select className="input" id="ad-product" name="productId" defaultValue={v.productId}>
            <option value="">Whole store</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="ad-note">Note (optional)</label>
        <input className="input" id="ad-note" name="note" maxLength={200} placeholder="Summer lamp campaign" defaultValue={v.note} />
      </div>
      <SubmitButton className="btn btn-primary self-start">Add ad spend</SubmitButton>
    </form>
  );
}
