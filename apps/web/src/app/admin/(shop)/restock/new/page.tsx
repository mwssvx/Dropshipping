import Link from "next/link";
import { formatMoney, restockChoices } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../../PageHeader";
import { NewRestockForm } from "../RestockForms";

export const metadata = { title: "New restock order" };

export default async function NewRestockPage() {
  const { shop, db } = await requireShop("products");
  const choices = await restockChoices(db, shop.id);
  return (
    <main className="pb-12">
      <PageHeader title="New restock order" back={<Link href="/admin/restock" className="hint hover:text-ink">← Restock orders</Link>} />
      <div className="px-4 sm:px-8 max-w-4xl">
        {choices.length === 0 ? (
          <p className="hint">Restock orders are for products you keep in stock yourself. Products from a supplier restock on their own.</p>
        ) : (
          <NewRestockForm
            currencySymbol={formatMoney(0, shop.currency).replace(/[\d.,\s]/g, "")}
            choices={choices.map((c) => ({ variantId: c.variantId, title: c.title, sku: c.sku, stock: c.stock, cost: c.costMinor === null ? "" : (c.costMinor / 100).toFixed(2) }))}
          />
        )}
      </div>
    </main>
  );
}
