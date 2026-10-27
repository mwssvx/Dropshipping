import Link from "next/link";
import { restockChoices } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../../PageHeader";
import { StockCountForm } from "./StockCountForm";

export const metadata = { title: "Count stock" };

export default async function StockCountPage() {
  const { shop, db } = await requireShop("products");
  const choices = await restockChoices(db, shop.id);
  return (
    <main className="pb-12">
      <PageHeader title="Count stock" back={<Link href="/admin/inventory" className="hint hover:text-ink">← Inventory</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-4 max-w-4xl">
        <p className="hint max-w-2xl">
          Count what&apos;s on your shelf and type it in. Options you leave empty stay as they are. Each difference goes in the product&apos;s stock history as a stock count.
        </p>
        {choices.length === 0 ? (
          <p className="hint">Nothing to count: these are for products you keep in stock yourself.</p>
        ) : (
          <StockCountForm options={choices.map((c) => ({ variantId: c.variantId, title: c.title, sku: c.sku, barcode: c.barcode, stock: c.stock }))} />
        )}
      </div>
    </main>
  );
}
