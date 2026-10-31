import Link from "next/link";
import { formatMoney, isScheduled, listActiveProducts, listPosts, postStats } from "@sf/core";
import { requireShop } from "@/lib/server";
import { draftPostAction } from "../../blog-actions";
import { PageHeader } from "../PageHeader";
import { DraftWithAiForm } from "./PostForm";

export const metadata = { title: "Blog" };

const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function BlogPage() {
  const { shop, db } = await requireShop("pages");
  const [posts, products] = await Promise.all([listPosts(db, shop.id), listActiveProducts(db, shop.id)]);
  const stats = await postStats(db, shop.id, posts.filter((p) => p.status === "published").map((p) => p.id));
  return (
    <main className="pb-12">
      <PageHeader title="Blog" actions={<Link href="/admin/blog/new" className="btn btn-primary">New post</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-4 max-w-4xl">
        <p className="hint">
          Posts live at /blog on your store, with the products you pick shown underneath. Helpful posts bring in visitors from search engines;
          add &ldquo;Blog&rdquo; to your menu in the theme editor. A sale counts toward the last post the buyer read before checking out.
        </p>
        <section className="card p-5 flex flex-col gap-3" aria-labelledby="ai-draft">
          <div>
            <h2 id="ai-draft" className="font-semibold">Write a first draft with AI</h2>
            <p className="text-sm hint">The writer only uses what your products say about themselves. Drafts stay hidden until you publish them.</p>
          </div>
          <DraftWithAiForm action={draftPostAction} products={products.map((p) => ({ id: p.id, title: p.title }))} />
        </section>
        {posts.length === 0 ? (
          <p className="hint">No posts yet.</p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table min-w-[640px]">
              <caption className="sr-only">Your posts, with how many visits read each one and what those visits bought in the last 30 days</caption>
              <thead><tr><th>Post</th><th>Status</th><th className="text-right">Read (30 days)</th><th className="text-right">Sales (30 days)</th><th>Last edited</th></tr></thead>
              <tbody>
                {posts.map((p) => (
                  <tr key={p.id} className="hover:bg-sunken">
                    <td>
                      <Link href={`/admin/blog/${p.id}`} className="font-medium">{p.title}</Link>
                      {p.aiGenerated && <span className="ml-2 pill pill-info">AI draft</span>}
                    </td>
                    <td>
                      {isScheduled(p) ? (
                        <span className="pill pill-info">Scheduled for {date.format(p.publishedAt!)}</span>
                      ) : p.status === "published" ? (
                        <span className="pill pill-success">Published {p.publishedAt ? date.format(p.publishedAt) : ""}</span>
                      ) : (
                        <span className="pill pill-neutral">Draft</span>
                      )}
                    </td>
                    <td className="text-right num">{stats.has(p.id) ? stats.get(p.id)!.reads : <span className="hint">–</span>}</td>
                    <td className="text-right num">
                      {stats.get(p.id)?.orders ? (
                        <>{formatMoney(stats.get(p.id)!.salesMinor, shop.currency)} <span className="hint">({stats.get(p.id)!.orders === 1 ? "1 order" : `${stats.get(p.id)!.orders} orders`})</span></>
                      ) : stats.has(p.id) ? <span className="hint">None yet</span> : <span className="hint">–</span>}
                    </td>
                    <td className="hint">{date.format(p.updatedAt)}</td>
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
