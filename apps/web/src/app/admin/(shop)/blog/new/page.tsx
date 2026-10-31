import Link from "next/link";
import { listActiveProducts } from "@sf/core";
import { requireShop } from "@/lib/server";
import { createPostAction } from "../../../blog-actions";
import { PageHeader } from "../../PageHeader";
import { PostForm } from "../PostForm";

export const metadata = { title: "New post" };

export default async function NewPostPage() {
  const { shop, db } = await requireShop("pages");
  const products = await listActiveProducts(db, shop.id);
  return (
    <main className="pb-12">
      <PageHeader title="New post" back={<Link href="/admin/blog" className="hint hover:text-ink">← Blog</Link>} />
      <div className="px-4 sm:px-8">
        <PostForm action={createPostAction} submitLabel="Save post" products={products.map((p) => ({ id: p.id, title: p.title }))}
          initial={{ title: "", handle: "", excerpt: "", body: "", imageUrl: "", productIds: [], tags: "", published: false, publishAt: "" }} />
      </div>
    </main>
  );
}
