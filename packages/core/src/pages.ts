import { and, asc, eq } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import { toHandle } from "./handles";

/*
 * Store pages (About, Shipping, Returns...). The body is plain text: blank lines make
 * paragraphs. No HTML is stored, so nothing a merchant pastes can run in a buyer's browser.
 */

const pageInput = z.object({
  title: z.string().trim().min(1, "Give the page a title.").max(120),
  handle: z
    .string()
    .trim()
    .max(60)
    .default("")
    .refine((h) => h === "" || /^[a-z0-9](-?[a-z0-9])*$/.test(h), "Page addresses use lowercase letters, numbers and dashes."),
  body: z.string().max(50_000).default(""),
  seoDescription: z.string().trim().max(320).default(""),
  published: z.boolean().default(true),
});
export type PageInput = z.input<typeof pageInput>;

function parse(input: PageInput) {
  const parsed = pageInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { handle, seoDescription, ...rest } = parsed.data;
  return { ...rest, handle: handle || toHandle(rest.title), seoDescription: seoDescription || null };
}

async function assertHandleFree(db: Db, shopId: string, handle: string, exceptId?: string) {
  const row = await db.query.pages.findFirst({
    where: and(eq(schema.pages.shopId, shopId), eq(schema.pages.handle, handle)),
    columns: { id: true },
  });
  if (row && row.id !== exceptId) throw new UserError(`Another page already uses the address /pages/${handle}.`);
}

export async function createPage(db: Db, shopId: string, input: PageInput) {
  const data = parse(input);
  await assertHandleFree(db, shopId, data.handle);
  const [row] = await db.insert(schema.pages).values({ ...data, shopId }).returning();
  return row!;
}

export async function updatePage(db: Db, shopId: string, pageId: string, input: PageInput) {
  const data = parse(input);
  await assertHandleFree(db, shopId, data.handle, pageId);
  const [row] = await db
    .update(schema.pages)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(schema.pages.id, pageId), eq(schema.pages.shopId, shopId)))
    .returning();
  if (!row) throw new NotFoundError("Page");
  return row;
}

export async function deletePage(db: Db, shopId: string, pageId: string) {
  const [row] = await db
    .delete(schema.pages)
    .where(and(eq(schema.pages.id, pageId), eq(schema.pages.shopId, shopId)))
    .returning({ id: schema.pages.id });
  if (!row) throw new NotFoundError("Page");
}

export async function listPages(db: Db, shopId: string) {
  return db.query.pages.findMany({ where: eq(schema.pages.shopId, shopId), orderBy: asc(schema.pages.title) });
}

export async function getPage(db: Db, shopId: string, pageId: string) {
  const row = await db.query.pages.findFirst({ where: and(eq(schema.pages.id, pageId), eq(schema.pages.shopId, shopId)) });
  if (!row) throw new NotFoundError("Page");
  return row;
}

export async function getPublishedPageByHandle(db: Db, shopId: string, handle: string) {
  const row = await db.query.pages.findFirst({
    where: and(eq(schema.pages.shopId, shopId), eq(schema.pages.handle, handle), eq(schema.pages.published, true)),
  });
  if (!row) throw new NotFoundError("Page");
  return row;
}

/** Splits plain text into paragraphs for display. */
export function paragraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
