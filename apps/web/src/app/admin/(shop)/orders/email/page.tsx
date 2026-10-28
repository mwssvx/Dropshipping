import Link from "next/link";
import { MAX_BULK_ORDERS } from "@sf/core";
import { requireShop } from "@/lib/server";
import { OrderUpdateForm } from "./OrderUpdateForm";

export const metadata = { title: "Email the buyers" };

/** Writing one update to the buyers of the orders picked on the list. */
export default async function EmailBuyersPage({ searchParams }: { searchParams: Promise<{ ids?: string; back?: string }> }) {
  const { ids, back = "" } = await searchParams;
  const { shop, db } = await requireShop("orders");
  const picked = (ids ?? "").split(",").filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, MAX_BULK_ORDERS);
  const orders = picked.length
    ? await db.query.orders.findMany({
        where: (o, { and, eq, inArray }) => and(eq(o.shopId, shop.id), inArray(o.id, picked)),
        columns: { id: true, number: true, email: true, paidAt: true, paymentStatus: true, shippingAddress: true },
        orderBy: (o, { asc }) => asc(o.number),
      })
    : [];
  const gets = orders.filter((o) => o.paidAt && ["paid", "partially_refunded"].includes(o.paymentStatus));
  const skipped = orders.length - gets.length;
  return (
    <main className="px-4 sm:px-8 py-6 pb-12 flex flex-col gap-4 max-w-3xl">
      <Link href={`/admin/orders${back ? `?${back}` : ""}`} className="hint hover:text-ink">← Orders</Link>
      <h1 className="text-2xl font-bold tracking-tight">Email the buyers</h1>
      <p className="hint">
        Tell buyers what&apos;s going on in your own words: a supplier running late, a missing item on its way, or a week off. Each gets the update
        greeted by name, with their order number and a link to it, and it shows on the order&apos;s timeline.
      </p>
      {orders.length === 0 ? (
        <div className="card p-10 text-center hint">None of the picked orders were found. Go back and tick some orders first.</div>
      ) : (
        <>
          <section className="card p-5 flex flex-col gap-2 text-sm" aria-labelledby="update-to">
            <h2 id="update-to" className="font-semibold">{gets.length === 1 ? "1 buyer gets it" : `${gets.length} buyers get it`}</h2>
            <p className="hint">{gets.map((o) => `#${o.number} ${o.shippingAddress.name}`).join(", ") || "No one: none of these orders are paid."}</p>
            {skipped > 0 && <p className="hint">{skipped === 1 ? "1 order is" : `${skipped} orders are`} left out because {skipped === 1 ? "it isn't" : "they aren't"} paid or {skipped === 1 ? "was" : "were"} refunded.</p>}
          </section>
          {gets.length > 0 && <OrderUpdateForm ids={gets.map((o) => o.id)} back={back} shopName={shop.name} count={gets.length} />}
        </>
      )}
    </main>
  );
}
