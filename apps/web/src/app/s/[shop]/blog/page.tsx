import Link from "next/link";
import { blogTopics, listPublishedPosts, postSummary, readingMinutes } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop, storeBase } from "../data";

const date = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });

export async function generateMetadata({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: param } = await params;
  const shop = await loadShop(param);
  const base = await storeBase(param);
  return { title: "Blog", description: `Guides, ideas and news from ${shop.name}.`, alternates: { types: { "application/rss+xml": `${base}/blog/feed.xml` } } };
}

export default async function BlogIndex({ params, searchParams }: { params: Promise<{ shop: string }>; searchParams: Promise<{ tag?: string }> }) {
  const { shop: param } = await params;
  const shop = await loadShop(param);
  const asked = (await searchParams).tag?.trim().slice(0, 30) || null;
  const [base, topics] = await Promise.all([storeBase(param), blogTopics(await db(), shop.id)]);
  // The topic as the store writes it; one no post has shows everything.
  const topic = asked ? topics.find((t) => t.tag.toLowerCase() === asked.toLowerCase())?.tag ?? null : null;
  const posts = await listPublishedPosts(await db(), shop.id, 50, { tag: topic });
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{topic ? `Blog: ${topic}` : "Blog"}</h1>
        {topics.length > 1 && (
          <nav aria-label="Topics">
            <ul className="flex flex-wrap gap-2 text-sm">
              <li><Link href={`${base}/blog`} aria-current={!topic ? "page" : undefined} className={`chip ${!topic ? "font-semibold" : ""}`}>All</Link></li>
              {topics.map((t) => (
                <li key={t.tag}>
                  <Link href={`${base}/blog?tag=${encodeURIComponent(t.tag)}`} aria-current={t.tag === topic ? "page" : undefined} className={`chip ${t.tag === topic ? "font-semibold" : ""}`}>
                    {t.tag} <span className="hint num">({t.count})</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
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
