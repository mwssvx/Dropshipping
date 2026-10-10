import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrder, invoiceDocument, NotFoundError, orderDocuments } from "@sf/core";
import { requireShop } from "@/lib/server";
import { InvoiceView } from "@/components/InvoiceView";
import { PrintButton } from "@/components/PrintButton";

export const metadata = { title: "Invoice" };

export default async function OrderInvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ doc?: string }> }) {
  const { id } = await params;
  const { doc: docId } = await searchParams;
  const { shop, db } = await requireShop("orders");
  const order = await getOrder(db, shop.id, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const docs = await orderDocuments(db, order.id);
  const pick = docs.find((d) => d.id === docId) ?? docs[0];
  return (
    <main className="px-4 sm:px-8 py-6 pb-12 flex flex-col gap-4 max-w-4xl">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <Link href={`/admin/orders/${order.id}`} className="hint hover:text-ink">← Order #{order.number}</Link>
        {pick && <PrintButton />}
      </div>
      {docs.length > 1 && (
        <nav aria-label="Documents" className="flex flex-wrap gap-2">
          {docs.map((d) => (
            <Link key={d.id} href={`?doc=${d.id}`} aria-current={d.id === pick?.id ? "page" : undefined}
              className={`btn btn-sm ${d.id === pick?.id ? "btn-primary" : "btn-secondary"}`}>
              {d.kind === "invoice" ? "Invoice" : "Credit note"} {d.number}
            </Link>
          ))}
        </nav>
      )}
      {pick ? <InvoiceView doc={await invoiceDocument(db, shop.id, pick.id)} /> : <p className="card p-5 hint">The invoice is issued once the order is paid.</p>}
    </main>
  );
}
