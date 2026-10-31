"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createPost, deletePost, draftPostWithAi, getPost, isScheduled, setPostPublished, updatePost, UserError, type PostInput } from "@sf/core";
import { agents, requireShop } from "@/lib/server";
import type { FormState } from "./actions";

/** On an error the form shows what was typed again, instead of the saved version. */
export type PostState = FormState & { values?: { title: string; handle: string; excerpt: string; body: string; imageUrl: string; productIds: string[]; published: boolean; publishAt: string } };

const typed = (form: FormData) => ({ ...(readPost(form) as Required<Omit<PostInput, "productIds">>), productIds: form.getAll("productIds").map(String), published: form.get("published") === "on", publishAt: String(form.get("publishAt") ?? "") });

/** "Publish on": an exact time from the browser, which read it in the merchant's own time zone. */
const publishAt = (form: FormData) => {
  const v = String(form.get("publishAt") ?? "");
  return v ? new Date(v) : null;
};

const readPost = (form: FormData): PostInput => ({
  title: String(form.get("title") ?? ""),
  handle: String(form.get("handle") ?? ""),
  excerpt: String(form.get("excerpt") ?? ""),
  body: String(form.get("body") ?? ""),
  imageUrl: String(form.get("imageUrl") ?? ""),
  productIds: form.getAll("productIds").map(String),
});

function refresh(handle: string) {
  revalidatePath(`/s/${handle}`, "layout");
  revalidatePath("/admin/blog");
}

async function attempt<T>(fn: () => Promise<T>): Promise<{ error: string } | { ok: T }> {
  try {
    return { ok: await fn() };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export async function createPostAction(_: PostState, form: FormData): Promise<PostState> {
  const { shop, db } = await requireShop("pages");
  const r = await attempt(() => createPost(db, shop.id, readPost(form), { published: form.get("published") === "on", publishAt: publishAt(form) }));
  if ("error" in r) return { ...r, values: typed(form) };
  refresh(shop.handle);
  redirect(`/admin/blog/${r.ok.id}?saved=1`);
}

export async function updatePostAction(id: string, _: PostState, form: FormData): Promise<PostState> {
  const { shop, db } = await requireShop("pages");
  const r = await attempt(async () => {
    await updatePost(db, shop.id, id, readPost(form));
    const wanted = form.get("published") === "on";
    const post = await getPost(db, shop.id, id);
    const at = publishAt(form);
    // Publishing, unpublishing, or moving (or clearing) the time of a post that's waiting.
    if (wanted !== (post.status === "published") || (wanted && (at !== null || isScheduled(post)) && at?.getTime() !== post.publishedAt?.getTime()))
      await setPostPublished(db, shop.id, id, wanted, new Date(), at);
  });
  if ("error" in r) return { ...r, values: typed(form) };
  refresh(shop.handle);
  return { saved: true };
}

export async function deletePostAction(id: string) {
  const { shop, db } = await requireShop("pages");
  await deletePost(db, shop.id, id);
  refresh(shop.handle);
  redirect("/admin/blog");
}

/** The AI writer drafts a post; the merchant lands on it to read, edit and publish. */
export async function draftPostAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop } = await requireShop("pages");
  const ctx = await agents();
  const r = await attempt(() => draftPostWithAi(ctx, shop, { topic: String(form.get("topic") ?? ""), productIds: form.getAll("productIds").map(String) }));
  if ("error" in r) return r;
  revalidatePath("/admin", "layout");
  if (r.ok.status === "over_budget") return { error: "This month's AI budget is used up. You can raise it in AI settings." };
  if (!r.ok.postId) return { error: r.ok.error ?? "The writer couldn't finish a draft. Try again, or a more specific topic." };
  redirect(`/admin/blog/${r.ok.postId}?drafted=1`);
}
