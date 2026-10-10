import Link from "next/link";
import { bundleProductChoices, getSizeChart, listCollections, NotFoundError } from "@sf/core";
import { notFound } from "next/navigation";
import { requireShop } from "@/lib/server";
import { deleteSizeChartAction } from "../../../size-chart-actions";
import { PageHeader } from "../../PageHeader";
import { SizeChartForm } from "../SizeChartForm";

export const metadata = { title: "Size chart" };

export default async function SizeChartPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ drafted?: string; saved?: string }> }) {
  const { shop, db } = await requireShop("products");
  const { id } = await params;
  const query = await searchParams;
  const chart = await getSizeChart(db, shop.id, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [products, collections] = await Promise.all([bundleProductChoices(db, shop.id), listCollections(db, shop.id)]);
  return (
    <main className="pb-12">
      <PageHeader title={chart.name} back={<Link href="/admin/size-charts" className="hint hover:text-ink">← Size charts</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-4 max-w-4xl">
        {query.drafted === "1" && (
          <p role="status" className="banner banner-info">
            Drafted from the product&apos;s description. Check every number against your supplier, fill in anything empty, then tick “Show on the store”.
          </p>
        )}
        {query.saved === "1" && <p role="status" className="banner banner-info">Size chart saved.</p>}
        <SizeChartForm chart={chart} products={products} collections={collections.map((c) => ({ id: c.id, title: c.title }))} />
        <form action={deleteSizeChartAction.bind(null, chart.id)} className="border-t border-border pt-4">
          <button className="hint text-sm hover:text-critical">Delete this size chart</button>
        </form>
      </div>
    </main>
  );
}
