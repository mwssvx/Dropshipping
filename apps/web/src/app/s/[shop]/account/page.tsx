import Link from "next/link";
import { buyerOrders, formatMoney } from "@sf/core";
import { currentBuyer } from "@/lib/buyer";
import { db } from "@/lib/server";
import { loadShop, storeBase } from "../data";
import { buyAgainAction, buyerSignOutAction } from "./actions";
import { SignInForm } from "./SignInForm";

export const metadata = { title: "Your account", robots: { index: false } };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  unfulfilled: "Confirmed",
  sent_to_supplier: "Being prepared",
  partially_shipped: "Partly shipped",
  shipped: "On its way",
  delivered: "Delivered",
  problem: "Being prepared",
};
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function AccountPage({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: handle } = await params;
  const shop = await loadShop(handle);
  const base = await storeBase(handle);
  const buyer = await currentBuyer(shop.id);

  if (!buyer) {
    return (
      <main className="max-w-md mx-auto px-4 sm:px-6 py-12 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Your orders</h1>
          <p className="text-muted">Sign in to see your orders from {shop.name}, track them, and check out faster next time.</p>
        </div>
        <div className="card p-6"><SignInForm handle={handle} /></div>
      </main>
    );
  }

  const orders = await buyerOrders(await db(), shop.id, buyer.email);
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight">Your orders</h1>
          <p className="text-muted">Signed in as {buyer.email}</p>
        </div>
        <form action={buyerSignOutAction.bind(null, handle)}><button className="btn btn-secondary">Sign out</button></form>
      </div>
      {orders.length === 0 ? (
        <div className="card p-6 flex flex-col gap-3 items-start">
          <p>No orders with this email yet.</p>
          <Link href={base || "/"} className="btn btn-primary">Start shopping</Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {orders.map((o) => (
            <li key={o.id} className="card p-5 flex flex-col gap-3" aria-label={`Order #${o.number}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold num">Order #{o.number}</span>
                <span className="hint">{date.format(o.paidAt)}</span>
              </div>
              <p className="text-sm">{o.items.map((i) => `${i.title}${i.quantity > 1 ? ` × ${i.quantity}` : ""}`).join(", ")}</p>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-3 text-sm">
                  <span className="pill pill-neutral">{o.paymentStatus === "refunded" ? "Refunded" : STATUS[o.fulfillmentStatus]}</span>
                  <span className="num">{formatMoney(o.totalMinor - o.refundedMinor, o.currency)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Link href={`${base}/orders/${o.ref}`} className="btn btn-secondary">Track</Link>
                  <form action={buyAgainAction.bind(null, handle, o.id)}><button className="btn btn-primary" aria-label={`Buy order #${o.number} again`}>Buy again</button></form>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
