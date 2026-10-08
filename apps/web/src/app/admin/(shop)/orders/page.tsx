import Link from "next/link";
import { formatMoney, listOrders } from "@sf/core";
import { requireShop } from "@/lib/server";
import { FulfilmentStatus, PaymentStatus } from "@/components/Status";
import { PageHeader } from "../PageHeader";

export const metadata = { title: "Orders" };

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function OrdersPage() {
  const { shop, db } = await requireShop();
  const orders = await listOrders(db, shop.id);
  return (
    <main className="pb-12">
      <PageHeader title="Orders" />
      <div className="px-4 sm:px-8">
        {orders.length === 0 ? (
          <div className="card p-10 flex flex-col items-center text-center gap-3">
            <h2 className="font-semibold text-lg">No orders yet</h2>
            <p className="hint max-w-sm">When a buyer checks out, the order shows up here with its payment and delivery status.</p>
            <a href={`/s/${shop.handle}`} target="_blank" className="btn btn-secondary">Visit your store ↗</a>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table min-w-[680px]">
              <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Payment</th><th>Delivery</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-sunken">
                    <td><Link href={`/admin/orders/${o.id}`} className="font-semibold num">#{o.number}</Link></td>
                    <td className="hint num">{dateFmt.format(o.createdAt)}</td>
                    <td className="truncate max-w-[200px]">{o.shippingAddress.name}</td>
                    <td><PaymentStatus value={o.paymentStatus} /></td>
                    <td><FulfilmentStatus value={o.fulfillmentStatus} /></td>
                    <td className="text-right num">{formatMoney(o.totalMinor, o.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
