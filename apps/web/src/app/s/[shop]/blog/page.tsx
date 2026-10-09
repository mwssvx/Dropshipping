import Link from "next/link";
import { listPublishedPosts, postSummary, readingMinutes } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop, storeBase } from "../data";

const date = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });

export async function generateMetadata({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: param } = await params;
  const shop = await loadShop(param);
  const base = await storeBase(param);
  return { title: "Blog", description: `Guides, ideas and news from ${shop.name}.`, alternates: { types: { "application/rss+xml": `${base}/blog/feed.xml` } } };
}

export default async function BlogIndex({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: param } = await params;
  const shop = await loadShop(param);
  const [base, posts] = await Promise.all([storeBase(param), listPublishedPosts(await db(), shop.id)]);
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-8">
      <h1 className="text-3xl font-bold tracking-tight">Blog</h1>
      {posts.length === 0 ? (
        <p className="hint">Nothing here yet. Check back soon.</p>
      ) : (
        <ul className="flex flex-col gap-8">
          {posts.map((p) => (
            <li key={p.id}>
              <article className="flex flex-col gap-2">
                {p.imageUrl && (
                  <Link href={`${base}/blog/${p.handle}`} className="sf-media block aspect-[2/1] rounded-lg bg-sunken overflow-hidden" tabIndex={-1} aria-hidden>
                    <img src={p.imageUrl} alt="" loading="lazy" className="size-full object-cover" />
                  </Link>
                )}
                <h2 className="text-xl font-semibold"><Link href={`${base}/blog/${p.handle}`} className="hover:underline">{p.title}</Link></h2>
                <p className="hint">{p.publishedAt ? date.format(p.publishedAt) : null} · {readingMinutes(p.body)} min read</p>
                <p className="text-muted">{postSummary(p)}</p>
              </article>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
