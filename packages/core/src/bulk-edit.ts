// Bulk edit: change many products at once from the Products list. Publish, hide or archive them,
// move prices up or down by a percent, set or clear the crossed-out "was" price, or add them to a
// collection. Every change is saved with what it replaced, so the merchant can undo it for a week.
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { schema, type BulkEditAction, type BulkEditSnapshot, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import { formatMoney } from "./money";

type Shop = typeof schema.shops.$inferSelect;

const DAY = 86_400_000;
/** How long an edit can be undone. */
export const UNDO_DAYS = 7;
export const MAX_BULK_PRODUCTS = 500;

const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status"), status: z.enum(["active", "draft", "archived"]) }),
  z.object({
    kind: z.literal("price"),
    percent: z.number().int().min(-90, "Lower prices by up to 90%.").max(500, "Raise prices by up to 500%.").refine((n) => n !== 0, "Enter a percent other than 0."),
    ending: z.enum(["99", "95", "00", "none"]).default("none"),
  }),
  z.object({ kind: z.literal("compare_at"), percent: z.number().int().min(5, "Show a \"was\" price 5% to 300% above the price.").max(300, "Show a \"was\" price 5% to 300% above the price.").nullable() }),
  z.object({ kind: z.literal("collection"), collectionId: z.string().uuid(), remove: z.boolean().default(false) }),
]);

export type BulkEditInput = z.input<typeof actionSchema>;

function round(exact: number, ending: "99" | "95" | "00" | "none") {
  if (ending === "none") return Math.round(exact);
  const whole = Math.round(exact / 100) * 100;
  return ending === "00" ? whole : Math.max(0, whole - Number(ending === "99" ? 1 : 5));
}

export type BulkChange = { productId: string; product: string; variant: string | null; before: string; after: string; belowCost: boolean };

async function plan(db: Db, shop: Shop, productIds: string[], input: BulkEditInput) {
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const action = parsed.data as BulkEditAction;
  const ids = [...new Set(productIds)];
  if (!ids.length) throw new UserError("Pick at least one product.");
  if (ids.length > MAX_BULK_PRODUCTS) throw new UserError(`Pick up to ${MAX_BULK_PRODUCTS} products at a time.`);
  const products = await db.query.products.findMany({ where: and(eq(schema.products.shopId, shop.id), inArray(schema.products.id, ids)) });
  if (products.length !== ids.length) throw new NotFoundError("Product");
  const variants = await db.query.variants.findMany({ where: inArray(schema.variants.productId, ids) });
  const money = (n: number | null) => (n == null ? "none" : formatMoney(n, shop.currency));
  const changes: BulkChange[] = [];
  const snapshot: BulkEditSnapshot = { products: [], variants: [], collection: [] };
  let skipped = 0;

  if (action.kind === "status") {
    for (const p of products) {
      if (p.status === action.status) continue;
      changes.push({ productId: p.id, product: p.title, variant: null, before: p.status, after: action.status, belowCost: false });
      snapshot.products.push({ id: p.id, status: p.status });
    }
  } else if (action.kind === "collection") {
    const collection = await db.query.collections.findFirst({ where: and(eq(schema.collections.id, action.collectionId), eq(schema.collections.shopId, shop.id)) });
    if (!collection) throw new NotFoundError("Collection");
    if (collection.rules) throw new UserError(`"${collection.title}" fills itself by its rules. Change the rules, or pick a hand-picked collection.`);
    const inIt = new Set(
      (await db.query.collectionProducts.findMany({ where: and(eq(schema.collectionProducts.collectionId, collection.id), inArray(schema.collectionProducts.productId, ids)) })).map((r) => r.productId),
    );
    for (const p of products) {
      if (inIt.has(p.id) !== action.remove) continue;
      changes.push({ productId: p.id, product: p.title, variant: null, before: inIt.has(p.id) ? `in ${collection.title}` : "", after: action.remove ? "" : `in ${collection.title}`, belowCost: false });
      snapshot.collection.push({ collectionId: collection.id, productId: p.id, wasIn: inIt.has(p.id) });
    }
  } else {
    for (const p of products) {
      // Gift cards are sold at their face value.
      if (p.giftCard) {
        skipped++;
        continue;
      }
      for (const v of variants.filter((x) => x.productId === p.id)) {
        let priceMinor = v.priceMinor;
        let compareAtMinor = v.compareAtMinor;
        if (action.kind === "price") {
          priceMinor = Math.max(0, round(v.priceMinor * (1 + action.percent / 100), action.ending));
          // A "was" price at or under the new price would read as a fake sale.
          if (compareAtMinor != null && compareAtMinor <= priceMinor) compareAtMinor = null;
        } else {
          compareAtMinor = action.percent == null ? null : round(v.priceMinor * (1 + action.percent / 100), "none");
        }
        if (priceMinor === v.priceMinor && compareAtMinor === v.compareAtMinor) continue;
        const showPrice = priceMinor !== v.priceMinor;
        changes.push({
          productId: p.id,
          product: p.title,
          variant: v.title,
          before: showPrice ? money(v.priceMinor) : `was ${money(v.compareAtMinor)}`,
          after: showPrice ? money(priceMinor) : `was ${money(compareAtMinor)}`,
          belowCost: v.costMinor != null && priceMinor < v.costMinor,
        });
        snapshot.variants.push({ id: v.id, priceMinor: v.priceMinor, compareAtMinor: v.compareAtMinor, newPriceMinor: priceMinor, newCompareAtMinor: compareAtMinor });
      }
    }
  }
  return { action, changes, snapshot, skipped, products: new Set(changes.map((c) => c.productId)).size };
}

