import Link from "next/link";
import { formatMoney, listCollections, listProducts, recentBulkEdits } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { BulkProducts, type BulkRow } from "./BulkProducts";
import { LowStockForm } from "./LowStockForm";

export const metadata = { title: "Products" };

export default async function ProductsPage() {
  const { shop, db } = await requireShop("products");
  const [products, collections, recent] = await Promise.all([listProducts(db, shop.id), listCollections(db, shop.id), recentBulkEdits(db, shop.id)]);
  const rows: BulkRow[] = products.map((p) => {
    const v = p.variants[0];
    return {
      id: p.id,
      title: p.title,
      imageUrl: p.imageUrl,
      status: p.status,
      price: v ? formatMoney(v.priceMinor, shop.currency) : "—",
      margin: v?.costMinor != null && v.priceMinor > 0 ? Math.round(((v.priceMinor - v.costMinor) / v.priceMinor) * 100) : null,
    };
  });
  const when = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  return (
    <main className="pb-12">
      <PageHeader title="Products" actions={<>
        <Link href="/admin/products/new" className="btn btn-secondary">Add by hand</Link>
        <Link href="/admin/products/import" className="btn btn-primary">Import from supplier</Link>
      </>} />
      <div className="px-4 sm:px-8">
        {products.length === 0 ? (
          <div className="card p-10 flex flex-col items-center text-center gap-3">
            <h2 className="font-semibold text-lg">Add your first product</h2>
            <p className="hint max-w-sm">Paste a product link from your supplier and we fill in the title, options and costs. Orders for it go to the supplier automatically.</p>
            <div className="flex gap-2 flex-wrap justify-center">
              <Link href="/admin/products/import" className="btn btn-primary">Import from supplier</Link>
              <Link href="/admin/products/new" className="btn btn-secondary">Add by hand</Link>
            </div>
            <Link href="/admin/products/move" className="text-sm underline">Moving from Shopify? Bring your products over</Link>
          </div>
        ) : (
          <BulkProducts
            rows={rows}
            collections={collections.filter((c) => !c.rules).map((c) => ({ id: c.id, title: c.title }))}
            recent={recent.map((r) => ({ id: r.id, summary: r.summary, when: when(r.createdAt), undone: !!r.undoneAt, canUndo: r.canUndo }))}
          />
        )}
        {products.length > 0 && (
          <p className="mt-4 text-sm"><Link href="/admin/products/move" className="underline">Move products from Shopify</Link></p>
        )}
        <section className="card p-5 mt-6 flex flex-col gap-3 max-w-3xl" aria-labelledby="low-stock-heading">
          <div>
            <h2 id="low-stock-heading" className="font-semibold">Few left</h2>
            <p className="hint">
              Product pages say "Only 3 left" when an option is running low, so buyers know to order soon. The number is always the real stock
              from your supplier or what you entered, never made up, and nothing shows for options without a stock count.
            </p>
          </div>
          <LowStockForm value={shop.lowStockNote} />
        </section>
      </div>
    </main>
  );
}
