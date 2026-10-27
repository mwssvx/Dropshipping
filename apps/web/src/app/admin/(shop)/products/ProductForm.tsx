"use client";
import { useActionState, useEffect, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "../../actions";

export type VariantValues = {
  /** Set for options that exist already, so saving edits them in place. */
  id?: string;
  title: string;
  options?: Record<string, string> | null;
  price: string;
  compareAt: string;
  cost: string;
  stock?: number | null;
  /** Grams, for shipping rates that go by weight. */
  weightGrams?: number | null;
  sku?: string | null;
  /** The UPC, EAN or the store's own code a scanner reads. */
  barcode?: string | null;
  fromSupplier?: boolean;
};

type OptionDraft = { name: string; values: string };
const MAX_OPTIONS = 3;
const MAX_VARIANTS = 100;

const splitValues = (raw: string) => [...new Set(raw.split(",").map((v) => v.trim()).filter(Boolean))];

/** Every combination of the options, like "Black / S", "Black / M", "White / S"… */
function combine(drafts: OptionDraft[]) {
  const defs = drafts.map((d) => ({ name: d.name.trim(), values: splitValues(d.values) })).filter((d) => d.name && d.values.length);
  let combos: Record<string, string>[] = [{}];
  for (const d of defs) combos = combos.flatMap((c) => d.values.map((v) => ({ ...c, [d.name]: v })));
  return defs.length ? combos.map((options) => ({ title: Object.values(options).join(" / "), options })) : [];
}

function draftsFrom(variants: VariantValues[]): OptionDraft[] {
  const defs: { name: string; values: string[] }[] = [];
  for (const v of variants) {
    // Saved options lose their order; the title ("Red / L") keeps it.
    const entries = Object.entries(v.options ?? {});
    const parts = v.title.split(" / ");
    if (parts.length === entries.length && entries.every(([, value]) => parts.includes(value))) {
      entries.sort((a, b) => parts.indexOf(a[1]) - parts.indexOf(b[1]));
    }
    for (const [name, value] of entries) {
      let d = defs.find((x) => x.name === name);
      if (!d) defs.push((d = { name, values: [] }));
      if (!d.values.includes(value)) d.values.push(value);
    }
  }
  return defs.map((d) => ({ name: d.name, values: d.values.join(", ") }));
}

const sameOptions = (a: Record<string, string> | null | undefined, b: Record<string, string>) => {
  const ka = Object.keys(a ?? {});
  return ka.length === Object.keys(b).length && ka.every((k) => a![k] === b[k]);
};

type Values = {
  title: string;
  description: string;
  /** Only when adding a product; after that, photos have their own editor. */
  imageUrl?: string;
  status: "draft" | "active" | "archived";
  variants: VariantValues[];
  /** Shown when the product came from a supplier. */
  supplier?: { label: string; sourceUrl: string | null };
  /** Whether the merchant can set options like size and colour here (not for supplier products). */
  optionsEditable?: boolean;
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
  const [drafts, setDrafts] = useState<OptionDraft[]>(() => draftsFrom(initial.variants));
  const hadOptions = initial.variants.some((v) => Object.keys(v.options ?? {}).length > 0);
  const combos = initial.optionsEditable ? combine(drafts) : [];
  const generated = combos.length > 0;
  const tooMany = combos.length > MAX_VARIANTS;
  // New combinations start from the first option's prices as typed so far.
  const [template, setTemplate] = useState({ price: initial.variants[0]!.price, cost: initial.variants[0]!.cost });
  const first = { ...initial.variants[0]!, ...template };
  // With options, the rows follow the combinations: an existing one keeps its id, prices and
  // stock; a new one starts from the first option's prices.
  const rows: { key: string; value: VariantValues; generated: boolean }[] = generated
    ? (tooMany ? [] : combos).map((c) => {
        const same = initial.variants.find((v) => sameOptions(v.options, c.options)) ?? initial.variants.find((v) => !Object.keys(v.options ?? {}).length && v.title === c.title);
        return { key: c.title, generated: true, value: same ? { ...same, title: c.title, options: c.options } : { title: c.title, options: c.options, price: first.price, compareAt: first.compareAt, cost: first.cost, stock: null, weightGrams: first.weightGrams } };
      })
    : initial.optionsEditable && hadOptions
      ? // Every option removed: one price for the whole product.
        [{ key: "Default", generated: false, value: { ...first, title: "Default", options: {} } }]
      : initial.variants.map((v, i) => ({ key: v.id ?? String(i), generated: false, value: v }));
  const many = rows.length > 1;

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
          {initial.optionsEditable && (
            <OptionsEditor drafts={drafts} setDrafts={setDrafts} count={combos.length} tooMany={tooMany} />
          )}
          {rows.map((r, i) => (
            <VariantRow key={r.key} index={i} initial={r.value} currency={currency} showTitle={many} generated={r.generated}
              onPrices={i === 0 ? setTemplate : undefined} />
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

function OptionsEditor({ drafts, setDrafts, count, tooMany }: { drafts: OptionDraft[]; setDrafts: (d: OptionDraft[]) => void; count: number; tooMany: boolean }) {
  const set = (i: number, patch: Partial<OptionDraft>) => setDrafts(drafts.map((d, n) => (n === i ? { ...d, ...patch } : d)));
  return (
    <div className="flex flex-col gap-3">
      {drafts.map((d, i) => (
        <div key={i} className="grid gap-3 sm:grid-cols-[180px_1fr_auto] items-end">
          <div className="field">
            <label className="label" htmlFor={`option-name-${i}`}>Option {i + 1}</label>
            <input className="input" id={`option-name-${i}`} value={d.name} maxLength={40} placeholder={["Size", "Color", "Material"][i]} onChange={(e) => set(i, { name: e.target.value })} />
          </div>
          <div className="field">
            <label className="label" htmlFor={`option-values-${i}`}>Option {i + 1} values, separated by commas</label>
            <input className="input" id={`option-values-${i}`} value={d.values} placeholder={["S, M, L", "Black, White", "Cotton, Linen"][i]} onChange={(e) => set(i, { values: e.target.value })} />
          </div>
          <button type="button" className="btn btn-secondary" aria-label={`Remove option ${i + 1}`} onClick={() => setDrafts(drafts.filter((_, n) => n !== i))}>Remove</button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        {drafts.length < MAX_OPTIONS && (
          <button type="button" className="btn btn-secondary self-start" onClick={() => setDrafts([...drafts, { name: "", values: "" }])}>
            {drafts.length ? "Add another option" : "Add options like size or colour"}
          </button>
        )}
        {count > 0 && (
          <span className={tooMany ? "text-critical text-sm" : "hint"} role="status">
            {tooMany ? `${count} combinations: a product can have up to ${MAX_VARIANTS}. Remove some values.` : `${count === 1 ? "1 combination" : `${count} combinations`}, each with its own price and stock below.`}
          </span>
        )}
      </div>
    </div>
  );
}

function VariantRow({ index, initial, currency, showTitle, generated, onPrices }: { index: number; initial: VariantValues; currency: string; showTitle: boolean; generated: boolean; onPrices?: (p: { price: string; cost: string }) => void }) {
  const [price, setPrice] = useState(initial.price);
  const [cost, setCost] = useState(initial.cost);
  useEffect(() => onPrices?.({ price, cost }), [price, cost, onPrices]);
  const p = toNumber(price);
  const c = toNumber(cost);
  const margin = p && c !== null && p > 0 ? Math.round(((p - c) / p) * 100) : null;
  const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency });
  const id = (k: string) => `${k}-${index}`;
  return (
    <fieldset className={`flex flex-col gap-3 ${showTitle ? "border-t border-border pt-4 first-of-type:border-0 first-of-type:pt-0" : ""}`}>
      {initial.id && <input type="hidden" name={`variantId.${index}`} value={initial.id} />}
      {initial.options && <input type="hidden" name={`options.${index}`} value={JSON.stringify(initial.options)} />}
      {generated ? (
        <>
          <legend className="font-medium">{initial.title}</legend>
          <input type="hidden" name={`variantTitle.${index}`} value={initial.title} />
        </>
      ) : showTitle ? (
        <div className="field">
          <label className="label" htmlFor={id("variantTitle")}>Option name</label>
          <input className="input" id={id("variantTitle")} name={`variantTitle.${index}`} required defaultValue={initial.title} />
        </div>
      ) : (
        <input type="hidden" name={`variantTitle.${index}`} value={initial.title || "Default"} />
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
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
        <div className="field">
          <label className="label" htmlFor={id("weight")}>Weight (g)</label>
          <input className="input num" id={id("weight")} name={`weight.${index}`} inputMode="numeric" defaultValue={initial.weightGrams ?? ""} placeholder="Packed, optional" />
        </div>
        <div className="field">
          <label className="label" htmlFor={id("sku")}>SKU</label>
          <input className="input" id={id("sku")} name={`sku.${index}`} maxLength={100} defaultValue={initial.sku ?? ""} placeholder="Optional" />
        </div>
        <div className="field">
          <label className="label" htmlFor={id("barcode")}>Barcode</label>
          <input className="input num" id={id("barcode")} name={`barcode.${index}`} maxLength={48} defaultValue={initial.barcode ?? ""} placeholder="UPC, EAN or your own" />
        </div>
      </div>
      <p className="hint num" aria-live="polite">
        {margin === null
          ? "Add your cost to see profit and margin."
          : <>Profit {fmt.format((p ?? 0) - (c ?? 0))} per sale · <span className={margin < 20 ? "text-critical font-semibold" : "text-success font-semibold"}>{margin}% margin</span></>}
        {initial.fromSupplier ? <> · Stock and cost follow the supplier daily</> : <> · Stock goes down as orders are paid, and back if one is cancelled before it ships</>}
      </p>
    </fieldset>
  );
}
