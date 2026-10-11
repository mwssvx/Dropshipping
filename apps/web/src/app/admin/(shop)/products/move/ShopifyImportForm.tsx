"use client";
import Link from "next/link";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { shopifyImportAction, type ShopifyImportState } from "../../../shopify-import-actions";

export function ShopifyImportForm() {
  const [state, action, pending] = useActionState(shopifyImportAction, {} as ShopifyImportState);
  const done = state.created !== undefined && !pending;
  return (
    <form action={action} className="card p-5 flex flex-col gap-4">
      <FormError message={state.error} />
      {done && (
        <div className="banner banner-success flex flex-col gap-1" role="status">
          <p>
            {state.created === 1 ? "1 product added." : `${state.created} products added.`}
            {state.skipped!.length > 0 && ` ${state.skipped!.length === 1 ? "1 was" : `${state.skipped!.length} were`} already in your store, so ${state.skipped!.length === 1 ? "it was" : "they were"} left as they are.`}
          </p>
          {state.created! > 0 && <Link href="/admin/products" className="underline">See your products</Link>}
        </div>
      )}
      {done && state.problems!.length > 0 && (
        <div className="banner banner-warning flex flex-col gap-1" role="note">
          <p className="font-medium">Not everything came in:</p>
          <ul className="list-disc pl-5 text-sm">
            {state.problems!.slice(0, 20).map((p) => <li key={p}>{p}</li>)}
          </ul>
          {state.problems!.length > 20 && <p className="text-sm">And {state.problems!.length - 20} more.</p>}
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="shopify-file">Shopify products file (CSV)</label>
        <input className="input" id="shopify-file" name="file" type="file" accept=".csv,text/csv" required />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="keepStatus" className="mt-1" />
        <span>Put products that are active on Shopify on sale straight away. Otherwise everything comes in as a draft for you to check first.</span>
      </label>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Adding products…" : "Add products"}</button>
      </div>
    </form>
  );
}