/** What an edit would change, for the confirm step. */
export async function previewBulkEdit(db: Db, shop: Shop, productIds: string[], input: BulkEditInput) {
  const { changes, skipped, products } = await plan(db, shop, productIds, input);
  return { changes, skipped, products, belowCost: changes.filter((c) => c.belowCost).length };
}

export function describeBulkAction(action: BulkEditAction, collectionTitle?: string) {
  switch (action.kind) {
    case "status":
      return { active: "Published", draft: "Hid", archived: "Archived" }[action.status];
    case "price":
      return `${action.percent > 0 ? "Raised" : "Lowered"} prices ${Math.abs(action.percent)}%`;
    case "compare_at":
      return action.percent == null ? "Cleared \"was\" prices" : `Set "was" prices ${action.percent}% above`;
    case "collection":
      return `${action.remove ? "Took out of" : "Added to"} ${collectionTitle ?? "a collection"}`;
  }
}

/**
 * Makes the change and keeps what it replaced. Refuses to price anything under what the supplier
 * charges unless the merchant says that's intended.
 */
export async function applyBulkEdit(db: Db, shop: Shop, productIds: string[], input: BulkEditInput, opts: { allowBelowCost?: boolean; userId?: string | null; now?: Date } = {}) {
  const { action, changes, snapshot, products } = await plan(db, shop, productIds, input);
  if (!changes.length) throw new UserError("Nothing to change: those products already look like that.");
  const below = changes.filter((c) => c.belowCost).length;
  if (below && !opts.allowBelowCost) {
    throw new UserError(`That would sell ${below === 1 ? "1 option" : `${below} options`} for less than the supplier charges you. Tick "Sell below cost" if that's what you want.`, "below_cost");
  }
  const now = opts.now ?? new Date();
  const collection = action.kind === "collection" ? await db.query.collections.findFirst({ where: eq(schema.collections.id, action.collectionId) }) : null;
  const summary = `${describeBulkAction(action, collection?.title)} on ${products === 1 ? "1 product" : `${products} products`}`;
  return db.transaction(async (tx) => {
    for (const p of snapshot.products) {
      await tx.update(schema.products).set({ status: (action as { status: "active" | "draft" | "archived" }).status, updatedAt: now }).where(eq(schema.products.id, p.id));
    }
    for (const v of snapshot.variants) {
      await tx.update(schema.variants).set({ priceMinor: v.newPriceMinor, compareAtMinor: v.newCompareAtMinor }).where(eq(schema.variants.id, v.id));
    }
    for (const c of snapshot.collection) {
      if (c.wasIn) await tx.delete(schema.collectionProducts).where(and(eq(schema.collectionProducts.collectionId, c.collectionId), eq(schema.collectionProducts.productId, c.productId)));
      else await tx.insert(schema.collectionProducts).values({ collectionId: c.collectionId, productId: c.productId, position: 1_000_000 }).onConflictDoNothing();
    }
    const touched = [...new Set(changes.map((c) => c.productId))];
    if (action.kind !== "status") await tx.update(schema.products).set({ updatedAt: now }).where(inArray(schema.products.id, touched));
    const [edit] = await tx.insert(schema.bulkEdits).values({ shopId: shop.id, summary, action, snapshot, products: touched.length, createdBy: opts.userId ?? null, createdAt: now }).returning();
    return edit!;
  });
}

