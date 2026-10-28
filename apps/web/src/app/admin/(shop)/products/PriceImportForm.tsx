"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { priceImportAction, type PriceImportState } from "../../price-import-actions";

const options = (n: number) => (n === 1 ? "1 option" : `${n.toLocaleString("en-US")} options`);

export function PriceImportForm({ canDownload }: { canDownload: boolean }) {
  const [state, action, pending] = useActionState(priceImportAction, {} as PriceImportState);
  const r = !pending ? state.result : undefined;
  return (
    <form action={action} className="flex flex-col gap-3 mt-3 max-w-2xl" aria-label="Change prices and stock from a spreadsheet">
      <p className="hint">
        Change many prices at once: {canDownload ? <><a href="/admin/export/products.csv" className="underline">download your products</a>, change</> : "upload a CSV with"} the Price, Compare at price, Cost or Stock columns{canDownload ? " in a spreadsheet, and upload it here" : ""}. Rows are found by SKU, or by Handle and Variant. Empty cells stay as they are, and 0 in Compare at price takes it off. Stock changes only for stock you keep yourself.
      </p>
      <FormError message={state.error} />
      {r && (
        <div className={`banner ${r.changed ? "banner-success" : "banner-info"} flex flex-col gap-1`} role="status">
          <p>
            {r.changed ? `Changed ${options(r.changed)}.` : "Nothing needed changing."}
            {r.unchanged ? ` ${options(r.unchanged)} already matched the file.` : ""}
          </p>
          {r.skipped.length > 0 && (
            <>
              <p>{r.skipped.length === 1 ? "1 thing wasn't used:" : `${r.skipped.length} things weren't used:`}</p>
              <ul className="list-disc pl-5">
                {r.skipped.slice(0, 20).map((s, i) => (
                  <li key={i}>Line {s.line}{s.ref ? ` (${s.ref})` : ""}: {s.reason}</li>
                ))}
                {r.skipped.length > 20 && <li>and {r.skipped.length - 20} more.</li>}
              </ul>
            </>
          )}
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="price-file">Prices file (CSV)</label>
        <input className="input" id="price-file" name="file" type="file" accept=".csv,text/csv" required />
      </div>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Changing prices…" : "Upload prices"}</button>
      </div>
    </form>
  );
}
