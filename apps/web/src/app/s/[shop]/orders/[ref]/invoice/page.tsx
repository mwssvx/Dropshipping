import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrderByPaymentIntent, invoiceDocument, NotFoundError, orderDocuments } from "@sf/core";
import { db } from "@/lib/server";
import { InvoiceView } from "@/components/InvoiceView";
import { PrintButton } from "@/components/PrintButton";
import { loadShop, storeBase } from "../../../data";

export const metadata = { title: "Invoice", robots: { index: false } };

export default async function BuyerInvoicePage({ params, searchParams }: { params: Promise<{ shop: string; ref: string }>; searchParams: Promise<{ doc?: string }> }) {
  const { shop: handle, ref } = await params;
  const { doc: docId } = await searchParams;
  const shop = await loadShop(handle);
  const order = await getOrderByPaymentIntent(await db(), shop.id, ref).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const docs = await orderDocuments(await db(), order.id);
  const pick = docs.find((d) => d.id === docId) ?? docs[0];
  if (!pick) notFound();
  const base = await storeBase(handle);
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <Link href={`${base}/orders/${ref}`} className="text-sm underline">Back to your order</Link>
        <PrintButton />
      </div>
      {docs.length > 1 && (
        <nav aria-label="Documents" className="flex flex-wrap gap-2">
          {docs.map((d) => (
            <a key={d.id} href={`?doc=${d.id}`} aria-current={d.id === pick.id ? "page" : undefined}
              className={`btn btn-sm ${d.id === pick.id ? "btn-primary" : "btn-secondary"}`}>
              {d.kind === "invoice" ? "Invoice" : "Credit note"} {d.number}
            </a>
          ))}
        </nav>
      )}
      <InvoiceView doc={await invoiceDocument(await db(), shop.id, pick.id)} />
    </main>
  );
}
