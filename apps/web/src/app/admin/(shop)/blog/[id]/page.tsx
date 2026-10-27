import Link from "next/link";
import { notFound } from "next/navigation";
import { getPost, NotFoundError, productChoices } from "@sf/core";
import { requireShop, storeAddress } from "@/lib/server";
import { deletePostAction, updatePostAction } from "../../../blog-actions";
import { PageHeader } from "../../PageHeader";
import { PostForm } from "../PostForm";

export const metadata = { title: "Post" };

export default async function EditPostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; drafted?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const { shop, db } = await requireShop("pages");
  const post = await getPost(db, shop.id, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [products, address] = await Promise.all([productChoices(db, shop.id), storeAddress(shop)]);
  // Featured products that went off sale stay listed (and ticked), so saving doesn't drop them.
  const choices = products
    .filter((p) => p.status === "active" || post.productIds.includes(p.id))
    .map((p) => ({ id: p.id, title: p.status === "active" ? p.title : `${p.title} (not on sale)` }));
  return (
    <main className="pb-12">
      <PageHeader title={post.title} back={<Link href="/admin/blog" className="hint hover:text-ink">← Blog</Link>}
        actions={post.status === "published" ? <a href={`${address}/blog/${post.handle}`} target="_blank" className="btn btn-secondary">View ↗</a> : undefined} />
      <div className="px-4 sm:px-8 flex flex-col gap-6">
        <PostForm action={updatePostAction.bind(null, post.id)} submitLabel="Save" saved={query.saved === "1"} drafted={query.drafted === "1"} products={choices}
          initial={{ title: post.title, handle: post.handle, excerpt: post.excerpt ?? "", body: post.body, imageUrl: post.imageUrl ?? "", productIds: post.productIds, published: post.status === "published" }} />
        <form action={deletePostAction.bind(null, post.id)}>
          <button className="text-sm text-critical hover:underline">Delete this post</button>
        </form>
      </div>
    </main>
  );
}
