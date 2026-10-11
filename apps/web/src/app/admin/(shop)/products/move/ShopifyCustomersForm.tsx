"use client";
import Link from "next/link";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { shopifyCustomersAction, type ShopifyCustomersState } from "../../../shopify-import-actions";

const people = (n: number) => (n === 1 ? "1 customer" : `${n.toLocaleString("en-US")} customers`);

export function ShopifyCustomersForm() {
  const [state, action, pending] = useActionState(shopifyCustomersAction, {} as ShopifyCustomersState);
  const done = state.added !== undefined && !pending;
  return (
    <form action={action} className="card p-5 flex flex-col gap-4">
      <FormError message={state.error} />
      {done && (
        <div className="banner banner-success flex flex-col gap-1" role="status">
          <p>
            {people(state.added!)} added
            {state.updated ? `, ${people(state.updated)} already here got their Shopify tags` : ""}. {state.subscribed ? `${people(state.subscribed)} agreed to marketing email on Shopify, so they get your campaigns.` : ""}
            {state.invalid ? ` ${state.invalid === 1 ? "1 row had" : `${state.invalid} rows had`} no usable email address and ${state.invalid === 1 ? "was" : "were"} left out.` : ""}
          </p>
          <Link href="/admin/customers" className="underline">See your customers</Link>
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="shopify-customers">Shopify customers file (CSV)</label>
        <input className="input" id="shopify-customers" name="file" type="file" accept=".csv,text/csv" required />
      </div>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Adding customers…" : "Add customers"}</button>
      </div>
    </form>
  );
}
