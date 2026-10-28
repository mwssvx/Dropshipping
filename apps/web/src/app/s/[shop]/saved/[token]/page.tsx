import Link from "next/link";
import { notFound } from "next/navigation";
import { sharedSaved } from "@sf/core";
import { Price } from "@/components/Price";
import { buyerFx } from "@/lib/currency";
import { db } from "@/lib/server";
import { loadShop, localProducts, storeBase, storeT } from "../../data";

// A buyer's saved list, opened from the link they shared. Not for search engines.
export const metadata = { title: "Saved items", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function SharedSavedPage({ params }: { params: Promise<{ shop: string; token: string }> }) {
  const { shop: handle, token } = await params;
  const shop = await loadShop(handle);
  const list = await sharedSaved(await db(), shop.id, token);
  if (!list) notFound();
  const [base, fx, t] = await Promise.all([storeBase(handle), buyerFx(shop), storeT(handle)]);
  const items = await localProducts(handle, list.items);

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">{t.sharedTitle(list.firstName)}</h1>
        <p className="text-muted">{items.length ? t.sharedNote : t.sharedEmpty}</p>
      </div>
      {items.length > 0 && (
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {items.map((item) => (
            <li key={item.id} className="py-4 flex items-center gap-4">
              <Link href={`${base}/products/${item.handle}`} className="sf-media size-20 rounded-lg bg-sunken overflow-hidden shrink-0">
                {item.imageUrl && <img src={item.imageUrl} alt="" className="size-full object-cover" />}
              </Link>
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <Link href={`${base}/products/${item.handle}`} className="font-medium hover:underline">{item.title}</Link>
                <span className="num">
                  <Price minor={item.priceMinor} currency={shop.currency} fx={fx} />
                  {item.soldOut && <> <span className="pill pill-neutral ml-1">{t.soldOut}</span></>}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
