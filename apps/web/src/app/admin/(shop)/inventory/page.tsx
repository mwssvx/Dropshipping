import Link from "next/link";
import { formatMoney, inventoryReport } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";

export const metadata = { title: "Inventory" };

export default async function InventoryPage() {
  const { shop, db } = await requireShop("products");
  const { rows, totals } = await inventoryReport(db, shop);
  const money = (m: number) => formatMoney(m, shop.currency);
  return (
    <main className="pb-12">
      <PageHeader
        title="Inventory"
        actions={rows.length > 0 && <>
          <a href="/admin/inventory/inventory.csv" className="btn btn-secondary" download>Download spreadsheet</a>
          <Link href="/admin/inventory/count" className="btn btn-secondary">Count stock</Link>
          <Link href="/admin/restock/new?suggest=30" className="btn btn-secondary">Suggest a restock</Link>
          <Link href="/admin/restock/new" className="btn btn-primary">New restock order</Link>
        </>}
      />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-5xl">
        <p className="hint max-w-2xl">
          The stock you keep yourself, with what it&apos;s worth and how fast it sells. Products from a supplier aren&apos;t here: they follow the supplier&apos;s stock.
        </p>
        {rows.length === 0 ? (
          <p className="hint">Nothing counted yet. Set a stock number on a product you keep yourself to see it here.</p>
        ) : (
          <>
            <section aria-label="Totals"><dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="card p-4"><dt className="hint text-sm">In stock</dt><dd className="text-xl font-semibold num">{totals.units.toLocaleString("en")}</dd></div>
              <div className="card p-4"><dt className="hint text-sm">On the way</dt><dd className="text-xl font-semibold num">{totals.incoming.toLocaleString("en")}</dd></div>
              <div className="card p-4"><dt className="hint text-sm">Worth at cost</dt><dd className="text-xl font-semibold num">{money(totals.atCostMinor)}</dd></div>
              <div className="card p-4"><dt className="hint text-sm">Worth at your prices</dt><dd className="text-xl font-semibold num">{money(totals.atPriceMinor)}</dd></div>
            </dl></section>
            {totals.missingCost > 0 && (
              <p className="banner banner-info text-sm">
                {totals.missingCost === 1 ? "1 option has" : `${totals.missingCost} options have`} no cost, so the worth at cost leaves {totals.missingCost === 1 ? "it" : "them"} out. Add your cost on the product, or on a restock order.
              </p>
            )}
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left hint">
                    <th className="p-3 font-medium">Option</th>
                    <th className="p-3 font-medium text-right">In stock</th>
                    <th className="p-3 font-medium text-right">On the way</th>
                    <th className="p-3 font-medium text-right">Sold, 30 days</th>
                    <th className="p-3 font-medium text-right">Lasts</th>
                    <th className="p-3 font-medium text-right">Worth at cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.variantId} aria-label={r.title}>
                      <td className="p-3">
                        <Link href={`/admin/products/${r.productId}`} className="underline">{r.title}</Link>
                        {r.sku && <span className="hint"> · {r.sku}</span>}
                        {r.location && <span className="hint"> · Shelf {r.location}</span>}
                        {r.stock === 0 ? <span className="ml-2 pill pill-critical">Sold out</span> : r.low && <span className="ml-2 pill pill-warning">Running low</span>}
                      </td>
                      <td className="p-3 num text-right">{r.stock}</td>
                      <td className="p-3 num text-right">{r.incoming || "—"}</td>
                      <td className="p-3 num text-right">{r.sold}</td>
                      <td className={`p-3 num text-right ${r.daysLeft !== null && r.daysLeft < 14 ? "text-critical font-medium" : ""}`}>{r.daysLeft === null ? "—" : r.daysLeft === 1 ? "about 1 day" : `about ${r.daysLeft} days`}</td>
                      <td className="p-3 num text-right">{r.valueAtCostMinor === null ? "No cost" : money(r.valueAtCostMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
