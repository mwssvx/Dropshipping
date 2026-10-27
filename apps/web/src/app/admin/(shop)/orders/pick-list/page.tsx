import Link from "next/link";
import { pickList } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PrintButton } from "@/components/PrintButton";

export const metadata = { title: "Pick list" };

/** Everything the orders waiting to ship need off the shelf, added up per option. */
export default async function PickListPage() {
  const { shop, db } = await requireShop("orders");
  const { items, orders, fromSuppliers } = await pickList(db, shop.id);
  const total = items.reduce((n, i) => n + i.quantity, 0);
  return (
    <main className="px-4 sm:px-8 py-6 pb-12 flex flex-col gap-4 max-w-4xl">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <Link href="/admin/orders/packing-slips" className="hint hover:text-ink">← Packing slips</Link>
        {items.length > 0 && <PrintButton>Print pick list</PrintButton>}
      </div>
      <h1 className="text-2xl font-bold tracking-tight">Pick list</h1>
      <p className="hint max-w-2xl">
        Walk the shelf once: each option the orders waiting to ship need, how many in all, and which orders they go in. In shelf order, then by SKU. &quot;Left after&quot; is your stock once these are picked; below 0 means you&apos;re short.
      </p>
      {fromSuppliers > 0 && <p className="text-sm" role="note">{fromSuppliers} {fromSuppliers === 1 ? "item ships" : "items ship"} straight from your suppliers, so {fromSuppliers === 1 ? "it isn't" : "they aren't"} on the list.</p>}
      {items.length === 0 ? (
        <div className="card p-10 text-center hint">Nothing to pick: no orders of your own stock are waiting to ship.</div>
      ) : (
        <div className="print-sheets flex flex-col">
          <article className="card p-6 sm:p-8 flex flex-col gap-4 text-sm" aria-label="Pick list">
            <p className="num">{orders} {orders === 1 ? "order" : "orders"} · {total} {total === 1 ? "item" : "items"}</p>
            <table className="w-full">
              <thead>
                <tr className="text-left border-b border-border">
                  <th className="py-2 w-10" aria-label="Picked"></th>
                  <th className="py-2">Shelf</th>
                  <th className="py-2">Item</th>
                  <th className="py-2">SKU</th>
                  <th className="py-2 text-right">Quantity</th>
                  <th className="py-2 text-right">Left after</th>
                  <th className="py-2 pl-4">Orders</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.key} className="border-b border-border align-top">
                    <td className="py-2"><span className="inline-block size-4 border border-ink rounded-sm" aria-hidden /></td>
                    <td className="py-2 font-semibold">{i.location ?? "–"}</td>
                    <td className="py-2">{i.title}{i.barcode && <span className="block text-muted num">{i.barcode}</span>}</td>
                    <td className="py-2 num text-muted">{i.sku ?? "–"}</td>
                    <td className="py-2 num text-right font-semibold">{i.quantity}</td>
                    <td className={`py-2 num text-right ${i.stock !== null && i.stock < 0 ? "text-critical font-semibold" : ""}`}>{i.stock ?? "–"}</td>
                    <td className="py-2 pl-4 num text-muted">{i.orders.map((n) => `#${n}`).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </div>
      )}
    </main>
  );
}
