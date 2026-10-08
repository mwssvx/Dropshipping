import Link from "next/link";
import { listCollections } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";

export const metadata = { title: "Collections" };

export default async function CollectionsPage() {
  const { shop, db } = await requireShop();
  const collections = await listCollections(db, shop.id);
  return (
    <main className="pb-12">
      <PageHeader title="Collections" actions={<Link href="/admin/collections/new" className="btn btn-primary">Create collection</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-4">
        <p className="hint max-w-2xl">Group products so buyers can browse, like "Best sellers" or "Gifts under $30". Every store also has an automatic "All products" collection.</p>
        {collections.length === 0 ? (
          <div className="card p-10 flex flex-col items-center text-center gap-3">
            <h2 className="font-semibold text-lg">No collections yet</h2>
            <p className="hint max-w-sm">Create one, then show it on your home page from the theme editor.</p>
            <Link href="/admin/collections/new" className="btn btn-primary">Create collection</Link>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table min-w-[480px]">
              <thead><tr><th>Collection</th><th>Address</th><th className="text-right">Products</th></tr></thead>
              <tbody>
                {collections.map((c) => (
                  <tr key={c.id} className="hover:bg-sunken">
                    <td><Link href={`/admin/collections/${c.id}`} className="font-medium">{c.title}</Link></td>
                    <td className="hint">/collections/{c.handle}</td>
                    <td className="text-right num">{c.productCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
