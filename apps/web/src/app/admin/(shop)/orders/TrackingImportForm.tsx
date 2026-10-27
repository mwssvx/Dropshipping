"use client";
import Link from "next/link";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { trackingImportAction, type TrackingImportState } from "../../tracking-import-actions";

const orders = (n: number) => (n === 1 ? "1 order" : `${n.toLocaleString("en-US")} orders`);

export function TrackingImportForm() {
  const [state, action, pending] = useActionState(trackingImportAction, {} as TrackingImportState);
  const r = !pending ? state.result : undefined;
  return (
    <form action={action} className="flex flex-col gap-3 mt-3 max-w-2xl" aria-label="Add tracking from a spreadsheet">
      <p className="hint">
        Shipped orders yourself, or got a list of tracking numbers from a supplier? Upload a CSV with Order, Carrier and Tracking number columns (Tracking link is optional). Each order is marked shipped and the buyer gets the shipping email.{" "}
        <a href="/admin/orders/tracking.csv" className="underline">Download the orders waiting for tracking</a> to fill in.
      </p>
      <FormError message={state.error} />
      {r && (
        <div className={`banner ${r.shipped.length ? "banner-success" : "banner-info"} flex flex-col gap-1`} role="status">
          <p>
            {r.shipped.length ? `Marked ${orders(r.shipped.length)} shipped and emailed the buyers.` : "No orders were marked shipped."}
            {r.alreadyHere.length ? ` ${orders(r.alreadyHere.length)} already had this tracking.` : ""}
          </p>
          {r.skipped.length > 0 && (
            <>
              <p>{r.skipped.length === 1 ? "1 row wasn't used:" : `${r.skipped.length} rows weren't used:`}</p>
              <ul className="list-disc pl-5">
                {r.skipped.slice(0, 20).map((s) => (
                  <li key={s.line}>Line {s.line}{s.order ? ` (${s.order})` : ""}: {s.reason}</li>
                ))}
                {r.skipped.length > 20 && <li>and {r.skipped.length - 20} more.</li>}
              </ul>
            </>
          )}
          {r.shipped.length > 0 && <Link href="/admin/orders" className="underline">See your orders</Link>}
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="tracking-file">Tracking file (CSV)</label>
        <input className="input" id="tracking-file" name="file" type="file" accept=".csv,text/csv" required />
      </div>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Adding tracking…" : "Add tracking"}</button>
      </div>
    </form>
  );
}
