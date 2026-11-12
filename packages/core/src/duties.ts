// Import duties: a parcel crossing a border can owe customs duty or import tax on arrival. Buyers
// who aren't told refuse the parcel or open a dispute, so the store says up front either that the
// buyer pays them to customs on delivery, or that its prices already include them. Nothing is said
// for orders inside the store's own country, or between two EU countries (one customs union).
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { UserError } from "./errors";
import { listShippingZones, EVERYWHERE_ELSE, countryName } from "./shipping";
import { EU_VAT } from "./tax";

type Shop = typeof schema.shops.$inferSelect;
export type DutiesPolicy = Shop["duties"];
export const DUTIES_POLICIES = ["off", "buyer_pays", "included"] as const satisfies readonly DutiesPolicy[];

export async function setDuties(db: Db, shopId: string, policy: string) {
  if (!(DUTIES_POLICIES as readonly string[]).includes(policy)) throw new UserError("Pick what buyers abroad are told about import duties.");
  await db.update(schema.shops).set({ duties: policy as DutiesPolicy, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return policy as DutiesPolicy;
}

/** Whether an order from a store in `home` to `country` crosses a customs border. */
export function crossesCustoms(home: string, country: string) {
  if (home === country) return false;
  return !(home in EU_VAT && country in EU_VAT);
}

/**
 * What to tell a buyer in `country` about duties: null when nothing needs saying. `from` is where
 * the parcel leaves from, the store's country unless a product ships from a warehouse abroad.
 * Pass several for a cart: one crossing a border is enough.
 */
export function dutiesFor(shop: Pick<Shop, "duties" | "country">, country: string, from: string | null | (string | null)[] = null): Exclude<DutiesPolicy, "off"> | null {
  if (shop.duties === "off") return null;
  const origins = (Array.isArray(from) ? from : [from]).map((c) => c ?? shop.country);
  if (!origins.some((o) => crossesCustoms(o, country))) return null;
  return shop.duties;
}

const DAY = 86_400_000;

/**
 * The country most of the store's buyers are in: the most common delivery country on paid orders
 * in the last 90 days, else the US when the store ships there (most dropshipping buyers are), else null.
 */
export async function mainMarket(db: Db, shopId: string, now = new Date()) {
  const country = sql<string>`${schema.orders.shippingAddress}->>'country'`;
  const [top] = await db
    .select({ country, n: sql<number>`count(*)::int` })
    .from(schema.orders)
    .where(and(eq(schema.orders.shopId, shopId), inArray(schema.orders.paymentStatus, ["paid", "partially_refunded", "refunded"]), gte(schema.orders.paidAt, new Date(now.getTime() - 90 * DAY))))
    .groupBy(country)
    .orderBy(sql`count(*) desc`, country)
    .limit(1);
  if (top?.country) return top.country;
  return (await zonesReach(db, shopId, "US")) ? "US" : null;
}

/** Whether the store's shipping zones reach a country (a store without zones ships everywhere). */
export async function zonesReach(db: Db, shopId: string, country: string) {
  const { zones } = await listShippingZones(db, shopId);
  return zones.some((z) => z.rates.length > 0 && (z.countries.includes(country) || z.countries.includes(EVERYWHERE_ELSE)));
}

/**
 * The warning shown while pricing a product that ships into the US from abroad: since the US ended
 * duty-free entry for small parcels in 2025, US buyers can owe duty and a customs fee on delivery,
 * which turns into refused parcels and disputes. Null when it ships from the US or the store
 * doesn't sell there.
 */
export function usDutyWarning(origin: string, sellsToUs: boolean) {
  if (!sellsToUs || origin === "US") return null;
  return `US buyers may owe import duty and a customs fee on parcels from ${countryName(origin)}: the US ended duty-free entry for small parcels in 2025. Price it with that in mind, pick a US warehouse when the supplier has one, or include duties in your price under Taxes.`;
}
