// Bulk edit: change many products at once from the Products list. Publish, hide or archive them,
// move prices up or down by a percent, set or clear the crossed-out "was" price, or add them to a
// collection, add or remove a tag, set where they ship from, how long they take to prepare, or their extra shipping. Every change is saved with what it replaced, so the merchant can undo it for a week.
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { schema, type BulkEditAction, type BulkEditSnapshot, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import { normalizeTags } from "./customers";
import { countryCode } from "./customs";
import { countryName } from "./shipping";
import { PRODUCT_PROCESSING_MAX } from "./delivery";
import { formatMoney } from "./money";
import { SHIPPING_SURCHARGE_MAX } from "./shipping-surcharge";
import { MAX_PRODUCT_TAGS } from "./products";

type Shop = typeof schema.shops.$inferSelect;

const DAY = 86_400_000;
/** How long an edit can be undone. */
export const UNDO_DAYS = 7;
export const MAX_BULK_PRODUCTS = 500;

const DAYS_ERROR = `Enter 0 to ${PRODUCT_PROCESSING_MAX} days, or leave it empty for your store's.`;
const SURCHARGE_ERROR = "Enter an amount from 0 to 1,000, or leave it empty for no extra shipping.";

const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status"), status: z.enum(["active", "draft", "archived"]) }),
  z.object({
    kind: z.literal("price"),
    percent: z.number().int().min(-90, "Lower prices by up to 90%.").max(500, "Raise prices by up to 500%.").refine((n) => n !== 0, "Enter a percent other than 0."),
    ending: z.enum(["99", "95", "00", "none"]).default("none"),
  }),
  z.object({ kind: z.literal("compare_at"), percent: z.number().int().min(5, "Show a \"was\" price 5% to 300% above the price.").max(300, "Show a \"was\" price 5% to 300% above the price.").nullable() }),
  z.object({ kind: z.literal("collection"), collectionId: z.string().uuid(), remove: z.boolean().default(false) }),
  z.object({ kind: z.literal("tag"), tag: z.string(), remove: z.boolean().default(false) }),
  z.object({ kind: z.literal("ships_from"), country: z.string().max(10).nullable() }),
  z.object({
    kind: z.literal("processing"),
    days: z.number({ error: DAYS_ERROR }).int(DAYS_ERROR).min(0, DAYS_ERROR).max(PRODUCT_PROCESSING_MAX, DAYS_ERROR).nullable(),
  }),
  z.object({ kind: z.literal("surcharge"), amountMinor: z.number().int().min(0, SURCHARGE_ERROR).max(SHIPPING_SURCHARGE_MAX, SURCHARGE_ERROR) }),
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
  const snapshot: BulkEditSnapshot = { products: [], variants: [], collection: [], tags: [], shipsFrom: [], processing: [], surcharge: [] };
  let skipped = 0;
  // Products that already have as many tags as they can.
  let full = 0;

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
  } else if (action.kind === "tag") {
    if (action.tag.includes(",")) throw new UserError("Add one tag at a time.");
    const [tag] = normalizeTags(action.tag, "A product", 1);
    if (!tag) throw new UserError("Enter the tag, like summer.");
    action.tag = tag;
    for (const p of products) {
      const had = p.tags.includes(tag);
      if (had !== action.remove) continue;
      if (!had && p.tags.length >= MAX_PRODUCT_TAGS) {
        full++;
        continue;
      }
      changes.push({ productId: p.id, product: p.title, variant: null, before: p.tags.join(", "), after: (had ? p.tags.filter((t) => t !== tag) : [...p.tags, tag]).join(", "), belowCost: false });
      snapshot.tags!.push({ productId: p.id, tag, had });
    }
  } else if (action.kind === "ships_from") {
    const raw = (action.country ?? "").trim();
    const code = raw ? countryCode(raw) : null;
    if (raw && !code) throw new UserError("Enter the country as a two-letter code, like CN or US.");
    // The store's own country is what an empty one means.
    action.country = code === shop.country ? null : code;
    const name = (c: string | null) => countryName(c ?? shop.country);
    for (const p of products) {
      // Gift cards and downloads don't ship.
      if (p.giftCard || p.digital) {
        skipped++;
        continue;
      }
      if (p.shipsFrom === action.country) continue;
      changes.push({ productId: p.id, product: p.title, variant: null, before: `ships from ${name(p.shipsFrom)}`, after: `ships from ${name(action.country)}`, belowCost: false });
      snapshot.shipsFrom!.push({ productId: p.id, before: p.shipsFrom, after: action.country });
    }
  } else if (action.kind === "processing") {
    const days = (d: number | null) => {
      const n = d ?? shop.processingDays;
      return `${n} ${n === 1 ? "day" : "days"}${d === null ? " (store's)" : ""}`;
    };
    for (const p of products) {
      if (p.giftCard || p.digital) {
        skipped++;
        continue;
      }
      if (p.processingDays === action.days) continue;
      changes.push({ productId: p.id, product: p.title, variant: null, before: days(p.processingDays), after: days(action.days), belowCost: false });
      snapshot.processing!.push({ productId: p.id, before: p.processingDays, after: action.days });
    }
  } else if (action.kind === "surcharge") {
    const extra = (n: number) => (n ? `${money(n)} extra shipping` : "no extra shipping");
    for (const p of products) {
      if (p.giftCard || p.digital) {
        skipped++;
        continue;
      }
      if (p.shippingSurchargeMinor === action.amountMinor) continue;
      changes.push({ productId: p.id, product: p.title, variant: null, before: extra(p.shippingSurchargeMinor), after: extra(action.amountMinor), belowCost: false });
      snapshot.surcharge!.push({ productId: p.id, before: p.shippingSurchargeMinor, after: action.amountMinor });
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
  return { action, changes, snapshot, skipped, full, products: new Set(changes.map((c) => c.productId)).size };
}

/** What an edit would change, for the confirm step. */
export async function previewBulkEdit(db: Db, shop: Shop, productIds: string[], input: BulkEditInput) {
  const { changes, skipped, full, products } = await plan(db, shop, productIds, input);
  return { changes, skipped, full, products, belowCost: changes.filter((c) => c.belowCost).length };
}

export function describeBulkAction(action: BulkEditAction, collectionTitle?: string, currency = "USD") {
  switch (action.kind) {
    case "status":
      return { active: "Published", draft: "Hid", archived: "Archived" }[action.status];
    case "price":
      return `${action.percent > 0 ? "Raised" : "Lowered"} prices ${Math.abs(action.percent)}%`;
    case "compare_at":
      return action.percent == null ? "Cleared \"was\" prices" : `Set "was" prices ${action.percent}% above`;
    case "collection":
      return `${action.remove ? "Took out of" : "Added to"} ${collectionTitle ?? "a collection"}`;
    case "tag":
      return `${action.remove ? "Removed" : "Added"} the tag “${action.tag}”`;
    case "ships_from":
      return action.country ? `Set Ships from to ${countryName(action.country)}` : "Set Ships from to your store's country";
    case "processing":
      return action.days === null ? "Set preparing time to your store's" : `Set preparing time to ${action.days} ${action.days === 1 ? "day" : "days"}`;
    case "surcharge":
      return action.amountMinor ? `Set extra shipping to ${formatMoney(action.amountMinor, currency)} each` : "Removed extra shipping";
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
  const summary = `${describeBulkAction(action, collection?.title, shop.currency)} on ${products === 1 ? "1 product" : `${products} products`}`;
  return db.transaction(async (tx) => {
    for (const p of snapshot.products) {
      await tx.update(schema.products).set({ status: (action as { status: "active" | "draft" | "archived" }).status, publishAt: null, updatedAt: now }).where(eq(schema.products.id, p.id));
    }
    for (const v of snapshot.variants) {
      await tx.update(schema.variants).set({ priceMinor: v.newPriceMinor, compareAtMinor: v.newCompareAtMinor }).where(eq(schema.variants.id, v.id));
    }
    for (const c of snapshot.collection) {
      if (c.wasIn) await tx.delete(schema.collectionProducts).where(and(eq(schema.collectionProducts.collectionId, c.collectionId), eq(schema.collectionProducts.productId, c.productId)));
      else await tx.insert(schema.collectionProducts).values({ collectionId: c.collectionId, productId: c.productId, position: 1_000_000 }).onConflictDoNothing();
    }
    for (const t of snapshot.tags ?? []) await setTag(tx, t.productId, t.tag, !t.had, now);
    for (const c of snapshot.shipsFrom ?? []) await tx.update(schema.products).set({ shipsFrom: c.after }).where(eq(schema.products.id, c.productId));
    for (const c of snapshot.processing ?? []) await tx.update(schema.products).set({ processingDays: c.after }).where(eq(schema.products.id, c.productId));
    for (const c of snapshot.surcharge ?? []) await tx.update(schema.products).set({ shippingSurchargeMinor: c.after }).where(eq(schema.products.id, c.productId));
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
    // A tag goes back to how it was, leaving any other tags changed since alone.
    for (const t of snapshot.tags ?? []) {
      if (await setTag(tx, t.productId, t.tag, t.had, now)) restored++;
      else kept++;
    }
    // Ships from goes back only where nobody has set it since.
    if (snapshot.shipsFrom?.length) {
      const rows = await tx.query.products.findMany({ where: inArray(schema.products.id, snapshot.shipsFrom.map((c) => c.productId)), columns: { id: true, shipsFrom: true } });
      for (const c of snapshot.shipsFrom) {
        const row = rows.find((r) => r.id === c.productId);
        if (!row || row.shipsFrom !== c.after) {
          kept++;
          continue;
        }
        await tx.update(schema.products).set({ shipsFrom: c.before, updatedAt: now }).where(eq(schema.products.id, c.productId));
        restored++;
      }
    }
    if (snapshot.processing?.length) {
      const rows = await tx.query.products.findMany({ where: inArray(schema.products.id, snapshot.processing.map((c) => c.productId)), columns: { id: true, processingDays: true } });
      for (const c of snapshot.processing) {
        const row = rows.find((r) => r.id === c.productId);
        if (!row || row.processingDays !== c.after) {
          kept++;
          continue;
        }
        await tx.update(schema.products).set({ processingDays: c.before, updatedAt: now }).where(eq(schema.products.id, c.productId));
        restored++;
      }
    }
    if (snapshot.surcharge?.length) {
      const rows = await tx.query.products.findMany({ where: inArray(schema.products.id, snapshot.surcharge.map((c) => c.productId)), columns: { id: true, shippingSurchargeMinor: true } });
      for (const c of snapshot.surcharge) {
        const row = rows.find((r) => r.id === c.productId);
        if (!row || row.shippingSurchargeMinor !== c.after) {
          kept++;
          continue;
        }
        await tx.update(schema.products).set({ shippingSurchargeMinor: c.before, updatedAt: now }).where(eq(schema.products.id, c.productId));
        restored++;
      }
    }
  });
  return { restored, kept };
}


/** Adds or removes one tag on a product. False when the product is gone or already like that. */
async function setTag(tx: Pick<Db, "query" | "update">, productId: string, tag: string, on: boolean, now: Date) {
  const row = await tx.query.products.findFirst({ where: eq(schema.products.id, productId), columns: { tags: true } });
  if (!row || row.tags.includes(tag) === on) return false;
  const tags = on ? [...row.tags, tag].slice(0, MAX_PRODUCT_TAGS) : row.tags.filter((t) => t !== tag);
  await tx.update(schema.products).set({ tags, updatedAt: now }).where(eq(schema.products.id, productId));
  return true;
}

/** The last changes, newest first, for the Products page. */
export async function recentBulkEdits(db: Db, shopId: string, now = new Date(), limit = 5) {
  const rows = await db.query.bulkEdits.findMany({ where: eq(schema.bulkEdits.shopId, shopId), orderBy: desc(schema.bulkEdits.createdAt), limit });
  return rows.map((r) => ({ id: r.id, summary: r.summary, createdAt: r.createdAt, undoneAt: r.undoneAt, canUndo: !r.undoneAt && now.getTime() - r.createdAt.getTime() <= UNDO_DAYS * DAY }));
}
