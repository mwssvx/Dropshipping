"use client";
import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { orderSampleAction, type SampleState } from "../../../sample-actions";

export type SampleView = { id: string; title: string; status: string; when: string; problem: string | null; tracking: { carrier: string | null; number: string | null; url: string | null } };

const STATUS: Record<string, string> = { placing: "Ordering", placed: "Ordered", shipped: "On the way", delivered: "Delivered", failed: "Not ordered" };

/** Order one to your own door before selling it, to check quality and delivery time. */
export function SamplePanel({ productId, supplier, options, countries, home, samples, limitReached }: {
  productId: string;
  supplier: string;
  options: { id: string; title: string; cost: string | null }[];
  countries: { code: string; name: string }[];
  home: string;
  samples: SampleView[];
  limitReached: boolean;
}) {
  const [state, action] = useActionState(orderSampleAction.bind(null, productId), {} as SampleState);
  return (
    <section className="card p-5 flex flex-col gap-3 max-w-3xl" aria-labelledby="sample-heading">
      <div>
        <h2 id="sample-heading" className="font-semibold">Order a sample</h2>
        <p className="hint">
          See the quality, the packaging and how long delivery really takes before your buyers do. {supplier} sends one to you and charges its
          cost and shipping the way it does for orders. It isn&apos;t a sale, so it doesn&apos;t count in your sales or profit.
        </p>
      </div>
      {state.message && <p className="banner banner-success" role="status">{state.message}</p>}
      {samples.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm" aria-label="Samples">
          {samples.map((s) => (
            <li key={s.id} className="flex justify-between gap-3 border-b border-border pb-1 flex-wrap">
              <span>{s.title} · {s.when}</span>
              <span className="hint">
                {STATUS[s.status] ?? s.status}
                {s.tracking.number && <> · {s.tracking.url ? <a className="underline" href={s.tracking.url} target="_blank" rel="noreferrer">{s.tracking.carrier} {s.tracking.number}</a> : `${s.tracking.carrier} ${s.tracking.number}`}</>}
                {s.problem && <> · {s.problem}</>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {limitReached ? (
        <p className="hint text-sm">You&apos;ve ordered the most samples of this product (3).</p>
      ) : (
        <form action={action} className="grid gap-3 sm:grid-cols-2">
          <FormError message={state.error} />
          <div className="field sm:col-span-2">
            <label className="label" htmlFor="sample-variant">Option</label>
            <select className="input" id="sample-variant" name="variantId">
              {options.map((o) => <option key={o.id} value={o.id}>{o.title === "Default" ? "This product" : o.title}{o.cost ? ` (supplier cost ${o.cost})` : ""}</option>)}
            </select>
          </div>
          <div className="field"><label className="label" htmlFor="sample-name">Send to</label><input className="input" id="sample-name" name="name" required autoComplete="name" /></div>
          <div className="field"><label className="label" htmlFor="sample-line1">Street</label><input className="input" id="sample-line1" name="line1" required autoComplete="address-line1" /></div>
          <div className="field"><label className="label" htmlFor="sample-line2">Flat or unit (optional)</label><input className="input" id="sample-line2" name="line2" autoComplete="address-line2" /></div>
          <div className="field"><label className="label" htmlFor="sample-city">Town or city</label><input className="input" id="sample-city" name="city" required autoComplete="address-level2" /></div>
          <div className="field"><label className="label" htmlFor="sample-region">State or county (optional)</label><input className="input" id="sample-region" name="region" autoComplete="address-level1" /></div>
          <div className="field"><label className="label" htmlFor="sample-postal">Postcode or ZIP</label><input className="input" id="sample-postal" name="postalCode" required autoComplete="postal-code" /></div>
          <div className="field">
            <label className="label" htmlFor="sample-country">Country to send it to</label>
            <select className="input" id="sample-country" name="country" defaultValue={home}>
              {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2"><SubmitButton className="btn btn-secondary" pendingText="Ordering…">Order a sample</SubmitButton></div>
        </form>
      )}
    </section>
  );
}
