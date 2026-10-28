import Link from "next/link";
import { giftGuideTitles, listCollections } from "@sf/core";
import { createGiftGuidesAction } from "../../store-actions";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";

export const metadata = { title: "Collections" };

export default async function CollectionsPage({ searchParams }: { searchParams: Promise<{ guides?: string }> }) {
  const { shop, db } = await requireShop("collections");
  const { guides } = await searchParams;
  const collections = await listCollections(db, shop.id);
  const guideTitles = giftGuideTitles(shop.currency);
  const missingGuides = guideTitles.filter((t) => !collections.some((c) => c.title === t));
  return (
    <main className="pb-12">
      <PageHeader title="Collections" actions={<Link href="/admin/collections/new" className="btn btn-primary">Create collection</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-4">
        <p className="hint max-w-2xl">Group products so buyers can browse, like "Best sellers" or "Gifts under $30". A collection can fill itself by rules, like "under $30" or "new this month". Every store also has an "All products" collection.</p>
        {guides !== undefined && (
          <p role="status" className="banner banner-success">
            {guides === "0" ? "You already have every gift guide." : `Made ${guides === "1" ? "1 gift guide" : `${guides} gift guides`}. Show them on your home page from the theme editor, or add them to your menu.`}
          </p>
        )}
        {missingGuides.length > 0 && (
          <section id="gift-guides" className="card p-5 flex flex-wrap items-center gap-3" aria-labelledby="gift-guides-heading">
            <div className="flex-1 min-w-60">
              <h2 id="gift-guides-heading" className="font-semibold">Gift guides</h2>
              <p className="text-sm hint">
                {missingGuides.join(", ")}: collections that fill themselves with what&apos;s in stock at that price or less, best sellers first.
              </p>
            </div>
            <form action={createGiftGuidesAction}>
              <button className="btn btn-secondary">{missingGuides.length === guideTitles.length ? "Make gift guides" : `Make ${missingGuides.length === 1 ? "the last one" : "the rest"}`}</button>
            </form>
          </section>
        )}
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
                    <td><Link href={`/admin/collections/${c.id}`} className="font-medium">{c.title}</Link>{c.rules && <span className="pill pill-info ml-2">By rules</span>}</td>
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
