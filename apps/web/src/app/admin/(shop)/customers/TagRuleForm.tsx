"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { createTagRuleAction, type TagRuleState } from "../../tag-rule-actions";

/** Adds a rule that tags customers automatically. Submitted by hand so React doesn't reset the fields after an error. */
export function TagRuleForm({ currency, products }: { currency: string; products: { id: string; title: string }[] }) {
  const [state, action, pending] = useActionState(createTagRuleAction, {} as TagRuleState);
  const [kind, setKind] = useState("spent");
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
      {state.added && !pending && !state.error && (
        <p role="status" className="banner banner-success">
          {state.added.tagged === 0
            ? "Added. Nobody matches it yet."
            : `Added. ${state.added.tagged} ${state.added.tagged === 1 ? "customer now has" : "customers now have"} the tag “${state.added.tag}”.`}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="field">
          <label className="label" htmlFor="rule-kind">Customers who</label>
          <select className="input" id="rule-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="spent">Spent at least</option>
            <option value="orders">Placed at least</option>
            <option value="bought">Bought a product</option>
            <option value="lapsed">Haven&apos;t ordered in</option>
          </select>
        </div>
        {kind === "spent" && (
          <div className="field">
            <label className="label" htmlFor="rule-amount">Amount ({symbol})</label>
            <input className="input num" id="rule-amount" name="amount" required inputMode="decimal" placeholder="200.00" />
          </div>
        )}
        {kind === "orders" && (
          <div className="field">
            <label className="label" htmlFor="rule-orders">Number of orders</label>
            <input className="input num" id="rule-orders" name="orders" required inputMode="numeric" defaultValue="2" />
          </div>
        )}
        {kind === "lapsed" && (
          <div className="field">
            <label className="label" htmlFor="rule-days">Days since their last order</label>
            <input className="input num" id="rule-days" name="days" required inputMode="numeric" defaultValue="90" />
          </div>
        )}
        {kind === "bought" && (
          <div className="field">
            <label className="label" htmlFor="rule-product">Which product</label>
            <select className="input" id="rule-product" name="productId" required defaultValue="">
              <option value="">Pick a product</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="rule-tag">Get the tag</label>
          <input className="input" id="rule-tag" name="tag" required maxLength={30} placeholder="vip" />
        </div>
      </div>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Tagging…" : "Add rule"}</button>
      </div>
    </form>
  );
}
