import Link from "next/link";
import { notFound } from "next/navigation";
import { customsDeclaration, formatMoney, formatWeight, NotFoundError } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PrintButton } from "@/components/PrintButton";
import { countryNames } from "@/lib/store-text";

export const metadata = { title: "Customs declaration" };

const country = countryNames("en");

/** A customs declaration to print and stick on a parcel going to another country. */
export default async function CustomsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { shop, db } = await requireShop("orders");
  const form = await customsDeclaration(db, shop.id, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const money = (minor: number) => formatMoney(minor, form.currency);
  const a = form.to;
  return (
    <main className="px-4 sm:px-8 py-6 pb-12 flex flex-col gap-4 max-w-4xl">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <Link href={`/admin/orders/${form.orderId}`} className="hint hover:text-ink">← Order #{form.number}</Link>
        <PrintButton>Print customs form</PrintButton>
      </div>
      <h1 className="sr-only">Customs declaration for order #{form.number}</h1>
      {!form.crossesBorder && <p className="banner" role="note">This order stays in {country(form.from.country, form.from.country)}, so it doesn&apos;t need a customs form.</p>}
      {form.missing.length > 0 && (
        <div className="banner banner-warning" role="alert">
          Add the HS code and the country it was made in for {form.missing.join(", ")} on the product page. Customs can hold a parcel without them.
        </div>
      )}
      <div className="print-sheets flex flex-col">
        <article className="card p-6 sm:p-10 flex flex-col gap-6 text-sm" aria-label={`Customs declaration for order #${form.number}`}>
          <header className="flex flex-col sm:flex-row sm:justify-between gap-4">
            <h2 className="text-xl font-bold tracking-tight">Customs declaration</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted">Order</dt><dd className="num font-semibold">#{form.number}</dd>
              <dt className="text-muted">Contents</dt><dd>{form.kind === "gift" ? "Gift" : "Sale of goods"}</dd>
            </dl>
          </header>
          <div className="grid sm:grid-cols-2 gap-6">
            <section aria-label="From">
              <h3 className="font-semibold mb-1">From</h3>
              <p>{form.from.name}</p>
              {form.from.address ? <p className="whitespace-pre-line">{form.from.address}</p> : <p className="no-print text-muted">Add the store&apos;s mailing address in Settings.</p>}
              <p>{country(form.from.country, form.from.country)}</p>
            </section>
            {a && (
              <section aria-label="To">
                <h3 className="font-semibold mb-1">To</h3>
                <p>{a.name}</p>
                <p>{a.line1}</p>
                {a.line2 && <p>{a.line2}</p>}
                <p>{a.city}{a.region ? `, ${a.region}` : ""} {a.postalCode}</p>
                <p>{country(a.country, a.country)}</p>
                {a.phone && <p className="num">{a.phone}</p>}
              </section>
            )}
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-left border-b border-border">
                <th className="py-2">What it is</th>
                <th className="py-2">HS code</th>
                <th className="py-2">Made in</th>
                <th className="py-2 text-right">Quantity</th>
                <th className="py-2 text-right">Weight</th>
                <th className="py-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {form.items.map((item, i) => (
                <tr key={i} className="border-b border-border align-top">
                  <td className="py-2">{item.description}</td>
                  <td className="py-2 num">{item.hsCode ?? "–"}</td>
                  <td className="py-2">{item.originCountry ? country(item.originCountry, item.originCountry) : "–"}</td>
                  <td className="py-2 num text-right">{item.quantity}</td>
                  <td className="py-2 num text-right">{item.weightGrams !== null ? formatWeight(item.weightGrams) : "–"}</td>
                  <td className="py-2 num text-right">{money(item.valueMinor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="py-2 text-left" colSpan={4}>Total</th>
                <td className="py-2 num text-right font-semibold">{form.totalWeightGrams !== null ? formatWeight(form.totalWeightGrams) : "–"}</td>
                <td className="py-2 num text-right font-semibold">{money(form.totalValueMinor)}</td>
              </tr>
              <tr>
                <th scope="row" className="py-1 text-left text-muted font-normal" colSpan={5}>Postage paid by the buyer</th>
                <td className="py-1 num text-right text-muted">{money(form.shippingMinor)}</td>
              </tr>
            </tfoot>
          </table>
          <footer className="flex flex-col gap-6 border-t border-border pt-4">
            <p>I certify that the details given in this declaration are correct and that this parcel holds no dangerous or prohibited items.</p>
            <div className="grid grid-cols-2 gap-6">
              <p className="border-b border-ink pb-6">Signature</p>
              <p className="border-b border-ink pb-6">Date</p>
            </div>
          </footer>
        </article>
      </div>
    </main>
  );
}
