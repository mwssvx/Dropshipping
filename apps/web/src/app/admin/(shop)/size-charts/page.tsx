import Link from "next/link";
import { bundleProductChoices, listSizeCharts, MAX_SIZE_CHARTS } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { DraftForm } from "./DraftForm";

export const metadata = { title: "Size charts" };

export default async function SizeChartsPage() {
  const { shop, db } = await requireShop("products");
  const [charts, products] = await Promise.all([listSizeCharts(db, shop.id), bundleProductChoices(db, shop.id)]);
  return (
    <main className="pb-12">
      <PageHeader title="Size charts" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        <p className="hint">
          Make a size table once and attach it to products or whole collections. Buyers open it from the product page and can switch between
          centimetres and inches. Clear sizes mean fewer returns.
        </p>
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="draft-heading">
          <h2 id="draft-heading" className="font-semibold">Draft one from a product&apos;s description</h2>
          <p className="hint">The AI reads the measurements your supplier listed and lays them out as a table. It never makes numbers up, and the draft stays hidden until you check it.</p>
          {products.length ? <DraftForm products={products} /> : <p className="hint">Add a product first.</p>}
        </section>
        <section className="flex flex-col gap-3" aria-labelledby="charts-heading">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <h2 id="charts-heading" className="font-semibold">Your size charts <span className="hint num">{charts.length} of {MAX_SIZE_CHARTS}</span></h2>
            <Link href="/admin/size-charts/new" className="btn btn-primary btn-sm">New size chart</Link>
          </div>
          {charts.length === 0 && <p className="hint">None yet.</p>}
          <ul className="flex flex-col gap-3">
            {charts.map((c) => {
              const attached = c.productIds.length + c.collectionIds.length;
              return (
                <li key={c.id} className="card p-4 flex flex-wrap items-center gap-3" aria-label={c.name}>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{c.name}</p>
                    <p className="hint text-sm">
                      {c.rows.length} {c.rows.length === 1 ? "size" : "sizes"} · {c.productIds.length} {c.productIds.length === 1 ? "product" : "products"}
                      {c.collectionIds.length > 0 && `, ${c.collectionIds.length} ${c.collectionIds.length === 1 ? "collection" : "collections"}`}
                    </p>
                  </div>
                  <span className={`pill ${c.published && attached ? "pill-success" : "pill-neutral"}`}>
                    {!c.published ? "Hidden" : attached ? "On the store" : "Not attached"}
                  </span>
                  <Link href={`/admin/size-charts/${c.id}`} className="btn btn-secondary btn-sm" aria-label={`Edit ${c.name}`}>Edit</Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </main>
  );
}
