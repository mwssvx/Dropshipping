import Link from "next/link";
import { getPublishedPostByHandle, NotFoundError, postBlocks, postSummary, readingMinutes } from "@sf/core";
import { db } from "@/lib/server";
import { buyerFx } from "@/lib/currency";
import { ProductGrid } from "@/theme/Sections";
import { loadShop, storeBase, missing } from "../../data";

const date = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });

async function load(param: string, handle: string, count = true) {
  const shop = await loadShop(param);
  try {
    return { shop, ...(await getPublishedPostByHandle(await db(), shop.id, handle)) };
  } catch (e) {
    if (e instanceof NotFoundError) return missing(param, `/blog/${handle}`, count);
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ shop: string; handle: string }> }) {
  const { shop, handle } = await params;
  const { post } = await load(shop, handle, false);
  const description = postSummary(post) || undefined;
  const images = post.imageUrl ? [{ url: post.imageUrl }] : undefined;
  return { title: post.title, description, openGraph: { title: post.title, description, images, type: "article", publishedTime: post.publishedAt?.toISOString() } };
}

export default async function PostPage({ params }: { params: Promise<{ shop: string; handle: string }> }) {
  const { shop: param, handle } = await params;
  const { shop, post, products } = await load(param, handle);
  const [base, fx] = await Promise.all([storeBase(param), buyerFx(shop)]);
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: postSummary(post),
    image: post.imageUrl ?? undefined,
    datePublished: post.publishedAt?.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    publisher: { "@type": "Organization", name: shop.name },
  }).replace(/</g, "\\u003c");
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <article className="flex flex-col gap-6">
        <header className="flex flex-col gap-3">
          <Link href={`${base}/blog`} className="hint hover:text-accent">← Blog</Link>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{post.title}</h1>
          <p className="hint">{post.publishedAt ? date.format(post.publishedAt) : null} · {readingMinutes(post.body)} min read</p>
          {post.tags.length > 0 && (
            <ul className="flex flex-wrap gap-2 text-sm" aria-label="Topics">
              {post.tags.map((tag) => (
                <li key={tag}><Link href={`${base}/blog?tag=${encodeURIComponent(tag)}`} className="chip hover:underline">{tag}</Link></li>
              ))}
            </ul>
          )}
        </header>
        {post.imageUrl && (
          <div className="sf-media aspect-[2/1] rounded-xl bg-sunken overflow-hidden">
            <img src={post.imageUrl} alt="" fetchPriority="high" className="size-full object-cover" />
          </div>
        )}
        <div className="flex flex-col gap-4 leading-relaxed text-[1.0625rem]">
          {postBlocks(post.body).map((b, i) =>
            b.type === "heading" ? (
              <h2 key={i} className="text-xl font-semibold pt-2">{b.text}</h2>
            ) : b.type === "list" ? (
              <ul key={i} className="list-disc pl-6 flex flex-col gap-1">{b.items.map((item, j) => <li key={j}>{item}</li>)}</ul>
            ) : (
              <p key={i} className="whitespace-pre-line">{b.text}</p>
            ),
          )}
        </div>
      </article>
      {products.length > 0 && (
        <section className="flex flex-col gap-4 border-t border-border pt-8" aria-labelledby="in-this-post">
          <h2 id="in-this-post" className="text-xl font-semibold">In this post</h2>
          <ProductGrid products={products} data={{ base, currency: shop.currency, fx, badges: shop.productBadges, catalog: { products: [], collections: [] } }} />
        </section>
      )}
    </main>
  );
}
