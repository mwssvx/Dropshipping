import Link from "next/link";
import { formatMoney, listRestockOrders } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";

export const metadata = { title: "Restock orders" };

const STATUS = { open: ["On the way", "pill-warning"], received: ["Arrived", "pill-success"], cancelled: ["Cancelled", "pill-neutral"] } as const;

export default async function RestockPage() {
  const { shop, db } = await requireShop("products");
  const orders = await listRestockOrders(db, shop.id);
  return (
    <main className="pb-12">
      <PageHeader title="Restock orders" actions={<Link href="/admin/restock/new" className="btn btn-primary">New restock order</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-4xl">
        <p className="hint max-w-2xl">
          For the stock you keep yourself: write down what you ordered from your own supplier, then receive it when the parcel comes. It goes on
          your stock count, the cost you paid becomes the product&apos;s cost, and what&apos;s still on the way shows on each product.
        </p>
        {orders.length === 0 ? (
          <p className="hint">No restock orders yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {orders.map((o) => {
              const [label, pill] = STATUS[o.status];
              return (
                <li key={o.id} className="card p-4 flex flex-wrap items-center gap-3" aria-label={`Restock #${o.number}`}>
                  <div className="flex-1 min-w-0">
                    <Link href={`/admin/restock/${o.id}`} className="font-medium underline">Restock #{o.number}</Link>
                    <span className="hint"> · {o.supplierName}</span>
                    <p className="hint text-sm num">
                      {o.received} of {o.ordered} arrived · {o.lines === 1 ? "1 option" : `${o.lines} options`}
                      {o.costMinor > 0 && <> · {formatMoney(o.costMinor, shop.currency)}</>}
                      {o.status === "open" && o.expectedOn && <> · expected {new Date(`${o.expectedOn}T12:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric" })}</>}
                    </p>
                  </div>
                  <span className={`pill ${pill}`}>{label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
