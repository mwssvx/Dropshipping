import Link from "next/link";
import { SEARCH_TERM_MAX } from "@sf/core";
import { requireShop, storeAddress } from "@/lib/server";
import { removeSearchFixAction } from "../../search-fix-actions";
import { PageHeader } from "../PageHeader";
import { SearchFixForm } from "./SearchFixForm";

export const metadata = { title: "Search fixes" };

export default async function SearchFixesPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { shop } = await requireShop("products");
  const { from } = await searchParams;
  const store = await storeAddress(shop);
  return (
    <main className="pb-12">
      <PageHeader title="Search fixes" back={<Link href="/admin/analytics" className="hint hover:text-ink">← Analytics</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-4 max-w-3xl">
        <p className="hint">
          When shoppers search for words your products don&apos;t use, like &quot;lampshade&quot; or a misspelling, point those words at ones that find what they
          meant. The store shows those results and says so. Words that found nothing are listed on the Analytics page.
        </p>
        <section className="card p-5" aria-label="Add a search fix">
          <SearchFixForm key={from ?? ""} from={from ?? ""} max={SEARCH_TERM_MAX} />
        </section>
        {shop.searchFixes.length > 0 && (
          <section className="card divide-y divide-border" aria-label="Your search fixes">
            {shop.searchFixes.map((f) => (
              <div key={f.from} className="p-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                <span>
                  <a href={`${store}/search?q=${encodeURIComponent(f.from)}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">{f.from}</a>
                  <span className="hint"> shows results for </span>
                  <span className="font-medium">{f.to}</span>
                </span>
                <form action={removeSearchFixAction.bind(null, f.from)}>
                  <button className="btn btn-secondary btn-sm" aria-label={`Remove the fix for “${f.from}”`}>Remove</button>
                </form>
              </div>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
