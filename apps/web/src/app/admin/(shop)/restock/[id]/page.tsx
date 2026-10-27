import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney, getRestockOrder, NotFoundError } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../../PageHeader";
import { CancelRestockButton, ReceiveForm } from "../RestockForms";

export const metadata = { title: "Restock order" };

const day = (d: Date | string) => new Date(typeof d === "string" ? `${d}T12:00:00Z` : d).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });

export default async function RestockOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { id } = await params;
  const { created } = await searchParams;
  const { shop, db } = await requireShop("products");
  const order = await getRestockOrder(db, shop.id, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const money = (m: number) => formatMoney(m, shop.currency);
  return (
    <main className="pb-12">
      <PageHeader title={`Restock #${order.number}`} back={<Link href="/admin/restock" className="hint hover:text-ink">← Restock orders</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        {created && <p className="banner banner-success" role="status">Saved. Receive it here when it arrives.</p>}
        <section className="card p-5 flex flex-col gap-1" aria-label="Details">
          <p><span className="font-medium">{order.supplierName}</span> <span className="hint">· ordered {day(order.createdAt)}</span></p>
          {order.status === "open" && order.expectedOn && <p className="hint">Expected by {day(order.expectedOn)}</p>}
          {order.status === "received" && order.receivedAt && <p className="text-success">Everything arrived on {day(order.receivedAt)}</p>}
          {order.status === "cancelled" && <p className="hint">Cancelled{order.cancelledAt ? ` on ${day(order.cancelledAt)}` : ""}</p>}
          {order.note && <p className="hint whitespace-pre-line">{order.note}</p>}
        </section>
        <section className="card overflow-x-auto" aria-label="Lines">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left hint">
                <th className="p-3 font-medium">Option</th>
                <th className="p-3 font-medium text-right">Ordered</th>
                <th className="p-3 font-medium text-right">Arrived</th>
                <th className="p-3 font-medium text-right">Cost each</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {order.lines.map((l) => (
                <tr key={l.id}>
                  <td className="p-3">{l.productId ? <Link href={`/admin/products/${l.productId}`} className="underline">{l.title}</Link> : l.title}</td>
                  <td className="p-3 num text-right">{l.quantity}</td>
                  <td className="p-3 num text-right">{l.receivedQuantity}</td>
                  <td className="p-3 num text-right">{l.unitCostMinor === null ? "—" : money(l.unitCostMinor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-medium">
                <td className="p-3">Total</td>
                <td className="p-3 num text-right">{order.ordered}</td>
                <td className="p-3 num text-right">{order.received}</td>
                <td className="p-3 num text-right">{order.costMinor ? money(order.costMinor) : "—"}</td>
              </tr>
            </tfoot>
          </table>
        </section>
        {order.status === "open" && (
          <>
            <section className="card p-5 flex flex-col gap-3" aria-labelledby="receive-heading">
              <div>
                <h2 id="receive-heading" className="font-semibold">It arrived</h2>
                <p className="hint">Check what&apos;s in the parcel. If only part came, change the numbers and receive the rest later.</p>
              </div>
              <ReceiveForm restockId={order.id} lines={order.lines} />
            </section>
            <CancelRestockButton restockId={order.id} />
          </>
        )}
      </div>
    </main>
  );
}
