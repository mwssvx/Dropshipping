import Link from "next/link";
import { seoReport, SEO_ISSUES } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";

export const metadata = { title: "Search listings" };

export default async function SeoPage() {
  const { shop, db } = await requireShop("products");
  const report = await seoReport(db, shop.id);
  return (
    <main className="pb-12">
      <PageHeader title="Search listings" />
      <div className="px-4 sm:px-8 flex flex-col gap-4 max-w-4xl">
        <p className="hint">
          How your products on sale look in Google and other search results. Supplier titles are often long and full of filler like &quot;hot sale&quot;,
          which looks spammy and gets fewer clicks. Open a product to fix its listing, or let AI rewrite its title and description.
        </p>
        {report.checked === 0 ? (
          <div className="card p-10 text-center hint">No products on sale yet.</div>
        ) : report.products.length === 0 ? (
          <div className="card p-10 text-center" role="status">All {report.checked} products on sale have a clean listing.</div>
        ) : (
          <>
            <p className="text-sm" role="status">
              {report.products.length === 1 ? "1 product needs" : `${report.products.length} products need`} a look; {report.fine} of {report.checked} are fine.
            </p>
            <ul className="card divide-y divide-border">
              {report.products.map((p) => (
                <li key={p.id} className="p-4 flex flex-col gap-2" aria-label={p.title}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{p.listing.title}</span>
                    <Link href={`/admin/products/${p.id}#seo-heading`} className="btn btn-secondary btn-sm">Fix<span className="sr-only"> {p.title}</span></Link>
                  </div>
                  {p.listing.description && <p className="text-sm hint line-clamp-2">{p.listing.description}</p>}
                  <ul className="text-sm list-disc pl-5">
                    {p.issues.map((i) => <li key={i}>{SEO_ISSUES[i]}</li>)}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        )}
        {report.undescribed.length > 0 && (
          <section className="card p-4 flex flex-col gap-2" aria-labelledby="photo-text-heading">
            <h2 id="photo-text-heading" className="font-semibold">Photos with no description</h2>
            <p className="text-sm hint">
              A sentence about what each photo shows helps your products turn up in image search, and buyers who use a screen reader hear it instead of
              just the product&apos;s name.
            </p>
            <ul className="text-sm flex flex-col gap-1">
              {report.undescribed.slice(0, 25).map((p) => (
                <li key={p.id}>
                  <Link href={`/admin/products/${p.id}#photos-heading`} className="underline">{p.title}</Link>{" "}
                  <span className="hint">({p.photos === 1 ? "1 photo" : `${p.photos} photos`})</span>
                </li>
              ))}
            </ul>
            {report.undescribed.length > 25 && <p className="text-sm hint">And {report.undescribed.length - 25} more.</p>}
          </section>
        )}
      </div>
    </main>
  );
}
