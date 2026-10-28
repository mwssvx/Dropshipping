// Saved views: a named search and set of filters on the products, orders or customers list, like
// "Sold out from suppliers" or "Rush orders to the UK". They show as one-click links above the
// list for everyone on the team. Only the list's own link parameters are kept, so a view is just
// a link and can't hold anything else.
import { and, asc, eq } from "drizzle-orm";
import { schema, SAVED_VIEW_LISTS, type Db } from "@sf/db";
import { UserError } from "./errors";

export type SavedViewList = (typeof SAVED_VIEW_LISTS)[number];
export type SavedView = typeof schema.savedViews.$inferSelect;
export { SAVED_VIEW_LISTS };

export const MAX_SAVED_VIEWS = 20;
const NAME_MAX = 40;

/** The link parameters each list understands, in the order a view's link writes them. */
export const VIEW_PARAMS: Record<SavedViewList, readonly string[]> = {
  products: ["q", "status", "tag", "stock", "source", "collection", "missing", "sort"],
  orders: ["show", "q", "tag", "product", "country", "placed", "status", "payment"],
  customers: ["q", "tag", "filter", "sort"],
};

/** Keeps only the list's own parameters, so "page" or anything made up is left out. */
export function viewQuery(list: SavedViewList, params: Record<string, string | undefined | null>) {
  const out = new URLSearchParams();
  for (const key of VIEW_PARAMS[list]) {
    const value = params[key]?.trim();
    if (value) out.set(key, value.slice(0, 200));
  }
  return out.toString();
}

export function listSavedViews(db: Db, shopId: string, list: SavedViewList) {
  return db.query.savedViews.findMany({
    where: and(eq(schema.savedViews.shopId, shopId), eq(schema.savedViews.list, list)),
    orderBy: asc(schema.savedViews.createdAt),
  });
}

/** Saves the list's current search and filters under a name. The same name again replaces it. */
export async function saveView(db: Db, shopId: string, list: SavedViewList, input: { name: string; params: Record<string, string | undefined | null> }) {
  if (!SAVED_VIEW_LISTS.includes(list)) throw new UserError("That list can't have saved views.");
  const name = input.name.replace(/\s+/g, " ").trim();
  if (!name) throw new UserError('Give the view a name, like "Sold out".');
  if (name.length > NAME_MAX) throw new UserError(`Keep the name under ${NAME_MAX} characters.`);
  const query = viewQuery(list, input.params);
  if (!query) throw new UserError("Search or pick a filter first, then save it as a view.");
  const existing = await listSavedViews(db, shopId, list);
  const same = existing.find((v) => v.name.toLowerCase() === name.toLowerCase());
  if (same) {
    const [row] = await db.update(schema.savedViews).set({ name, query }).where(eq(schema.savedViews.id, same.id)).returning();
    return row!;
  }
  if (existing.length >= MAX_SAVED_VIEWS) throw new UserError(`A list can have up to ${MAX_SAVED_VIEWS} saved views. Remove one first.`);
  const [row] = await db.insert(schema.savedViews).values({ shopId, list, name, query }).returning();
  return row!;
}

export async function deleteSavedView(db: Db, shopId: string, viewId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(viewId)) return;
  await db.delete(schema.savedViews).where(and(eq(schema.savedViews.id, viewId), eq(schema.savedViews.shopId, shopId)));
}
