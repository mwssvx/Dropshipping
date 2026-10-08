import { eq } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { defaultTheme, parseTheme, type ThemeDoc } from "./theme-doc";

export * from "./theme-doc";

/** Reads a stored document. Anything unreadable falls back to the default so a store never breaks. */
function readDoc(raw: unknown, shopName: string): ThemeDoc {
  try {
    return parseTheme(raw);
  } catch {
    return defaultTheme(shopName);
  }
}

type ShopRef = { id: string; name: string };

/** The editor's view: draft, published, and whether they differ. Creates the theme on first use. */
export async function getTheme(db: Db, shop: ShopRef) {
  let row = await db.query.themes.findFirst({ where: eq(schema.themes.shopId, shop.id) });
  if (!row) {
    const doc = defaultTheme(shop.name);
    await db
      .insert(schema.themes)
      .values({ shopId: shop.id, draft: doc, published: doc, publishedAt: new Date() })
      .onConflictDoNothing();
    row = (await db.query.themes.findFirst({ where: eq(schema.themes.shopId, shop.id) }))!;
  }
  const draft = readDoc(row.draft, shop.name);
  const published = readDoc(row.published, shop.name);
  return {
    draft,
    published,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
    hasChanges: JSON.stringify(draft) !== JSON.stringify(published),
  };
}

/** What buyers see. Never writes, so storefront reads stay cheap. */
export async function getPublishedTheme(db: Db, shop: ShopRef): Promise<ThemeDoc> {
  const row = await db.query.themes.findFirst({ where: eq(schema.themes.shopId, shop.id), columns: { published: true } });
  return row ? readDoc(row.published, shop.name) : defaultTheme(shop.name);
}

export async function saveThemeDraft(db: Db, shop: ShopRef, input: unknown) {
  const doc = parseTheme(input);
  const { published } = await getTheme(db, shop);
  const [row] = await db
    .update(schema.themes)
    .set({ draft: doc, updatedAt: new Date() })
    .where(eq(schema.themes.shopId, shop.id))
    .returning({ updatedAt: schema.themes.updatedAt });
  return { doc, updatedAt: row!.updatedAt, hasChanges: JSON.stringify(doc) !== JSON.stringify(published) };
}

export async function publishTheme(db: Db, shop: ShopRef) {
  const { draft } = await getTheme(db, shop);
  const now = new Date();
  await db.update(schema.themes).set({ published: draft, publishedAt: now, updatedAt: now }).where(eq(schema.themes.shopId, shop.id));
  return { publishedAt: now };
}

export async function discardThemeDraft(db: Db, shop: ShopRef) {
  const { published } = await getTheme(db, shop);
  await db.update(schema.themes).set({ draft: published, updatedAt: new Date() }).where(eq(schema.themes.shopId, shop.id));
  return published;
}
