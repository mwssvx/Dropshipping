import type { PackingSlip } from "@sf/core";
import { countryNames } from "@/lib/store-text";

const day = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });
const country = countryNames("en");

/** `giftReturns`: the store's page where a gift's recipient returns it with the code on the slip. */
type Store = { name: string; address: string | null; note: string | null; giftReturns?: string };

/** One order's packing slip: who it's for and what goes in the box, with no prices. */
export function PackingSlipView({ slip, store }: { slip: PackingSlip; store: Store }) {
  const a = slip.shipTo;
  const count = slip.items.reduce((n, i) => n + i.quantity, 0);
  return (
    <article className="card p-6 sm:p-10 flex flex-col gap-8 text-sm" aria-label={`Packing slip for order #${slip.number}`}>
      <header className="flex flex-col sm:flex-row sm:justify-between gap-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{store.name}</h2>
          {store.address && <p className="whitespace-pre-line text-muted">{store.address}</p>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1 sm:justify-self-end">
          <dt className="text-muted">Order</dt><dd className="num font-semibold">#{slip.number}</dd>
          <dt className="text-muted">Placed</dt><dd>{day.format(slip.placedAt)}</dd>
          <dt className="text-muted">Items</dt><dd className="num">{count}</dd>
        </dl>
      </header>
      <section aria-label="Ship to">
        <h3 className="font-semibold mb-1">Ship to</h3>
        <p>{a.name}</p>
        <p>{a.line1}</p>
        {a.line2 && <p>{a.line2}</p>}
        <p>{a.city}{a.region ? `, ${a.region}` : ""} {a.postalCode}</p>
        <p>{country(a.country, a.country)}</p>
        {a.phone && <p className="text-muted num">{a.phone}</p>}
      </section>
      <table className="w-full">
        <thead>
          <tr className="text-left border-b border-border">
            <th className="py-2 w-10" aria-label="Packed"></th>
            <th className="py-2">Item</th>
            <th className="py-2">SKU</th>
            <th className="py-2 text-right">Quantity</th>
          </tr>
        </thead>
        <tbody>
          {slip.items.map((item, i) => (
            <tr key={i} className="border-b border-border align-top">
              <td className="py-2"><span className="inline-block size-4 border border-ink rounded-sm" aria-hidden /></td>
              <td className="py-2">
                {item.title}
                {item.personalization && <span className="block text-muted">{item.personalization}</span>}
                {item.preorder && <span className="block text-muted">Pre-order</span>}
              </td>
              <td className="py-2 num text-muted">{item.sku ?? "–"}</td>
              <td className="py-2 num text-right font-semibold">{item.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {slip.separately.length > 0 && (
        <p className="text-muted" aria-label="Coming separately">
          Coming separately from another warehouse: {slip.separately.map((i) => (i.quantity > 1 ? `${i.title} × ${i.quantity}` : i.title)).join(", ")}.
        </p>
      )}
      {slip.gift && (
        <section className="border border-border rounded-md p-4" aria-label="Gift message">
          <p className="font-semibold">A gift from {slip.gift.from}</p>
          {slip.gift.message && <p className="whitespace-pre-line mt-1">{slip.gift.message}</p>}
          {slip.gift.returnCode && store.giftReturns && (
            <p className="mt-3 text-muted" aria-label="Gift return">
              Not quite right? Return it for store credit at {store.giftReturns.replace(/^https?:\/\//, "")} with the code <span className="font-mono font-semibold text-ink">{slip.gift.returnCode}</span>. {slip.gift.from} won&apos;t be told.
            </p>
          )}
        </section>
      )}
      {slip.sameBox.length > 0 && (
        <p className="no-print font-semibold" aria-label="Same box">
          {slip.sameBox.length === 1 ? `Order #${slip.sameBox[0]} goes` : `Orders ${slip.sameBox.map((n) => `#${n}`).join(", ")} go`} to the same address and also {slip.sameBox.length === 1 ? "has" : "have"} items you post. Pack them in this box (not printed).
        </p>
      )}
      {slip.giftWrap && <p className="no-print font-semibold">Gift wrap this order. The buyer paid for wrapping (not printed).</p>}
      {slip.buyerNote && (
        <p className="no-print text-muted"><span className="font-semibold text-ink">Buyer&apos;s note (not printed):</span> {slip.buyerNote}</p>
      )}
      {store.note && <footer className="whitespace-pre-line text-center border-t border-border pt-4">{store.note}</footer>}
    </article>
  );
}
