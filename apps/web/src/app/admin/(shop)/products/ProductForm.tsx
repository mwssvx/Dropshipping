"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "../../actions";

export type VariantValues = { title: string; price: string; compareAt: string; cost: string; stock?: number | null; fromSupplier?: boolean };

type Values = {
  title: string;
  description: string;
  /** Only when adding a product; after that, photos have their own editor. */
  imageUrl?: string;
  status: "draft" | "active" | "archived";
  variants: VariantValues[];
  /** Shown when the product came from a supplier. */
  supplier?: { label: string; sourceUrl: string | null };
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
  const many = initial.variants.length > 1;

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
          {initial.imageUrl !== undefined && (
            <div className="field">
              <label className="label" htmlFor="imageUrl">Photo address</label>
              <input className="input" id="imageUrl" name="imageUrl" type="url" defaultValue={initial.imageUrl} placeholder="https://…" />
              <span className="hint">You can upload more photos once the product is added.</span>
            </div>
          )}
        </section>
        <section className="card p-5 flex flex-col gap-4">
          <div className="flex justify-between gap-3 flex-wrap items-baseline">
            <h2 className="font-semibold">{many ? "Options and pricing" : "Pricing"}</h2>
            {initial.supplier && (
              <span className="hint">
                From {initial.supplier.label}
                {initial.supplier.sourceUrl && <> · <a className="underline hover:text-ink" href={initial.supplier.sourceUrl} target="_blank" rel="noreferrer">listing ↗</a></>}
              </span>
            )}
          </div>
          {initial.variants.map((v, i) => (
            <VariantRow key={i} index={i} initial={v} currency={currency} showTitle={many} />
          ))}
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

function VariantRow({ index, initial, currency, showTitle }: { index: number; initial: VariantValues; currency: string; showTitle: boolean }) {
  const [price, setPrice] = useState(initial.price);
  const [cost, setCost] = useState(initial.cost);
  const p = toNumber(price);
  const c = toNumber(cost);
  const margin = p && c !== null && p > 0 ? Math.round(((p - c) / p) * 100) : null;
  const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency });
  const id = (k: string) => `${k}-${index}`;
  return (
    <fieldset className={`flex flex-col gap-3 ${showTitle ? "border-t border-border pt-4 first-of-type:border-0 first-of-type:pt-0" : ""}`}>
      {showTitle ? (
        <div className="field">
          <label className="label" htmlFor={id("variantTitle")}>Option name</label>
          <input className="input" id={id("variantTitle")} name={`variantTitle.${index}`} required defaultValue={initial.title} />
        </div>
      ) : (
        <input type="hidden" name={`variantTitle.${index}`} value={initial.title || "Default"} />
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="field">
          <label className="label" htmlFor={id("price")}>Price</label>
          <input className="input num" id={id("price")} name={`price.${index}`} inputMode="decimal" required value={price}
            onChange={(e) => setPrice(e.target.value)} placeholder="24.99" />
        </div>
        <div className="field">
          <label className="label" htmlFor={id("compareAt")}>Compare-at price</label>
          <input className="input num" id={id("compareAt")} name={`compareAt.${index}`} inputMode="decimal" defaultValue={initial.compareAt} placeholder="Optional" />
        </div>
        <div className="field">
          <label className="label" htmlFor={id("cost")}>Your cost</label>
          <input className="input num" id={id("cost")} name={`cost.${index}`} inputMode="decimal" value={cost}
            onChange={(e) => setCost(e.target.value)} placeholder="Supplier price" />
        </div>
        <div className="field">
          <label className="label" htmlFor={id("stock")}>Stock</label>
          <input className="input num" id={id("stock")} name={`stock.${index}`} inputMode="numeric" defaultValue={initial.stock ?? ""} placeholder="Not tracked" />
        </div>
      </div>
      <p className="hint num" aria-live="polite">
        {margin === null
          ? "Add your cost to see profit and margin."
          : <>Profit {fmt.format((p ?? 0) - (c ?? 0))} per sale · <span className={margin < 20 ? "text-critical font-semibold" : "text-success font-semibold"}>{margin}% margin</span></>}
        {initial.fromSupplier && <> · Stock and cost follow the supplier daily</>}
      </p>
    </fieldset>
  );
}
