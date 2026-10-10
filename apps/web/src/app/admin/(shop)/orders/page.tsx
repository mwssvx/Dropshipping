import Link from "next/link";
import { formatMoney, listOrders, RISK_HOLD_LABELS } from "@sf/core";
import { requireShop } from "@/lib/server";
import { FulfilmentStatus, PaymentStatus } from "@/components/Status";
import { PageHeader } from "../PageHeader";
import { RiskHoldForm } from "./RiskHoldForm";

export const metadata = { title: "Orders" };

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams;
  const problemsOnly = show === "problems";
  const heldOnly = show === "held";
  const { shop, db } = await requireShop("orders");
  const [orders, problems, held] = await Promise.all([
    listOrders(db, shop.id, problemsOnly ? { fulfillmentStatus: "problem" } : heldOnly ? { held: true } : {}),
    listOrders(db, shop.id, { fulfillmentStatus: "problem" }),
    listOrders(db, shop.id, { held: true }),
  ]);
  const heldIds = new Set(held.map((o) => o.id));
  return (
    <main className="pb-12">
      <PageHeader title="Orders" actions={<Link href="/admin/orders/new" className="btn btn-secondary">Create payment link</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-4">
        <nav className="flex gap-1" aria-label="Order filters">
          <Link href="/admin/orders" className={`chip text-sm ${!problemsOnly && !heldOnly ? "font-semibold border-accent" : ""}`} aria-current={!problemsOnly && !heldOnly ? "page" : undefined}>All</Link>
          <Link href="/admin/orders?show=problems" className={`chip text-sm ${problemsOnly ? "font-semibold border-accent" : ""}`} aria-current={problemsOnly ? "page" : undefined}>
            Needs attention {problems.length > 0 && <span className="pill pill-critical">{problems.length}</span>}
          </Link>
          <Link href="/admin/orders?show=held" className={`chip text-sm ${heldOnly ? "font-semibold border-accent" : ""}`} aria-current={heldOnly ? "page" : undefined}>
            On hold {held.length > 0 && <span className="pill pill-warning">{held.length}</span>}
          </Link>
        </nav>
        {heldOnly && (
          <section className="card p-5 flex flex-col gap-3" aria-labelledby="risk-settings">
            <h2 id="risk-settings" className="font-semibold">Risk check</h2>
            <p className="text-sm hint max-w-2xl">Every paid order is checked for signs of a stolen card, like a throwaway email, several declined cards or an address many buyers ship to. A held order waits for you before it goes to the supplier, so you can refund it before you&apos;ve paid for the goods.</p>
            <RiskHoldForm value={shop.holdRiskyOrders} options={Object.entries(RISK_HOLD_LABELS)} />
          </section>
        )}
        {heldOnly && orders.length === 0 ? (
          <div className="card p-10 text-center hint">No orders on hold.</div>
        ) : problemsOnly && orders.length === 0 ? (
          <div className="card p-10 text-center hint">No problem orders. Anything a supplier refuses or doesn't ship on time shows up here.</div>
        ) : orders.length === 0 ? (
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
                    <td>{heldIds.has(o.id) ? <span className="pill pill-warning">On hold</span> : <FulfilmentStatus value={o.fulfillmentStatus} />}</td>
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
