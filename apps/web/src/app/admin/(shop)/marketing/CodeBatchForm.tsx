"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { createCodeBatchAction, type CodeBatchState } from "../../code-batch-actions";

/** Makes many one-time codes at once. Submitted by hand so React doesn't reset the fields after an error. */
export function CodeBatchForm({ currency, max }: { currency: string; max: number }) {
  const [state, action, pending] = useActionState(createCodeBatchAction, {} as CodeBatchState);
  const [kind, setKind] = useState("percent");
  const symbol = new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? "";
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.made && !pending && !state.error && (
        <p role="status" className="banner banner-success">
          Made {state.made.count} codes for {state.made.name}.{" "}
          <a className="underline" href={`/admin/marketing/batches/${state.made.id}/codes.csv`}>Download them as a spreadsheet</a>
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="field">
          <label className="label" htmlFor="batch-name">Batch name</label>
          <input className="input" id="batch-name" name="name" required maxLength={60} placeholder="Parcel cards" />
        </div>
        <div className="field">
          <label className="label" htmlFor="batch-prefix">Codes start with</label>
          <input className="input font-mono uppercase" id="batch-prefix" name="prefix" required maxLength={12} placeholder="THANKS" autoCapitalize="characters" />
        </div>
        <div className="field">
          <label className="label" htmlFor="batch-count">How many</label>
          <input className="input num" id="batch-count" name="count" required inputMode="numeric" defaultValue="100" aria-describedby="batch-count-hint" />
          <span id="batch-count-hint" className="hint">Up to {max.toLocaleString("en-US")}.</span>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="field">
          <label className="label" htmlFor="batch-kind">Each code gives</label>
          <select className="input" id="batch-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="percent">Percent off</option>
            <option value="amount">Amount off</option>
            <option value="free_shipping">Free shipping</option>
          </select>
        </div>
        {kind !== "free_shipping" && (
          <div className="field">
            <label className="label" htmlFor="batch-value">{kind === "percent" ? "Off each order (%)" : `Off each order (${symbol})`}</label>
            <input className="input num" id="batch-value" name="value" required inputMode="decimal" placeholder={kind === "percent" ? "10" : "5.00"} />
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="batch-min">Only on orders over ({symbol})</label>
          <input className="input num" id="batch-min" name="minSubtotal" inputMode="decimal" placeholder="Optional" />
        </div>
        <div className="field">
          <label className="label" htmlFor="batch-ends">Last day</label>
          <input className="input" id="batch-ends" name="endsAt" type="date" />
        </div>
      </div>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Making codes…" : "Make codes"}</button>
      </div>
    </form>
  );
}
