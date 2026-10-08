import Link from "next/link";
import { requireShop } from "@/lib/server";
import { createProductAction } from "../../../actions";
import { PageHeader } from "../../PageHeader";
import { ProductForm } from "../ProductForm";

export const metadata = { title: "Add product" };

export default async function NewProductPage() {
  const { shop } = await requireShop("products");
  return (
    <main className="pb-12">
      <PageHeader title="Add product" back={<Link href="/admin/products" className="hint hover:text-ink">← Products</Link>} />
      <div className="px-4 sm:px-8">
        <ProductForm action={createProductAction} currency={shop.currency} submitLabel="Save product"
          initial={{ title: "", description: "", imageUrl: "", status: "active", variants: [{ title: "Default", price: "", compareAt: "", cost: "" }] }} />
      </div>
    </main>
  );
}
