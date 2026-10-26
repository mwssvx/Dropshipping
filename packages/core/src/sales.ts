// Sales: a percentage off everything, one collection, or chosen products, between two times.
// While a sale runs, the store shows the sale price with the old price crossed out, and the cart
// charges it; quantity, wholesale and bundle discounts come off the sale price. It ends by itself.
// Overlapping sales don't add up: a product gets the biggest one. Gift cards are never on sale.
import { and, asc, count, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { collectionMembership } from "./collections";
import { NotFoundError, UserError } from "./errors";
import { percentOff } from "./wholesale";

export const MAX_SALES = 50;
export const MAX_SALE_PERCENT = 90;

type Sale = typeof schema.sales.$inferSelect;

const saleInput = z
  .object({
    title: z.string().trim().min(1, "Give the sale a name, like Summer sale.").max(60, "Keep the name under 60 characters."),
    percentOff: z.coerce
      .number({ error: "Enter the discount as a number." })
      .int("Use a whole number for the discount.")
      .min(1, "Enter a discount of at least 1%.")
      .max(MAX_SALE_PERCENT, `A sale takes up to ${MAX_SALE_PERCENT}% off.`),
    scope: z.enum(["all", "collection", "products"]),
    collectionId: z.string().uuid().nullish(),
    productIds: z.array(z.string().uuid("Pick products from your store.")).max(200, "Pick up to 200 products, or use a collection.").default([]),
    startsAt: z.date({ error: "Pick when the sale starts." }),
    endsAt: z.date().nullish(),
    countdown: z.boolean().default(false),
  })
  .refine((s) => !s.endsAt || s.endsAt > s.startsAt, { message: "The sale has to end after it starts." })
  .refine((s) => s.scope !== "collection" || !!s.collectionId, { message: "Pick the collection that's on sale." })
  .refine((s) => s.scope !== "products" || s.productIds.length > 0, { message: "Pick at least one product." });
export type SaleInput = z.input<typeof saleInput>;

export async function createSale(db: Db, shopId: string, input: SaleInput, now = new Date()) {
  const parsed = saleInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const data = parsed.data;
  if (data.endsAt && data.endsAt <= now) throw new UserError("That end time has already passed.");
  if (data.countdown && !data.endsAt) throw new UserError("A countdown needs an end time. Pick when the sale ends.");
  const [{ n }] = (await db.select({ n: count() }).from(schema.sales).where(eq(schema.sales.shopId, shopId))) as [{ n: number }];
  if (n >= MAX_SALES) throw new UserError(`A store can keep up to ${MAX_SALES} sales. Delete old ones first.`);
  let productIds: string[] = [];
  if (data.scope === "products") {
    productIds = [...new Set(data.productIds)];
    const rows = await db.query.products.findMany({
      where: and(eq(schema.products.shopId, shopId), inArray(schema.products.id, productIds)),
      columns: { id: true, giftCard: true },
    });
    if (rows.length !== productIds.length) throw new UserError("Pick products from your store.");
    if (rows.some((r) => r.giftCard)) throw new UserError("Gift cards can't go on sale.");
  }
  if (data.scope === "collection") {
    const c = await db.query.collections.findFirst({ where: and(eq(schema.collections.id, data.collectionId!), eq(schema.collections.shopId, shopId)) });
    if (!c) throw new UserError("Pick a collection from your store.");
  }
  const [row] = await db
    .insert(schema.sales)
    .values({
      shopId,
      title: data.title,
      percentOff: data.percentOff,
      scope: data.scope,
      collectionId: data.scope === "collection" ? data.collectionId! : null,
      productIds,
      // A start in the past means now, so the list reads true.
      startsAt: data.startsAt < now ? now : data.startsAt,
      endsAt: data.endsAt ?? null,
      countdown: data.countdown,
    })
    .returning();
  return row!;
}

/** Stops a running sale now. A sale that hasn't started is deleted instead. */
export async function endSale(db: Db, shopId: string, saleId: string, now = new Date()) {
  const sale = await db.query.sales.findFirst({ where: and(eq(schema.sales.id, saleId), eq(schema.sales.shopId, shopId)) });
  if (!sale) throw new NotFoundError("Sale");
  if (sale.startsAt > now) return deleteSale(db, shopId, saleId);
  if (sale.endsAt && sale.endsAt <= now) return;
  await db.update(schema.sales).set({ endsAt: now, updatedAt: now }).where(eq(schema.sales.id, sale.id));
}

export async function deleteSale(db: Db, shopId: string, saleId: string) {
  const [row] = await db.delete(schema.sales).where(and(eq(schema.sales.id, saleId), eq(schema.sales.shopId, shopId))).returning({ id: schema.sales.id });
  if (!row) throw new NotFoundError("Sale");
}

export type SaleStatus = "scheduled" | "running" | "ended";
export const saleStatus = (sale: Pick<Sale, "startsAt" | "endsAt">, now = new Date()): SaleStatus =>
  sale.startsAt > now ? "scheduled" : sale.endsAt && sale.endsAt <= now ? "ended" : "running";

/** Every sale, newest first, with what it covers in words. */
export async function listSales(db: Db, shopId: string, now = new Date()) {
  const rows = await db.query.sales.findMany({ where: eq(schema.sales.shopId, shopId), orderBy: asc(schema.sales.startsAt) });
  const collectionIds = [...new Set(rows.map((r) => r.collectionId).filter((c): c is string => !!c))];
  const collections = collectionIds.length
    ? await db.query.collections.findMany({ where: inArray(schema.collections.id, collectionIds), columns: { id: true, title: true } })
    : [];
  const names = new Map(collections.map((c) => [c.id, c.title]));
  const order: Record<SaleStatus, number> = { running: 0, scheduled: 1, ended: 2 };
  return rows
    .map((r) => ({
      ...r,
      status: saleStatus(r, now),
      covers:
        r.scope === "all"
          ? "Everything except gift cards"
          : r.scope === "collection"
            ? `The ${names.get(r.collectionId!) ?? "removed"} collection`
            : `${r.productIds.length} ${r.productIds.length === 1 ? "product" : "products"}`,
    }))
    .sort((a, b) => order[a.status] - order[b.status] || (a.status === "ended" ? b.startsAt.getTime() - a.startsAt.getTime() : 0));
}

export type SaleInfo = { id: string; title: string; percentOff: number; startsAt: Date; endsAt: Date | null; countdown: boolean };

/** How close to the end a countdown shows, so a long sale doesn't tick for weeks. */
export const COUNTDOWN_WINDOW_MS = 7 * 86_400_000;

/** The end time to count down to on the store, or null when there's nothing to count. */
export function countdownTo(sale: Pick<SaleInfo, "endsAt" | "countdown"> | null | undefined, now = new Date()) {
  if (!sale?.countdown || !sale.endsAt) return null;
  const left = sale.endsAt.getTime() - now.getTime();
  return left > 0 && left <= COUNTDOWN_WINDOW_MS ? sale.endsAt : null;
}

/** A running sale on everything that counts down, for the banner across the store (the biggest one). */
export async function storeWideCountdown(db: Db, shopId: string, now = new Date()) {
  const running = await db.query.sales.findMany({
    where: and(eq(schema.sales.shopId, shopId), eq(schema.sales.scope, "all"), eq(schema.sales.countdown, true), lte(schema.sales.startsAt, now), gt(schema.sales.endsAt, now)),
  });
  const sale = running.sort((a, b) => b.percentOff - a.percentOff)[0];
  const endsAt = countdownTo(sale, now);
  return sale && endsAt ? { title: sale.title, percentOff: sale.percentOff, endsAt } : null;
}

/** The sale each product is in right now (the biggest, when several overlap). */
export async function salesFor(db: Db, shopId: string, productIds: string[], now = new Date()): Promise<Map<string, SaleInfo>> {
  const result = new Map<string, SaleInfo>();
  const ids = [...new Set(productIds)];
  if (!ids.length) return result;
  const running = await db.query.sales.findMany({
    where: and(eq(schema.sales.shopId, shopId), lte(schema.sales.startsAt, now), or(isNull(schema.sales.endsAt), gt(schema.sales.endsAt, now))),
  });
  if (!running.length) return result;
  const products = await db.query.products.findMany({
    where: and(eq(schema.products.shopId, shopId), inArray(schema.products.id, ids), eq(schema.products.giftCard, false)),
    columns: { id: true },
  });
  const collectionIds = running.map((s) => s.collectionId).filter((c): c is string => !!c);
  const members = await collectionMembership(db, shopId, collectionIds, ids);
  for (const { id } of products) {
    for (const s of running) {
      const covers =
        s.scope === "all" ||
        (s.scope === "products" && s.productIds.includes(id)) ||
        (s.scope === "collection" && !!members.get(s.collectionId!)?.has(id));
      if (covers && s.percentOff > (result.get(id)?.percentOff ?? 0)) result.set(id, { id: s.id, title: s.title, percentOff: s.percentOff, startsAt: s.startsAt, endsAt: s.endsAt, countdown: s.countdown });
    }
  }
  return result;
}

/** A price during a sale, and the price to show crossed out. */
export function salePrice(priceMinor: number, compareAtMinor: number | null, sale: Pick<SaleInfo, "percentOff"> | null | undefined) {
  if (!sale) return { priceMinor, compareAtMinor };
  return { priceMinor: percentOff(priceMinor, sale.percentOff), compareAtMinor: Math.max(compareAtMinor ?? 0, priceMinor) };
}

type Priced = { priceMinor: number; compareAtMinor?: number | null };
type Sellable = { id: string; priceMinor?: number | null; compareAtMinor?: number | null; variants?: Priced[] };

/**
 * Products as the store shows them right now: prices (and each option's price) with any running
 * sale applied, and the sale itself for a note. Works on full products and on compact cards.
 */
export async function withSales<T extends Sellable>(db: Db, shopId: string, items: T[], now = new Date()): Promise<(T & { sale: SaleInfo | null })[]> {
  const sales = await salesFor(db, shopId, items.map((i) => i.id), now);
  return items.map((item) => {
    const sale = sales.get(item.id) ?? null;
    if (!sale) return { ...item, sale };
    const next = { ...item, sale } as T & { sale: SaleInfo | null };
    if (typeof item.priceMinor === "number") Object.assign(next, salePrice(item.priceMinor, item.compareAtMinor ?? null, sale));
    if (item.variants) next.variants = item.variants.map((v) => ({ ...v, ...salePrice(v.priceMinor, v.compareAtMinor ?? null, sale) }));
    return next;
  });
}
