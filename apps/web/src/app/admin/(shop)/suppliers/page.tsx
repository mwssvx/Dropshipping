import Link from "next/link";
import { listOwnSuppliers, listSupplierLinks, supplierLabel, supplierScorecard, SCORE_MIN_ORDERS, type SupplierGrade } from "@sf/core";
import { requireShop, supplierPortalUrl, suppliers } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { AddSupplierForm, OwnSupplierCard } from "./SupplierForms";

export const metadata = { title: "Suppliers" };

const GRADES: Record<SupplierGrade, { label: string; pill: string }> = {
  good: { label: "Good", pill: "pill-success" },
  watch: { label: "Watch", pill: "pill-warning" },
  poor: { label: "Poor", pill: "pill-critical" },
  too_few: { label: "Too few orders", pill: "pill-neutral" },
};
const inDays = (d: number | null) => (d == null ? "–" : `${d} ${d === 1 ? "day" : "days"}`);

export default async function SuppliersPage() {
  const { shop, db } = await requireShop("suppliers");
  const [links, own, scores] = await Promise.all([listSupplierLinks(db, shop.id), listOwnSuppliers(db, shop.id), supplierScorecard(db, shop.id)]);
  const available = suppliers().available;
  const services = [
    {
      name: "cj",
      label: "CJ Dropshipping",
      on: "Import products from CJ links. Orders are placed with the cheapest shipping option and paid from your CJ wallet.",
      off: "Connecting needs a CJ Dropshipping account and its API key. Self-serve connect arrives with accounts; for now the key is set on the server (CJ_API_KEY).",
    },
    {
      name: "aliexpress",
      label: "AliExpress",
      on: "Import products from AliExpress item links, with each option's stock and delivery time. Orders go to each seller with the cheapest delivery and are paid with the AliExpress account's saved card. AliExpress can't cancel orders for apps, so cancel those in AliExpress.",
      off: "Connecting needs an AliExpress Open Platform app and an AliExpress account that authorises it. For now they're set on the server (ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET, ALIEXPRESS_ACCESS_TOKEN).",
    },
  ].map((s) => ({ ...s, connected: available.some((a) => a.name === s.name) }));
  const demo = available.find((s) => s.name === "fake");
  const used = (name: string) => links.some((l) => l.provider === name);

  return (
    <main className="pb-12">
      <PageHeader title="Suppliers" />
      <div className="px-4 sm:px-8 flex flex-col gap-4 max-w-3xl">
        <p className="hint">When a customer pays, their order goes to the supplier of each item automatically, and tracking comes back to you and the customer.</p>
        {scores.length > 0 && (
          <section className="card flex flex-col" aria-labelledby="scores-heading">
            <div className="px-5 pt-4 pb-2">
              <h2 id="scores-heading" className="font-semibold">How your suppliers are doing</h2>
              <p className="text-sm hint">
                Your orders from the last 90 days. Shipping and arrival times are the middle order&apos;s, counted from when it was placed. Problems are
                orders that never arrived, arrived damaged, wrong or not as described, or that you replaced. Grades need {SCORE_MIN_ORDERS} orders.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="table text-sm w-full">
                <thead>
                  <tr>
                    <th scope="col">Supplier</th>
                    <th scope="col" className="num">Orders</th>
                    <th scope="col" className="num">Couldn&apos;t take</th>
                    <th scope="col" className="num">Ships in</th>
                    <th scope="col" className="num">Arrives in</th>
                    <th scope="col" className="num">Problems</th>
                    <th scope="col">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {scores.map((s) => (
                    <tr key={s.supplier.id}>
                      <td className="font-medium">{supplierLabel(suppliers(), s.supplier)}</td>
                      <td className="num">{s.orders}</td>
                      <td className="num">{s.failed} ({s.failedRate}%)</td>
                      <td className="num">{inDays(s.shipDays)}</td>
                      <td className="num">{inDays(s.deliverDays)}</td>
                      <td className="num">{s.problems} ({s.problemRate}%)</td>
                      <td><span className={`pill ${GRADES[s.grade].pill}`}>{GRADES[s.grade].label}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {scores.some((s) => s.late > 0 || ((s.grade === "poor" || s.grade === "watch") && s.productsWithoutBackup > 0)) && (
              <ul className="px-5 py-4 text-sm flex flex-col gap-1 border-t border-border" aria-label="What to do">
                {scores.map((s) => {
                  const name = supplierLabel(suppliers(), s.supplier);
                  return [
                    s.late > 0 && (
                      <li key={`${s.supplier.id}-late`}>
                        {name} hasn&apos;t shipped {s.late === 1 ? "1 order" : `${s.late} orders`} placed over a week ago.{" "}
                        <Link href="/admin/orders" className="underline">Check your orders</Link>
                      </li>
                    ),
                    (s.grade === "poor" || s.grade === "watch") && s.productsWithoutBackup > 0 && (
                      <li key={`${s.supplier.id}-backup`}>
                        {s.productsWithoutBackup === 1 ? "1 product" : `${s.productsWithoutBackup} products`} from {name} {s.productsWithoutBackup === 1 ? "has" : "have"} no backup
                        supplier. Add one on the product page so orders still go out when {name} can&apos;t take them.
                      </li>
                    ),
                  ];
                })}
              </ul>
            )}
          </section>
        )}
        {services.map((s) => (
          <section key={s.name} className="card p-5 flex flex-col gap-2" aria-label={s.label}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">{s.label}</h2>
              <span className={`pill ${s.connected ? "pill-success" : "pill-neutral"}`}>{s.connected ? "Connected" : "Not connected"}</span>
            </div>
            <p className="text-sm hint">
              {s.connected ? s.on : s.off}
              {used(s.name) ? " Some of your products use it." : ""}
            </p>
          </section>
        ))}
        <section className="flex flex-col gap-3" aria-labelledby="own-heading">
          <div className="card p-5 flex flex-col gap-3">
            <div>
              <h2 id="own-heading" className="font-semibold">Your own suppliers</h2>
              <p className="text-sm hint">
                Any wholesaler, warehouse or maker you already work with. Paid orders for their products are emailed to them with the shipping address
                (never the buyer's email), and a private link where they add tracking or tell you they can't send it. They don't need an account.
              </p>
            </div>
            <AddSupplierForm />
          </div>
          {own.length > 0 && (
            <ul className="flex flex-col gap-3">
              {own.map((s) => (
                <OwnSupplierCard key={`${s.id}-${s.name}-${s.contactEmail}`}
                  supplier={{ id: s.id, name: s.name!, email: s.contactEmail!, link: supplierPortalUrl(s.portalToken), products: s.products, openOrders: s.openOrders }} />
              ))}
            </ul>
          )}
        </section>
        {demo && (
          <section className="card p-5 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">{demo.label}</h2>
              <span className="pill pill-info">Test mode</span>
            </div>
            <p className="text-sm hint">
              A pretend supplier for trying the full flow without real orders. Products from it can't ship to real customers.
              {used("fake") ? " Some of your products use it." : ""}
            </p>
            <Link href="/admin/products/import" className="btn btn-secondary self-start">Try an import</Link>
          </section>
        )}
      </div>
    </main>
  );
}
