// The store's blog: posts that bring buyers in from search engines and point them at products.
// Bodies are plain text: blank lines split paragraphs, "## " starts a subheading and "• " a
// bullet, so nothing pasted can run in a buyer's browser. The AI writer can draft a post.
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import { uniqueHandle } from "./handles";

type Post = typeof schema.blogPosts.$inferSelect;

const postInput = z.object({
  title: z.string().trim().min(1, "Give the post a title.").max(140, "Keep the title under 140 characters."),
  handle: z
    .string()
    .trim()
    .max(80)
    .default("")
    .refine((h) => h === "" || /^[a-z0-9](-?[a-z0-9])*$/.test(h), "Post addresses use lowercase letters, numbers and dashes."),
  excerpt: z.string().trim().max(320, "Keep the summary under 320 characters.").default(""),
  body: z.string().max(60_000).default(""),
  imageUrl: z
    .string()
    .trim()
    .refine((u) => u === "" || /^https:\/\/[^\s]+$/.test(u), "The image must be an https address.")
    .default(""),
  productIds: z.array(z.string().uuid()).max(8, "Feature up to 8 products.").default([]),
});
export type PostInput = z.input<typeof postInput>;

async function parse(db: Db, shopId: string, input: PostInput, exceptId?: string) {
  const parsed = postInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { handle, excerpt, imageUrl, productIds, ...rest } = parsed.data;
  if (/<[a-z/][^>]*>/i.test(rest.body)) throw new UserError("Write the post as plain text, without HTML tags.");
  const ids = [...new Set(productIds)];
  if (ids.length) {
    const owned = await db.select({ id: schema.products.id }).from(schema.products).where(and(eq(schema.products.shopId, shopId), inArray(schema.products.id, ids)));
    if (owned.length !== ids.length) throw new UserError("One of those products isn't in this store.");
  }
  const taken = async (h: string) => {
    const row = await db.query.blogPosts.findFirst({ where: and(eq(schema.blogPosts.shopId, shopId), eq(schema.blogPosts.handle, h)), columns: { id: true } });
    return !!row && row.id !== exceptId;
  };
  if (handle && (await taken(handle))) throw new UserError(`Another post already uses the address /blog/${handle}.`);
  return { ...rest, handle: handle || (await uniqueHandle(rest.title, taken)), excerpt: excerpt || null, imageUrl: imageUrl || null, productIds: ids };
}

const NEARLY_EMPTY = "Write a bit more before publishing: the post is nearly empty.";

/** How far ahead a post can be scheduled. */
export const POST_SCHEDULE_MAX_DAYS = 365;

/** On the store: published, and its publish time has come. A post published for later waits. */
export const livePost = (now = new Date()) => and(eq(schema.blogPosts.status, "published"), lte(schema.blogPosts.publishedAt, now));

/** Whether a post is published but waiting for its time. */
export const isScheduled = (post: Pick<Post, "status" | "publishedAt">, now = new Date()) => post.status === "published" && !!post.publishedAt && post.publishedAt > now;

function checkSchedule(at: Date | null | undefined, now: Date) {
  if (!at || at <= now) return null;
  if (Number.isNaN(at.getTime())) throw new UserError("Pick a date and time to publish.");
  if (at.getTime() - now.getTime() > POST_SCHEDULE_MAX_DAYS * 86_400_000) throw new UserError("Schedule the post for within the next year.");
  return at;
}

export async function createPost(db: Db, shopId: string, input: PostInput, opts: { aiGenerated?: boolean; published?: boolean; publishAt?: Date | null; now?: Date } = {}) {
  const data = await parse(db, shopId, input);
  if (opts.published && data.body.trim().length < 50) throw new UserError(NEARLY_EMPTY);
  const now = opts.now ?? new Date();
  const publish = opts.published ? { status: "published" as const, publishedAt: checkSchedule(opts.publishAt, now) ?? now } : {};
  const [row] = await db.insert(schema.blogPosts).values({ ...data, ...publish, shopId, aiGenerated: !!opts.aiGenerated }).returning();
  return row!;
}

export async function updatePost(db: Db, shopId: string, postId: string, input: PostInput) {
  const data = await parse(db, shopId, input, postId);
  const [row] = await db
    .update(schema.blogPosts)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(schema.blogPosts.id, postId), eq(schema.blogPosts.shopId, shopId)))
    .returning();
  if (!row) throw new NotFoundError("Post");
  return row;
}

/**
 * Publishing keeps the first publish date, so editing a live post doesn't move it to the top. With
 * `at` in the future the post is scheduled: published, but only on the store from then. Publishing
 * a scheduled post without `at` puts it up now.
 */
export async function setPostPublished(db: Db, shopId: string, postId: string, published: boolean, now = new Date(), at?: Date | null) {
  const post = await getPost(db, shopId, postId);
  if (published && post.body.trim().length < 50) throw new UserError(NEARLY_EMPTY);
  const later = published ? checkSchedule(at, now) : null;
  const publishedAt = !published ? (isScheduled(post, now) ? null : post.publishedAt) : later ?? (post.publishedAt && post.publishedAt <= now ? post.publishedAt : now);
  const [row] = await db
    .update(schema.blogPosts)
    .set({ status: published ? "published" : "draft", publishedAt, updatedAt: new Date() })
    .where(eq(schema.blogPosts.id, post.id))
    .returning();
  return row!;
}