/**
 * Puts back what an edit replaced. Only fields the edit set are restored, and only where nobody has
 * changed them since, so a later price change by hand isn't thrown away.
 */
export async function undoBulkEdit(db: Db, shopId: string, editId: string, now = new Date()) {
  const edit = await db.query.bulkEdits.findFirst({ where: and(eq(schema.bulkEdits.id, editId), eq(schema.bulkEdits.shopId, shopId)) });
  if (!edit) throw new NotFoundError("Change");
  if (edit.undoneAt) throw new UserError("That change was already undone.");
  if (now.getTime() - edit.createdAt.getTime() > UNDO_DAYS * DAY) throw new UserError(`Changes can be undone for ${UNDO_DAYS} days.`);
  const { snapshot, action } = edit;
  let restored = 0;
  let kept = 0;
  await db.transaction(async (tx) => {
    // Claim it first, so two presses can't undo twice.
    const [claimed] = await tx.update(schema.bulkEdits).set({ undoneAt: now }).where(and(eq(schema.bulkEdits.id, edit.id), isNull(schema.bulkEdits.undoneAt))).returning();
    if (!claimed) throw new UserError("That change was already undone.");
    if (snapshot.products.length) {
      const rows = await tx.query.products.findMany({ where: inArray(schema.products.id, snapshot.products.map((p) => p.id)) });
      for (const p of snapshot.products) {
        const row = rows.find((r) => r.id === p.id);
        if (!row || action.kind !== "status" || row.status !== action.status) {
          kept++;
          continue;
        }
        await tx.update(schema.products).set({ status: p.status, updatedAt: now }).where(eq(schema.products.id, p.id));
        restored++;
      }
    }
    if (snapshot.variants.length) {
      const rows = await tx.query.variants.findMany({ where: inArray(schema.variants.id, snapshot.variants.map((v) => v.id)) });
      const touched = new Set<string>();
      for (const v of snapshot.variants) {
        const row = rows.find((r) => r.id === v.id);
        if (!row || row.priceMinor !== v.newPriceMinor || row.compareAtMinor !== v.newCompareAtMinor) {
          kept++;
          continue;
        }
        await tx.update(schema.variants).set({ priceMinor: v.priceMinor, compareAtMinor: v.compareAtMinor }).where(eq(schema.variants.id, v.id));
        touched.add(row.productId);
        restored++;
      }
      if (touched.size) await tx.update(schema.products).set({ updatedAt: now }).where(inArray(schema.products.id, [...touched]));
    }
    for (const c of snapshot.collection) {
      if (c.wasIn) await tx.insert(schema.collectionProducts).values({ collectionId: c.collectionId, productId: c.productId, position: 1_000_000 }).onConflictDoNothing();
      else await tx.delete(schema.collectionProducts).where(and(eq(schema.collectionProducts.collectionId, c.collectionId), eq(schema.collectionProducts.productId, c.productId)));
      restored++;
    }
  });
  return { restored, kept };
}


/** The last changes, newest first, for the Products page. */
export async function recentBulkEdits(db: Db, shopId: string, now = new Date(), limit = 5) {
  const rows = await db.query.bulkEdits.findMany({ where: eq(schema.bulkEdits.shopId, shopId), orderBy: desc(schema.bulkEdits.createdAt), limit });
  return rows.map((r) => ({ id: r.id, summary: r.summary, createdAt: r.createdAt, undoneAt: r.undoneAt, canUndo: !r.undoneAt && now.getTime() - r.createdAt.getTime() <= UNDO_DAYS * DAY }));
}
