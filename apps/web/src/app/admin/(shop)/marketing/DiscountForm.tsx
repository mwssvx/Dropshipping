"use client";
import { useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { createDiscountAction } from "../../growth-actions";

export function DiscountForm({ currency, products, tags }: { currency: string; products: { id: string; title: string }[]; tags: string[] }) {
  const [state, action] = useActionState(createDiscountAction, {});
  const [kind, setKind] = useState("percent");
  const symbol = new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? "";
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      {state.saved && <p role="status" className="banner banner-info">Code created. Buyers can use it now.</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="field">
          <label className="label" htmlFor="code">Code</label>
          <input className="input font-mono uppercase" id="code" name="code" required maxLength={30} placeholder="WELCOME10" autoCapitalize="characters" />
        </div>
        <div className="field">
          <label className="label" htmlFor="kind">Type</label>
          <select className="input" id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="percent">Percent off</option>
            <option value="amount">Amount off</option>
            <option value="free_shipping">Free shipping</option>
            <option value="bxgy">Buy X, get Y</option>
          </select>
        </div>
        {kind !== "free_shipping" && kind !== "bxgy" && (
          <div className="field">
            <label className="label" htmlFor="value">{kind === "percent" ? "Percent" : `Amount (${symbol})`}</label>
            <input className="input num" id="value" name="value" required inputMode="decimal" placeholder={kind === "percent" ? "10" : "5.00"} />
          </div>
        )}
      </div>
      {kind === "bxgy" && (
        <div className="flex flex-col gap-3 border-l-2 border-border pl-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="field">
              <label className="label" htmlFor="buyQty">Buyer buys</label>
              <input className="input num" id="buyQty" name="buyQty" required inputMode="numeric" defaultValue="2" />
            </div>
            <div className="field">
              <label className="label" htmlFor="getQty">Buyer gets</label>
              <input className="input num" id="getQty" name="getQty" required inputMode="numeric" defaultValue="1" />
            </div>
            <div className="field">
              <label className="label" htmlFor="getPercent">Percent off what they get</label>
              <input className="input num" id="getPercent" name="value" required inputMode="numeric" defaultValue="100" />
              <span className="hint">100 makes them free. The cheapest items in the cart are the ones discounted.</span>
            </div>
          </div>
          {products.length > 0 && (
            <fieldset className="flex flex-col gap-1">
              <legend className="label mb-1">Products it counts (none ticked means all)</legend>
              <div className="max-h-40 overflow-y-auto flex flex-col gap-1 text-sm">
                {products.map((p) => (
                  <label key={p.id} className="flex items-center gap-2"><input type="checkbox" name="productIds" value={p.id} /> {p.title}</label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      )}
      {(kind === "percent" || kind === "amount") && products.length > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="label mb-1">Products it&apos;s for (none ticked means the whole order)</legend>
          <div className="max-h-40 overflow-y-auto flex flex-col gap-1 text-sm">
            {products.map((p) => (
              <label key={p.id} className="flex items-center gap-2"><input type="checkbox" name="productIds" value={p.id} /> {p.title}</label>
            ))}
          </div>
          <span className="hint">Only those come down in price, so a code like SUMMER20 can be for your summer range alone.</span>
        </fieldset>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="field">
          <label className="label" htmlFor="minSubtotal">Minimum order ({symbol})</label>
          <input className="input num" id="minSubtotal" name="minSubtotal" inputMode="decimal" placeholder="Optional" />
        </div>
        <div className="field">
          <label className="label" htmlFor="startsAt">Starts</label>
          <input className="input" id="startsAt" name="startsAt" type="date" />
        </div>
        <div className="field">
          <label className="label" htmlFor="endsAt">Ends</label>
          <input className="input" id="endsAt" name="endsAt" type="date" />
        </div>
      </div>
      {kind !== "free_shipping" && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="automatic" defaultChecked={kind === "bxgy"} key={kind} className="mt-1" />
          <span>
            {kind === "bxgy"
              ? "Apply it automatically, no code needed. Product pages show the offer."
              : "Apply it automatically to orders over the minimum, no code needed. The cart tells buyers how much more to spend, so you can set a few steps (spend more, save more)."}
          </span>
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-3 items-end">
        <div className="field">
          <label className="label" htmlFor="usageLimit">Total uses</label>
          <input className="input num" id="usageLimit" name="usageLimit" inputMode="numeric" placeholder="No limit" />
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2 pb-2">
          <input type="checkbox" name="oncePerCustomer" /> Once per buyer
        </label>
      </div>
      {kind !== "bxgy" && (
        <div className="field">
          <label className="label" htmlFor="customerTag">Only for customers tagged</label>
          <input className="input sm:max-w-xs" id="customerTag" name="customerTag" maxLength={30} placeholder="Anyone" list="customer-tags" autoComplete="off" />
          <datalist id="customer-tags">{tags.map((t) => <option key={t} value={t} />)}</datalist>
          <span className="hint">Say &ldquo;vip&rdquo; and only customers with that tag on their page can use it. Buyers are checked by the email they check out with.</span>
        </div>
      )}
      <div><SubmitButton pendingText="Creating…">{kind === "bxgy" ? "Create offer" : "Create code"}</SubmitButton></div>
    </form>
  );
}
