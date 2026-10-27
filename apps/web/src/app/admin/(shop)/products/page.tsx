import Link from "next/link";
import { formatMoney, listCollections, listProducts, recentBulkEdits, runningLow, soldOutAtSupplier } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { BulkProducts, type BulkRow } from "./BulkProducts";
import { LowStockForm } from "./LowStockForm";
import { RestockAlertForm } from "./RestockAlertForm";
import { BadgeSettingsForm } from "./BadgeSettingsForm";
import { SoldOutForm } from "./SoldOutForm";

export const metadata = { title: "Products" };

export default async function ProductsPage() {
  const { shop, db } = await requireShop("products");
  const [products, collections, recent, soldOut, low] = await Promise.all([listProducts(db, shop.id), listCollections(db, shop.id), recentBulkEdits(db, shop.id), soldOutAtSupplier(db, shop.id), runningLow(db, shop.id)]);
  const rows: BulkRow[] = products.map((p) => {
    const v = p.variants[0];
    return {
      id: p.id,
      title: p.title,
      imageUrl: p.imageUrl,
      status: p.status,
      scheduled: p.status === "draft" && !!p.publishAt,
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
        {soldOut.length > 0 && (
          <section id="supplier-sold-out" className="card p-5 mb-6 flex flex-col gap-3 max-w-3xl scroll-mt-20" aria-labelledby="supplier-sold-out-heading">
            <div>
              <h2 id="supplier-sold-out-heading" className="font-semibold">Sold out at the supplier</h2>
              <p className="hint text-sm">
                Every option of {soldOut.length === 1 ? "this product" : "these products"} ran out at the supplier, so buyers can&apos;t order{" "}
                {soldOut.length === 1 ? "it" : "them"}. Add a backup supplier on the product page and orders go there instead, or take{" "}
                {soldOut.length === 1 ? "it" : "them"} off sale. The store sells {soldOut.length === 1 ? "it" : "them"} again by itself when the supplier restocks.
              </p>
            </div>
            <ul className="flex flex-col divide-y divide-border" aria-label="Sold out at the supplier">
              {soldOut.map((p) => (
                <li key={p.id} className="py-2 flex items-center justify-between gap-3">
                  <Link href={`/admin/products/${p.id}`} className="underline">{p.title}</Link>
                  <span className="hint text-sm">{p.hasBackup ? "Backup supplier is out too" : "No backup supplier"}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {low.length > 0 && (
          <section id="running-low" className="card p-5 mb-6 flex flex-col gap-3 max-w-3xl scroll-mt-20" aria-labelledby="running-low-heading">
            <div>
              <h2 id="running-low-heading" className="font-semibold">Running low</h2>
              <p className="hint text-sm">Your own stock with {shop.restockAlertAt} or fewer left. Enter the new count on the product page when you restock.</p>
            </div>
            <ul className="flex flex-col divide-y divide-border" aria-label="Running low">
              {low.slice(0, 50).map((r) => (
                <li key={r.variantId} className="py-2 flex items-center justify-between gap-3">
                  <Link href={`/admin/products/${r.productId}`} className="underline">{r.title}</Link>
                  <span className={`text-sm num ${r.stock === 0 ? "text-critical font-semibold" : "hint"}`}>{r.stock === 0 ? "Sold out" : `${r.stock} left`}</span>
                </li>
              ))}
            </ul>
            {low.length > 50 && <p className="hint text-sm">And {low.length - 50} more.</p>}
          </section>
        )}
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
        <section className="card p-5 mt-6 flex flex-col gap-3 max-w-3xl" aria-labelledby="restock-alert-heading">
          <div>
            <h2 id="restock-alert-heading" className="font-semibold">Running-low email</h2>
            <p className="hint">
              For products you added yourself, whose stock goes down as they sell. When an option gets down to this many, everyone who looks after
              products gets one email, and it shows under Running low at the top of this page. Imported products follow the supplier instead.
            </p>
          </div>
          <RestockAlertForm value={shop.restockAlertAt} />
        </section>
        <section className="card p-5 mt-6 flex flex-col gap-3 max-w-3xl" aria-labelledby="badges-heading">
          <div>
            <h2 id="badges-heading" className="font-semibold">Badges</h2>
            <p className="hint">
              Small labels on product cards across your store. These are worked out from your real prices, stock and dates, so they&apos;re never wrong.
              You can also give any product a badge of its own, like “Bestseller”, on its page here.
            </p>
          </div>
          <BadgeSettingsForm sale={shop.productBadges.sale} soldOut={shop.productBadges.soldOut} newDays={shop.productBadges.newDays} />
        </section>
        <section className="card p-5 mt-6 flex flex-col gap-3 max-w-3xl" aria-labelledby="sold-out-heading">
          <div>
            <h2 id="sold-out-heading" className="font-semibold">Sold-out products</h2>
            <p className="hint">
              Where products nobody can order right now go in collections, search and on your home page. Products open for pre-order count as
              available. A hidden product&apos;s own page still works, so links people saved keep working and buyers can ask to hear when it&apos;s back.
            </p>
          </div>
          <SoldOutForm value={shop.soldOutProducts} />
        </section>
      </div>
    </main>
  );
}
