// Deal of the day: a run of one-product sales, one a day, each from midnight to midnight in the
// store's time zone ("Advent deals", "12 days of Christmas"). They're ordinary sales underneath, so
// the cart, the countdown and the sale results work as they do for any sale. The store's /deal link
// always goes to the deal that's on, which makes it the one link to share for the whole run.
import { and, asc, count, eq, gt, inArray, lt } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { UserError } from "./errors";
import { createSale, MAX_SALE_PERCENT, MAX_SALES } from "./sales";
import { defaultCutoffZone, instantAt } from "./ship-cutoff";

export const DAILY_DEALS_MIN = 2;
export const DAILY_DEALS_MAX = 14;
export const DAILY_DEAL_PREFIX = "Deal of the day: ";
const DAY = 86_400_000;

type DealShop = { id: string; country: string; shipCutoff: { timeZone: string } | null };
const zoneOf = (shop: DealShop) => shop.shipCutoff?.timeZone ?? defaultCutoffZone(shop.country);
const dayLabel = (day: number) => new Date(day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** "Deal of the day: <product>", cut to fit a sale's 60-character name. */
export function dealTitle(product: string) {
  const room = 60 - DAILY_DEAL_PREFIX.length;
  return DAILY_DEAL_PREFIX + (product.length > room ? `${product.slice(0, room - 1).trimEnd()}…` : product);
}

/**
 * Plans one deal a day from `startDate` (YYYY-MM-DD in the store's time zone), in the order the
 * products are given, each at `percentOff`. A run that starts today starts now. Refused when a day
 * already has a deal, a product can't be sold, or the store has no room for that many sales.
 */
export async function planDailyDeals(db: Db, shop: DealShop, input: { productIds: string[]; percentOff: number; startDate: string }, now = new Date()) {
  const productIds = input.productIds.filter(Boolean);
  if (productIds.length < DAILY_DEALS_MIN) throw new UserError(`Pick a product for at least ${DAILY_DEALS_MIN} days.`);
  if (productIds.length > DAILY_DEALS_MAX) throw new UserError(`A run of deals lasts up to ${DAILY_DEALS_MAX} days.`);
  if (new Set(productIds).size !== productIds.length) throw new UserError("Pick each product once: a deal that comes back the next week isn't much of a deal.");
  const pct = Number(input.percentOff);
  if (!Number.isInteger(pct) || pct < 1 || pct > MAX_SALE_PERCENT) throw new UserError(`Enter a discount from 1% to ${MAX_SALE_PERCENT}%.`);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.startDate ?? "");
  if (!match) throw new UserError("Pick the day the first deal is on.");
  const first = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const zone = zoneOf(shop);
  const today = Date.parse(`${now.toLocaleDateString("en-CA", { timeZone: zone })}T00:00:00Z`);
  if (Number.isNaN(first) || first < today) throw new UserError("Pick today or a day after it for the first deal.");
  if (first > today + 365 * DAY) throw new UserError("Pick a first day within the next year.");

  const products = await db.query.products.findMany({
    where: and(eq(schema.products.shopId, shop.id), inArray(schema.products.id, productIds)),
    columns: { id: true, title: true, status: true, giftCard: true },
  });
  if (products.length !== productIds.length) throw new UserError("Pick products from your store.");
  if (products.some((p) => p.giftCard)) throw new UserError("Gift cards can't go on sale.");
  const hidden = products.find((p) => p.status !== "active");
  if (hidden) throw new UserError(`${hidden.title} isn't on your store. Publish it first, or pick another product.`);

  const days = productIds.map((_, i) => ({ startsAt: instantAt(first + i * DAY, 0, zone), endsAt: instantAt(first + (i + 1) * DAY, 0, zone) }));
  const from = days[0]!.startsAt;
  const until = days[days.length - 1]!.endsAt;
  // One deal a day, so /deal always knows where to go.
  const clash = await db.query.sales.findFirst({
    where: and(eq(schema.sales.shopId, shop.id), eq(schema.sales.dailyDeal, true), lt(schema.sales.startsAt, until), gt(schema.sales.endsAt, from > now ? from : now)),
    orderBy: asc(schema.sales.startsAt),
  });
  if (clash) {
    throw new UserError(`You already have a deal of the day on ${dayLabel(Date.parse(`${clash.startsAt.toLocaleDateString("en-CA", { timeZone: zone })}T00:00:00Z`))}. Start after your current deals end, or delete them first.`);
  }
  const [{ n }] = (await db.select({ n: count() }).from(schema.sales).where(eq(schema.sales.shopId, shop.id))) as [{ n: number }];
  if (n + productIds.length > MAX_SALES) {
    const room = Math.max(0, MAX_SALES - n);
    throw new UserError(`Each deal is a sale, and a store keeps up to ${MAX_SALES}. You have room for ${room === 1 ? "1 more" : `${room} more`}: delete old sales first, or plan fewer days.`);
  }
  const byId = new Map(products.map((p) => [p.id, p]));
  return db.transaction(async (tx) => {
    const made = [];
    for (const [i, id] of productIds.entries()) {
      made.push(
        await createSale(
          tx as unknown as Db,
          shop.id,
          { title: dealTitle(byId.get(id)!.title), percentOff: pct, scope: "products", productIds: [id], startsAt: days[i]!.startsAt, endsAt: days[i]!.endsAt, countdown: true, dailyDeal: true },
          now,
        ),
      );
    }
    return made;
  });
}

export type DailyDeal = {
  saleId: string;
  percentOff: number;
  startsAt: Date;
  endsAt: Date;
  product: { id: string; title: string; handle: string };
};

/** Deals that are on or still to come, in order, with their products. Deals for products no longer on the store are left out. */
export async function upcomingDailyDeals(db: Db, shopId: string, now = new Date()): Promise<DailyDeal[]> {
  const sales = await db.query.sales.findMany({
    where: and(eq(schema.sales.shopId, shopId), eq(schema.sales.dailyDeal, true), gt(schema.sales.endsAt, now)),
    orderBy: asc(schema.sales.startsAt),
    limit: MAX_SALES,
  });
  const ids = [...new Set(sales.flatMap((s) => s.productIds))];
  const products = ids.length
    ? await db.query.products.findMany({
        where: and(eq(schema.products.shopId, shopId), inArray(schema.products.id, ids), eq(schema.products.status, "active")),
        columns: { id: true, title: true, handle: true },
      })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  return sales.flatMap((s) => {
    const product = byId.get(s.productIds[0] ?? "");
    return product && s.endsAt ? [{ saleId: s.id, percentOff: s.percentOff, startsAt: s.startsAt, endsAt: s.endsAt, product }] : [];
  });
}

/** The deal on now and the next one, for the store's /deal link. */
export async function currentDailyDeal(db: Db, shopId: string, now = new Date()) {
  const deals = await upcomingDailyDeals(db, shopId, now);
  const today = deals.find((d) => d.startsAt <= now) ?? null;
  const next = deals.find((d) => d.startsAt > now) ?? null;
  return { today, next };
}
