"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "../../actions";

type Values = {
  title: string;
  description: string;
  imageUrl: string;
  status: "draft" | "active" | "archived";
  price: string;
  compareAt: string;
  cost: string;
};

const toNumber = (s: string) => {
  const n = Number(s.replace(/[,\s$]/g, ""));
  return Number.isFinite(n) && s.trim() !== "" ? n : null;
};

export function ProductForm({
  action,
  initial,
  currency,
  submitLabel,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  initial: Values;
  currency: string;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const [price, setPrice] = useState(initial.price);
  const [cost, setCost] = useState(initial.cost);
  const p = toNumber(price);
  const c = toNumber(cost);
  const margin = p && c !== null && p > 0 ? Math.round(((p - c) / p) * 100) : null;
  const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency });

  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-[1fr_300px] items-start">
      <div className="flex flex-col gap-6 min-w-0">
        <FormError message={state.error} />
        {state.saved && <p role="status" className="banner banner-info">Saved.</p>}
        <section className="card p-5 flex flex-col gap-4">
          <div className="field">
            <label className="label" htmlFor="title">Title</label>
            <input className="input" id="title" name="title" required maxLength={200} defaultValue={initial.title} placeholder="Sunset projection lamp" />
          </div>
          <div className="field">
            <label className="label" htmlFor="description">Description</label>
            <textarea className="input" id="description" name="description" rows={6} defaultValue={initial.description}
              placeholder="What it is, who it's for, and why it's worth it." />
          </div>
          <div className="field">
            <label className="label" htmlFor="imageUrl">Image address</label>
            <input className="input" id="imageUrl" name="imageUrl" type="url" defaultValue={initial.imageUrl} placeholder="https://…" />
            <span className="hint">Uploads and supplier images arrive with supplier import.</span>
          </div>
        </section>
        <section className="card p-5 flex flex-col gap-4">
          <h2 className="font-semibold">Pricing</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="field">
              <label className="label" htmlFor="price">Price</label>
              <input className="input num" id="price" name="price" inputMode="decimal" required value={price}
                onChange={(e) => setPrice(e.target.value)} placeholder="24.99" />
            </div>
            <div className="field">
              <label className="label" htmlFor="compareAt">Compare-at price</label>
              <input className="input num" id="compareAt" name="compareAt" inputMode="decimal" defaultValue={initial.compareAt} placeholder="Optional" />
            </div>
            <div className="field">
              <label className="label" htmlFor="cost">Your cost</label>
              <input className="input num" id="cost" name="cost" inputMode="decimal" value={cost}
                onChange={(e) => setCost(e.target.value)} placeholder="Supplier price" />
            </div>
          </div>
          <p className="hint num" aria-live="polite">
            {margin === null
              ? "Add your cost to see profit and margin."
              : <>Profit {fmt.format((p ?? 0) - (c ?? 0))} per sale · <span className={margin < 20 ? "text-critical font-semibold" : "text-success font-semibold"}>{margin}% margin</span></>}
          </p>
        </section>
      </div>
      <aside className="card p-5 flex flex-col gap-4 lg:sticky lg:top-6">
        <div className="field">
          <label className="label" htmlFor="status">Status</label>
          <select className="input" id="status" name="status" defaultValue={initial.status}>
            <option value="active">Active: buyers can see it</option>
            <option value="draft">Draft: hidden</option>
          </select>
        </div>
        <SubmitButton>{submitLabel}</SubmitButton>
      </aside>
    </form>
  );
}
