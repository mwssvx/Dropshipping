import Link from "next/link";
import { bundleProductChoices, listCollections } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../../PageHeader";
import { SizeChartForm } from "../SizeChartForm";

export const metadata = { title: "New size chart" };

export default async function NewSizeChartPage() {
  const { shop, db } = await requireShop("products");
  const [products, collections] = await Promise.all([bundleProductChoices(db, shop.id), listCollections(db, shop.id)]);
  return (
    <main className="pb-12">
      <PageHeader title="New size chart" back={<Link href="/admin/size-charts" className="hint hover:text-ink">← Size charts</Link>} />
      <div className="px-4 sm:px-8 max-w-4xl">
        <SizeChartForm chart={null} products={products} collections={collections.map((c) => ({ id: c.id, title: c.title }))} />
      </div>
    </main>
  );
}
