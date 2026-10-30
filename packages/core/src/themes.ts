import { eq } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { UserError } from "./errors";
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
type Timed = { schedule: { at: string } | null; revert: { at: string } | null };
const isDue = (row: Timed, now: Date) => [row.schedule?.at, row.revert?.at].some((at) => at && new Date(at) <= now);

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
  if (isDue(row, new Date()) && (await applyDueTheme(db, shop.id))) row = (await db.query.themes.findFirst({ where: eq(schema.themes.shopId, shop.id) }))!;
  const draft = readDoc(row.draft, shop.name);
  const published = readDoc(row.published, shop.name);
  return {
    draft,
    published,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
    hasChanges: JSON.stringify(draft) !== JSON.stringify(published),
    /** A look waiting to go live by itself, and when it switches back. */
    schedule: row.schedule ? { at: row.schedule.at, until: row.schedule.until } : null,
    /** When the live look goes back to the one a scheduled change replaced. */
    revertAt: row.revert?.at ?? null,
  };
}

/**
 * What buyers see. It only writes when a scheduled look is due, so storefront reads stay cheap
 * and a Black Friday look goes live on the first visit after its time.
 */
export async function getPublishedTheme(db: Db, shop: ShopRef, now = new Date()): Promise<ThemeDoc> {
  const row = await db.query.themes.findFirst({
    where: eq(schema.themes.shopId, shop.id),
    columns: { published: true, schedule: true, revert: true },
  });
  if (!row) return defaultTheme(shop.name);
  if (isDue(row, now)) {
    const live = await applyDueTheme(db, shop.id, now);
    if (live) return readDoc(live, shop.name);
  }
  return readDoc(row.published, shop.name);
}

/**
 * Puts a scheduled look live, or the earlier look back, when its time has come. Returns the
 * document now live, or null when nothing was due. Two visits at once work out the same result,
 * so applying it twice is harmless.
 */
export async function applyDueTheme(db: Db, shopId: string, now = new Date()) {
  const row = await db.query.themes.findFirst({ where: eq(schema.themes.shopId, shopId) });
  if (!row) return null;
  let { published, schedule, revert } = row;
  if (!isDue(row, now)) return null;
  const due = (at: string) => new Date(at) <= now;
  if (revert && due(revert.at)) {
    published = revert.doc;
    revert = null;
  }
  if (schedule && due(schedule.at)) {
    // A whole window that went by before anyone visited leaves the look as it was.
    if (!schedule.until || !due(schedule.until)) {
      revert = schedule.until ? { doc: published, at: schedule.until } : null;
      published = schedule.doc;
    }
    schedule = null;
  }
  await db
    .update(schema.themes)
    .set({ published, schedule, revert, ...(published !== row.published ? { publishedAt: now } : {}), updatedAt: now })
    .where(eq(schema.themes.id, row.id));
  return published;
}

/**
 * Copies the draft as it is now to go live by itself at `at`, and, with `until`, puts the
 * look live before it back at that time (a Black Friday look from Friday to Monday night).
 * Later edits to the draft don't change what's scheduled. Replaces any earlier schedule.
 */
export async function scheduleTheme(db: Db, shop: ShopRef, input: { at: Date; until: Date | null }, now = new Date()) {
  if (Number.isNaN(input.at.getTime())) throw new UserError("Pick when the new look goes live.");
  if (input.at <= now) throw new UserError("Pick a time that's still to come, or publish now.");
  if (input.until && Number.isNaN(input.until.getTime())) throw new UserError("Pick when to switch back, or leave it empty.");
  if (input.until && input.until <= input.at) throw new UserError("Switch back after the new look goes live.");
  if (input.at.getTime() - now.getTime() > 366 * 86_400_000) throw new UserError("Schedule it within a year.");
  const { draft } = await getTheme(db, shop);
  const schedule = { doc: draft as Record<string, unknown>, at: input.at.toISOString(), until: input.until?.toISOString() ?? null };
  await db.update(schema.themes).set({ schedule, updatedAt: now }).where(eq(schema.themes.shopId, shop.id));
  return { at: schedule.at, until: schedule.until };
}

/** Drops a look waiting to go live; what buyers see stays as it is. */
export async function cancelThemeSchedule(db: Db, shopId: string) {
  await db.update(schema.themes).set({ schedule: null, updatedAt: new Date() }).where(eq(schema.themes.shopId, shopId));
}

/** Keeps the scheduled look that's live now, instead of switching back. */
export async function keepScheduledTheme(db: Db, shopId: string) {
  await db.update(schema.themes).set({ revert: null, updatedAt: new Date() }).where(eq(schema.themes.shopId, shopId));
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
