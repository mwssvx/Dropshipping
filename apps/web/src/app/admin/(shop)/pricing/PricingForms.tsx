"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "../../actions";
import { pricingRuleAction, repriceAction, type RepriceState } from "../../pricing-actions";

export type RuleFields = { kind: "multiplier" | "fixed"; multiplier: string; fixedValue: string; ending: string; compareAt: boolean; compareAtPercent: string; minPrice: string };

export function PricingRuleForm({ initial, symbol }: { initial: RuleFields; symbol: string }) {
  const [state, action] = useActionState(pricingRuleAction, {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-success" role="status">Pricing rule saved. New imports use it now.</p>}
      {/* Keyed by the saved rule, so the fields show it again after a save. */}
      <RuleFieldset key={JSON.stringify(initial)} initial={initial} symbol={symbol} />
      <SubmitButton className="btn btn-primary self-start">Save pricing rule</SubmitButton>
    </form>
  );
}

function RuleFieldset({ initial, symbol }: { initial: RuleFields; symbol: string }) {
  const [kind, setKind] = useState(initial.kind);
  const [compareAt, setCompareAt] = useState(initial.compareAt);
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-1">Price from supplier cost</legend>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <input type="radio" name="kind" value="multiplier" checked={kind === "multiplier"} onChange={() => setKind("multiplier")} />
          Multiply cost by
          <input className="input w-24 num" name="multiplier" aria-label="Multiplier" inputMode="decimal" defaultValue={initial.multiplier} disabled={kind !== "multiplier"} />
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <input type="radio" name="kind" value="fixed" checked={kind === "fixed"} onChange={() => setKind("fixed")} />
          Add to cost {symbol}
          <input className="input w-28 num" name="fixedValue" aria-label="Amount to add" inputMode="decimal" defaultValue={initial.fixedValue} disabled={kind !== "fixed"} />
        </label>
      </fieldset>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="field">
          <label className="label" htmlFor="ending">Round up to</label>
          <select className="input" id="ending" name="ending" defaultValue={initial.ending}>
            <option value="99">.99 (like 24.99)</option>
            <option value="95">.95 (like 24.95)</option>
            <option value="00">Whole amounts (like 25.00)</option>
            <option value="none">Don&apos;t round</option>
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="minPrice">Lowest price ({symbol})</label>
          <input className="input num" id="minPrice" name="minPrice" inputMode="decimal" defaultValue={initial.minPrice} />
        </div>
      </div>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <input type="checkbox" name="compareAt" checked={compareAt} onChange={(e) => setCompareAt(e.target.checked)} />
        Show a crossed-out price
        <input className="input w-20 num" name="compareAtPercent" aria-label="Crossed-out price percent" inputMode="numeric" defaultValue={initial.compareAtPercent} disabled={!compareAt} />
        % higher
      </label>
      <p className="hint text-sm">Only show a crossed-out price if you really sold at it: in many countries, made-up &ldquo;was&rdquo; prices are against consumer law.</p>
    </div>
  );
}

export function RepriceButton({ label }: { label: string }) {
  const [state, action] = useActionState(repriceAction, {} as RepriceState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormError message={state.error} />
      <SubmitButton className="btn btn-primary self-start" pendingText="Updating…">{label}</SubmitButton>
    </form>
  );
}
