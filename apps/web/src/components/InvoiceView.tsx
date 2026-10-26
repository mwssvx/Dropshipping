import { formatMoney, type InvoiceDocument } from "@sf/core";

const day = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });

/** One invoice or credit note, laid out to print on a single page. */
export function InvoiceView({ doc }: { doc: InvoiceDocument }) {
  const money = (m: number) => formatMoney(m, doc.currency);
  const { seller, buyer, credit } = doc;
  const taxLabel = doc.tax.map((t) => t.label).join(", ") || "Tax";
  return (
    <article className="invoice-sheet card p-6 sm:p-10 flex flex-col gap-8 text-sm" aria-label={`${doc.title} ${doc.number}`}>
      <header className="flex flex-col sm:flex-row sm:justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{doc.title}</h1>
          <p className="num text-base">{doc.number}</p>
        </div>
        <div className="sm:text-right flex flex-col gap-0.5">
          <p className="font-semibold">{seller.name}</p>
          {seller.address && <p className="whitespace-pre-line text-muted">{seller.address}</p>}
          {seller.taxNumbers.map((t) => <p key={t.label} className="text-muted">{t.label}: <span className="num">{t.number}</span></p>)}
        </div>
      </header>
      <div className="grid sm:grid-cols-2 gap-6">
        <section aria-labelledby="bill-to">
          <h2 id="bill-to" className="font-semibold mb-1">Bill to</h2>
          {buyer.company && <p>{buyer.company}</p>}
          <p>{buyer.name}</p>
          {buyer.address.map((l) => <p key={l} className="text-muted">{l}</p>)}
          <p className="text-muted break-all">{buyer.email}</p>
          {buyer.taxId && <p className="text-muted">Tax ID: <span className="num">{buyer.taxId}</span></p>}
          {doc.taxExemptId && <p className="text-muted">Tax exemption: <span className="num">{doc.taxExemptId}</span></p>}
        </section>
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1 sm:justify-self-end">
          <dt className="text-muted">Issued</dt><dd>{day.format(doc.issuedAt)}</dd>
          <dt className="text-muted">Order</dt><dd className="num">#{doc.order.number}, {day.format(doc.order.placedAt)}</dd>
          {credit?.invoiceNumber && <><dt className="text-muted">For invoice</dt><dd className="num">{credit.invoiceNumber}</dd></>}
        </dl>
      </div>
      {credit ? (
        <table className="w-full">
          <thead className="text-left border-b border-border">
            <tr><th className="py-2 font-semibold">Description</th><th className="py-2 font-semibold text-right">Amount</th></tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="py-2">Refund on order #{doc.order.number}{credit.reason ? `: ${credit.reason}` : ""}</td>
              <td className="py-2 text-right num">−{money(credit.amountMinor)}</td>
            </tr>
          </tbody>
          <tfoot>
            {credit.taxMinor > 0 && <tr><td className="pt-2 text-right text-muted">Of which {taxLabel}</td><td className="pt-2 text-right num">−{money(credit.taxMinor)}</td></tr>}
            <tr><td className="pt-2 text-right font-semibold">Total credited</td><td className="pt-2 text-right num font-semibold">−{money(credit.amountMinor)}</td></tr>
          </tfoot>
        </table>
      ) : (
        <table className="w-full">
          <thead className="text-left border-b border-border">
            <tr>
              <th className="py-2 font-semibold">Item</th>
              <th className="py-2 font-semibold text-right">Qty</th>
              <th className="py-2 font-semibold text-right">Unit price</th>
              <th className="py-2 font-semibold text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l) => (
              <tr key={l.id} className="border-b border-border">
                <td className="py-2 pr-3">{l.title}</td>
                <td className="py-2 text-right num">{l.quantity}</td>
                <td className="py-2 text-right num">{money(l.unitMinor)}</td>
                <td className="py-2 text-right num">{money(l.totalMinor)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="num">
            <Row label="Subtotal" value={money(doc.subtotalMinor)} />
            {doc.discount && <Row label={doc.discount.label} value={`−${money(doc.discount.amountMinor)}`} />}
            <Row label={doc.shipping.label} value={doc.shipping.amountMinor ? money(doc.shipping.amountMinor) : "Free"} />
            {!doc.taxIncluded && doc.tax.map((t) => <Row key={t.label} label={t.label} value={money(t.amountMinor)} />)}
            {doc.taxExemptId && <Row label="Tax (exempt)" value={money(0)} />}
            <Row label="Total" value={money(doc.totalMinor)} strong />
            {doc.taxIncluded && doc.tax.map((t) => <Row key={t.label} label={`Includes ${t.label}`} value={money(t.amountMinor)} />)}
            {doc.giftCardMinor > 0 && <Row label="Paid with gift card" value={money(doc.giftCardMinor)} />}
            {doc.giftCardMinor > 0 && doc.paidMinor > 0 && <Row label="Paid by card" value={money(doc.paidMinor)} />}
          </tfoot>
        </table>
      )}
      {!credit && <p className="text-muted">{doc.totalMinor > 0 ? "Paid in full. Thank you." : "Nothing to pay."}</p>}
      {doc.converted && (
        <p className="text-muted">
          Amounts in {doc.currency}, as paid. In {doc.converted.currency}: {formatMoney(doc.converted.totalMinor, doc.converted.currency)} for the order, at 1 {doc.converted.currency} = {doc.converted.rate.toFixed(4)} {doc.currency}.
        </p>
      )}
      {seller.footer && <p className="whitespace-pre-line border-t border-border pt-4 text-muted">{seller.footer}</p>}
    </article>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr>
      <td colSpan={3} className={`pt-2 pr-3 text-right ${strong ? "font-semibold" : "text-muted"}`}>{label}</td>
      <td className={`pt-2 text-right ${strong ? "font-semibold" : ""}`}>{value}</td>
    </tr>
  );
}
