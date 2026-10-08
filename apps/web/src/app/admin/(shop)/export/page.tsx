import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { ImportForm } from "./ImportForm";

export const metadata = { title: "Export and import" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function ExportPage({ searchParams }: { searchParams: Promise<{ loaded?: string; currency?: string }> }) {
  const { shop, db } = await requireShop();
  const { loaded, currency } = await searchParams;
  const [product, collection, page] = await Promise.all([
    db.query.products.findFirst({ where: (p, { eq }) => eq(p.shopId, shop.id), columns: { id: true } }),
    db.query.collections.findFirst({ where: (c, { eq }) => eq(c.shopId, shop.id), columns: { id: true } }),
    db.query.pages.findFirst({ where: (p, { eq }) => eq(p.shopId, shop.id), columns: { id: true } }),
  ]);
  const empty = !product && !collection && !page;
  const summary = loaded
    ? await Promise.all([
        db.query.products.findMany({ where: (x, { eq }) => eq(x.shopId, shop.id), columns: { id: true } }),
        db.query.collections.findMany({ where: (x, { eq }) => eq(x.shopId, shop.id), columns: { id: true } }),
        db.query.pages.findMany({ where: (x, { eq }) => eq(x.shopId, shop.id), columns: { id: true } }),
        db.query.discounts.findMany({ where: (x, { eq }) => eq(x.shopId, shop.id), columns: { id: true } }),
      ]).then(([a, b, c, d]) => [a.length, b.length, c.length, d.length] as const)
    : null;
  return (
    <main className="pb-12">
      <PageHeader title="Export and import" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        {summary && (
          <p className="banner banner-success" role="status">
            Loaded {plural(summary[0], "product", "products")}, {plural(summary[1], "collection", "collections")}, {plural(summary[2], "page", "pages")}
            {summary[3] ? `, ${plural(summary[3], "discount code", "discount codes")}` : ""} and your theme. Check your products, then set up payouts to start selling.
            {currency && <span className="block mt-1">The file&apos;s prices were in another currency; this store sells in {shop.currency}, so check your prices.</span>}
          </p>
        )}
        <p className="hint">Your store is yours. Take a full copy whenever you like, for a backup or to move. It's free and there's no lock-in.</p>
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="export-heading">
          <h2 id="export-heading" className="font-semibold">Download your store</h2>
          <p className="text-sm">
            The store file has your products and variants, collections, pages, theme, menus, discount codes and settings. It
            loads into a new store here in one step. Orders, customers and money stay with your payments account; the Money page
            has a statement you can download.
          </p>
          <div className="flex flex-wrap gap-2">
            <a className="btn btn-primary" href="/admin/export/store.json" download>Download store file</a>
            <a className="btn btn-secondary" href="/admin/export/products.csv" download>Download products (CSV)</a>
          </div>
        </section>
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="import-heading">
          <h2 id="import-heading" className="font-semibold">Load a store file</h2>
          {empty ? (
            <>
              <p className="text-sm">This store is empty, so you can load a store file into it. Everything in the file is added, or nothing is.</p>
              <ImportForm />
            </>
          ) : (
            <p className="text-sm hint">
              Store files load into a new, empty store, so nothing here gets overwritten.{" "}
              <a className="underline" href="/admin/new-store">Create a new store</a>, then come back to this page in it.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