export async function deletePost(db: Db, shopId: string, postId: string) {
  const [row] = await db
    .delete(schema.blogPosts)
    .where(and(eq(schema.blogPosts.id, postId), eq(schema.blogPosts.shopId, shopId)))
    .returning({ id: schema.blogPosts.id });
  if (!row) throw new NotFoundError("Post");
}

export async function listPosts(db: Db, shopId: string) {
  return db.query.blogPosts.findMany({ where: eq(schema.blogPosts.shopId, shopId), orderBy: desc(schema.blogPosts.updatedAt) });
}

export async function getPost(db: Db, shopId: string, postId: string) {
  const row = await db.query.blogPosts.findFirst({ where: and(eq(schema.blogPosts.id, postId), eq(schema.blogPosts.shopId, shopId)) });
  if (!row) throw new NotFoundError("Post");
  return row;
}

/** The store's blog page, newest first. */
export async function listPublishedPosts(db: Db, shopId: string, limit = 50) {
  return db.query.blogPosts.findMany({
    where: and(eq(schema.blogPosts.shopId, shopId), livePost()),
    orderBy: desc(schema.blogPosts.publishedAt),
    limit,
  });
}

/** The newest published posts as home page cards: plain data the editor preview can show too. */
export async function latestPosts(db: Db, shopId: string, limit = 6) {
  const posts = await listPublishedPosts(db, shopId, limit);
  return posts.map((p) => ({
    id: p.id,
    handle: p.handle,
    title: p.title,
    imageUrl: p.imageUrl,
    summary: postSummary(p),
    publishedAt: p.publishedAt?.toISOString() ?? null,
    minutes: readingMinutes(p.body),
  }));
}
export type PostCard = Awaited<ReturnType<typeof latestPosts>>[number];

/** One published post with the featured products that are still on sale, in the merchant's order. */
export async function getPublishedPostByHandle(db: Db, shopId: string, handle: string) {
  const post = await db.query.blogPosts.findFirst({
    where: and(eq(schema.blogPosts.shopId, shopId), eq(schema.blogPosts.handle, handle), livePost()),
  });
  if (!post) throw new NotFoundError("Post");
  return { post, products: await featuredProducts(db, shopId, post) };
}

async function featuredProducts(db: Db, shopId: string, post: Post) {
  if (!post.productIds.length) return [];
  const rows = await db.query.products.findMany({
    where: and(eq(schema.products.shopId, shopId), inArray(schema.products.id, post.productIds), eq(schema.products.status, "active")),
  });
  const variants = rows.length ? await db.query.variants.findMany({ where: inArray(schema.variants.productId, rows.map((r) => r.id)) }) : [];
  return post.productIds
    .map((id) => rows.find((r) => r.id === id))
    .filter((p): p is (typeof rows)[number] => !!p)
    .map((p) => {
      const vs = variants.filter((v) => v.productId === p.id);
      const cheapest = vs.reduce((a, b) => (b.priceMinor < a.priceMinor ? b : a), vs[0]!);
      return { id: p.id, title: p.title, handle: p.handle, imageUrl: p.imageUrl, priceMinor: cheapest?.priceMinor ?? 0, compareAtMinor: cheapest?.compareAtMinor ?? null };
    });
}

export type PostBlock = { type: "heading"; text: string } | { type: "paragraph"; text: string } | { type: "list"; items: string[] };

/** Splits a post body into subheadings, paragraphs and bullet lists for display. */
export function postBlocks(body: string): PostBlock[] {
  const blocks: PostBlock[] = [];
  for (const chunk of body.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    let para: string[] = [];
    const flush = () => {
      if (para.length) blocks.push({ type: "paragraph", text: para.join("\n") });
      para = [];
    };
    for (const line of lines) {
      if (line.startsWith("## ")) {
        flush();
        blocks.push({ type: "heading", text: line.slice(3).trim() });
      } else if (/^[•*-]\s+/.test(line)) {
        flush();
        const item = line.replace(/^[•*-]\s+/, "");
        const last = blocks.at(-1);
        if (last?.type === "list") last.items.push(item);
        else blocks.push({ type: "list", items: [item] });
      } else para.push(line);
    }
    flush();
  }
  return blocks;
}

/** A summary for lists and search engines: the excerpt, else the start of the first paragraph. */
export function postSummary(post: Pick<Post, "excerpt" | "body">, max = 160) {
  if (post.excerpt) return post.excerpt;
  const first = postBlocks(post.body).find((b) => b.type === "paragraph");
  const text = first?.type === "paragraph" ? first.text.replace(/\s+/g, " ") : "";
  return text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : text;
}

/** Roughly how long the post takes to read, at 220 words a minute. */
export const readingMinutes = (body: string) => Math.max(1, Math.round(body.split(/\s+/).filter(Boolean).length / 220));

