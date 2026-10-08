import Link from "next/link";
import { formatMoney, listProducts } from "@sf/core";
import { requireShop } from "@/lib/server";
import { ProductStatus } from "@/components/Status";
import { PageHeader } from "../PageHeader";

export const metadata = { title: "Products" };

export default async function ProductsPage() {
  const { shop, db } = await requireShop();
  const products = await listProducts(db, shop.id);
  return (
    <main className="pb-12">
      <PageHeader title="Products" actions={<Link href="/admin/products/new" className="btn btn-primary">Add product</Link>} />
      <div className="px-4 sm:px-8">
        {products.length === 0 ? (
          <div className="card p-10 flex flex-col items-center text-center gap-3">
            <h2 className="font-semibold text-lg">Add your first product</h2>
            <p className="hint max-w-sm">Add one by hand now. Importing from your supplier with one link is coming next.</p>
            <Link href="/admin/products/new" className="btn btn-primary">Add product</Link>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table min-w-[560px]">
              <thead><tr><th>Product</th><th>Status</th><th className="text-right">Price</th><th className="text-right">Margin</th></tr></thead>
              <tbody>
                {products.map((p) => {
                  const v = p.variants[0];
                  const margin = v?.costMinor != null && v.priceMinor > 0 ? Math.round(((v.priceMinor - v.costMinor) / v.priceMinor) * 100) : null;
                  return (
                    <tr key={p.id} className="hover:bg-sunken">
                      <td>
                        <Link href={`/admin/products/${p.id}`} className="flex items-center gap-3 font-medium">
                          {p.imageUrl ? <img src={p.imageUrl} alt="" className="size-10 rounded-md object-cover bg-sunken" /> : <span className="size-10 rounded-md bg-sunken" />}
                          {p.title}
                        </Link>
                      </td>
                      <td><ProductStatus value={p.status} /></td>
                      <td className="text-right num">{v ? formatMoney(v.priceMinor, shop.currency) : "—"}</td>
                      <td className="text-right num">{margin === null ? <span className="hint">—</span> : `${margin}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
