import Link from "next/link";
import { formatInvoiceNumber, formatMoney, invoiceGaps, listInvoices } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { InvoiceSettingsForm } from "./InvoiceSettingsForm";

export const metadata = { title: "Invoices" };

const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

export default async function InvoicesPage() {
  const { shop, db } = await requireShop("taxes");
  const docs = await listInvoices(db, shop.id, {}, 50);
  const gaps = invoiceGaps(shop);
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 8)}01`;
  return (
    <main className="pb-12">
      <PageHeader title="Invoices" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-4xl">
        <p className="hint max-w-2xl">
          Every paid order gets a numbered invoice, and every refund a credit note, in one series with no gaps. Buyers get a link in their order
          email and can open them from their order page. An issued invoice keeps the details it was issued with.
        </p>
        {gaps.length > 0 && (
          <p className="banner banner-warning" role="status">Most tax offices need {gaps.join(" and ")} on an invoice. Add {gaps.length > 1 ? "them" : "it"} below.</p>
        )}
        <section className="card p-5 flex flex-col gap-4" aria-labelledby="settings-heading">
          <h2 id="settings-heading" className="font-semibold">Your details</h2>
          <InvoiceSettingsForm
            initial={{ legalName: shop.invoiceLegalName ?? "", address: shop.invoiceAddress ?? "", prefix: shop.invoicePrefix, nextNumber: String(shop.invoiceNextNumber), footer: shop.invoiceFooter ?? "" }}
          />
          <p className="hint text-sm">
            The next one will be <span className="num font-semibold">{formatInvoiceNumber(shop.invoicePrefix, shop.invoiceNextNumber)}</span>. Tax numbers come from{" "}
            <Link href="/admin/taxes" className="underline">Taxes</Link>.
          </p>
        </section>
        <section className="card overflow-x-auto" aria-labelledby="issued-heading">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-2">
            <h2 id="issued-heading" className="font-semibold">Issued</h2>
            <form action="/admin/invoices/register.csv" className="flex flex-wrap items-end gap-2">
              <div className="field">
                <label className="label" htmlFor="from">From</label>
                <input className="input" type="date" id="from" name="from" defaultValue={monthStart} />
              </div>
              <div className="field">
                <label className="label" htmlFor="to">To</label>
                <input className="input" type="date" id="to" name="to" defaultValue={today} />
              </div>
              <button className="btn btn-secondary">Download CSV</button>
            </form>
          </div>
          {docs.length === 0 ? (
            <p className="hint px-5 pb-4">No invoices yet. The first one is issued when an order is paid.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left hint">
                <tr><th className="px-5 py-2 font-medium">Number</th><th className="px-5 py-2 font-medium">Date</th><th className="px-5 py-2 font-medium">Order</th><th className="px-5 py-2 font-medium">Buyer</th><th className="px-5 py-2 font-medium text-right">Total</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td className="px-5 py-2 num">
                      <Link className="underline" href={`/admin/orders/${d.orderId}/invoice?doc=${d.id}`}>{d.number}</Link>
                      {d.kind === "credit_note" && <span className="ml-2 pill pill-neutral">Credit note</span>}
                    </td>
                    <td className="px-5 py-2">{day.format(d.issuedAt)}</td>
                    <td className="px-5 py-2 num">#{d.orderNumber}</td>
                    <td className="px-5 py-2">{d.buyer}</td>
                    <td className="px-5 py-2 text-right num">{formatMoney(d.totalMinor, d.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}
