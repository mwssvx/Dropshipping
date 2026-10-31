"use client";
import { useActionState, useState } from "react";
import type { ImportPreview } from "@sf/core";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { importProductAction } from "../../../actions";

const toPrice = (m: number) => (m / 100).toFixed(2);
const toNumber = (s: string) => {
  const n = Number(s.replace(/[,\s$]/g, ""));
  return Number.isFinite(n) && s.trim() !== "" ? n : null;
};

export function ImportForm({ url, preview, currency }: { url: string; preview: ImportPreview; currency: string }) {
  const [state, action] = useActionState(importProductAction, {});
  const { product } = preview;
  const [prices, setPrices] = useState(() =>
    Object.fromEntries(product.variants.map((v) => [v.ref, toPrice(preview.suggestedPrices[v.ref]!)])),
  );
  const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency });
  const ship = product.variants.find((v) => v.shipDaysMin != null);

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="url" value={url} />
      {preview.warehouse && <input type="hidden" name="warehouse" value={preview.warehouse} />}
      <FormError message={state.error} />
      <section className="card p-5 flex flex-col gap-4">
        <div className="flex gap-4 items-start">
          {product.images[0] ? (
            <img src={product.images[0]} alt="" className="size-20 rounded-lg object-cover bg-sunken shrink-0" />
          ) : (
            <span className="size-20 rounded-lg bg-sunken shrink-0" aria-hidden />
          )}
          <div className="flex flex-col gap-1 min-w-0">
            <span className="hint">From {preview.supplier.label}{ship ? ` · ships in ${ship.shipDaysMin}–${ship.shipDaysMax} days` : ""}</span>
            <span className="font-semibold">{product.title}</span>
            <span className="hint">{product.variants.length} {product.variants.length === 1 ? "option" : "options"} · {product.images.length} {product.images.length === 1 ? "image" : "images"}</span>
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="title">Title on your store</label>
          <input className="input" id="title" name="title" required maxLength={200} defaultValue={product.title} />
        </div>
        <div className="field">
          <label className="label" htmlFor="description">Description</label>
          <textarea className="input" id="description" name="description" rows={5} defaultValue={product.description} />
          <span className="hint">Supplier descriptions are often rough. Rewrite it in your own words before you publish.</span>
        </div>
      </section>

      <section className="card overflow-x-auto">
        <table className="table min-w-[560px]">
          <thead>
            <tr><th>Option</th><th className="text-right">Supplier cost</th><th className="text-right">Your price</th><th className="text-right">Profit</th><th className="text-right">Stock</th></tr>
          </thead>
          <tbody>
            {product.variants.map((v) => {
              const p = toNumber(prices[v.ref] ?? "");
              const profit = p === null ? null : Math.round(p * 100) - v.costMinor;
              const margin = p ? Math.round((profit! / (p * 100)) * 100) : null;
              return (
                <tr key={v.ref}>
                  <td>{v.title}</td>
                  <td className="text-right num">{fmt.format(v.costMinor / 100)}</td>
                  <td className="text-right">
                    <label className="sr-only" htmlFor={`price-${v.ref}`}>Price for {v.title}</label>
                    <input id={`price-${v.ref}`} name={`price:${v.ref}`} className="input num text-right w-28 ml-auto" inputMode="decimal" required
                      value={prices[v.ref]} onChange={(e) => setPrices({ ...prices, [v.ref]: e.target.value })} />
                  </td>
                  <td className={`text-right num ${profit !== null && profit <= 0 ? "text-critical font-semibold" : ""}`}>
                    {profit === null ? "—" : `${fmt.format(profit / 100)} (${margin}%)`}
                  </td>
                  <td className={`text-right num ${v.stock !== null && v.stock < 5 ? "text-critical" : "hint"}`}>{v.stock ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="hint text-sm px-4 py-3 border-t border-border">Starting prices follow your <a href="/admin/pricing" className="underline">pricing rule</a>.</p>
      </section>

      <div className="flex gap-2 flex-wrap justify-end">
        <SubmitButton className="btn btn-secondary" pendingText="Importing…"><span>Save as draft</span></SubmitButton>
        <button type="submit" name="publish" value="1" className="btn btn-primary">Import and publish</button>
      </div>
    </form>
  );
}
