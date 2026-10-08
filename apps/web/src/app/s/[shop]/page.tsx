import Link from "next/link";
import { listActiveProducts } from "@sf/core";
import { Price } from "@/components/Price";
import { db } from "@/lib/server";
import { loadShop } from "./data";

export default async function StoreHome({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: handle } = await params;
  const shop = await loadShop(handle);
  const products = await listActiveProducts(await db(), shop.id);
  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-8">
      <h1 className="text-3xl font-bold tracking-tight">Shop all</h1>
      {products.length === 0 ? (
        <p className="hint">New products are on the way. Check back soon.</p>
      ) : (
        <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
          {products.map((p) => {
            const v = p.variants[0];
            return (
              <li key={p.id}>
                <Link href={`/s/${handle}/products/${p.handle}`} className="group flex flex-col gap-2">
                  <div className="aspect-square rounded-lg bg-sunken overflow-hidden">
                    {p.imageUrl && <img src={p.imageUrl} alt={p.title} className="size-full object-cover group-hover:scale-[1.02] transition-transform" />}
                  </div>
                  <span className="font-medium group-hover:underline">{p.title}</span>
                  {v && <Price minor={v.priceMinor} compareAt={v.compareAtMinor} currency={shop.currency} />}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
