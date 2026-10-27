// Shipping zones and rates. A zone is a list of countries ("*" means everywhere else) with one or
// more rates; the buyer picks a rate at checkout. A store that hasn't set up zones ships
// everywhere at the built-in default rate, so nothing changes until the merchant opts in.
import { and, asc, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import { formatMoney } from "./money";
import { LAUNCH_COUNTRIES } from "./shops";
import { formatWeight, MAX_WEIGHT_GRAMS } from "./weight";

type Shop = typeof schema.shops.$inferSelect;

export const EVERYWHERE_ELSE = "*";
export const DEFAULT_RATE_ID = "default";
// The built-in rate for stores without zones: 4.99, free over 50.
export const FREE_SHIPPING_OVER_MINOR = 5000;
export const FLAT_SHIPPING_MINOR = 499;

/** Countries buyers can pick at checkout when a store ships everywhere. */
export const SHIPPING_COUNTRIES = [...LAUNCH_COUNTRIES, "AU", "NZ", "CH", "NO", "IS", "JP", "SG", "KR", "MX", "IL", "AE"] as const;

const names = new Intl.DisplayNames(["en"], { type: "region" });
export const countryName = (code: string) => (code === EVERYWHERE_ELSE ? "Everywhere else" : (names.of(code) ?? code));

export type Rate = {
  id: string;
  name: string;
  priceMinor: number;
  freeOverMinor: number | null;
  minDays: number | null;
  maxDays: number | null;
  /** Offered only for carts from / up to this weight. Empty means any weight. */
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
};

export type Zone = { id: string; name: string; countries: string[]; rates: Rate[] };

const DEFAULT_ZONE: Zone = {
  id: DEFAULT_RATE_ID,
  name: "Everywhere",
  countries: [EVERYWHERE_ELSE],
  rates: [{ id: DEFAULT_RATE_ID, name: "Standard", priceMinor: FLAT_SHIPPING_MINOR, freeOverMinor: FREE_SHIPPING_OVER_MINOR, minDays: null, maxDays: null, minWeightGrams: null, maxWeightGrams: null }],
};

/** The store's zones with their rates, or the built-in default if it has none. */
export async function listShippingZones(db: Db, shopId: string): Promise<{ zones: Zone[]; isDefault: boolean }> {
  const zones = await db.query.shippingZones.findMany({ where: eq(schema.shippingZones.shopId, shopId), orderBy: asc(schema.shippingZones.createdAt) });
  if (!zones.length) return { zones: [DEFAULT_ZONE], isDefault: true };
  const rates = await db.query.shippingRates.findMany({
    where: inArray(schema.shippingRates.zoneId, zones.map((z) => z.id)),
    orderBy: [asc(schema.shippingRates.priceMinor), asc(schema.shippingRates.createdAt)],
  });
  return {
    zones: zones.map((z) => ({
      id: z.id,
      name: z.name,
      countries: z.countries,
      rates: rates.filter((r) => r.zoneId === z.id).map(({ id, name, priceMinor, freeOverMinor, minDays, maxDays, minWeightGrams, maxWeightGrams }) => ({ id, name, priceMinor, freeOverMinor, minDays, maxDays, minWeightGrams, maxWeightGrams })),
    })),
    isDefault: false,
  };
}

/** The zone for a country: the one that names it, else the "everywhere else" zone. */
export function zoneFor(zones: Zone[], country: string) {
  return zones.find((z) => z.countries.includes(country)) ?? zones.find((z) => z.countries.includes(EVERYWHERE_ELSE)) ?? null;
}

/** Whether a rate is offered for a cart this heavy. Both ends count: "up to 2 kg" includes 2 kg. */
export const fitsWeight = (rate: Pick<Rate, "minWeightGrams" | "maxWeightGrams">, grams: number) =>
  (rate.minWeightGrams === null || grams >= rate.minWeightGrams) && (rate.maxWeightGrams === null || grams <= rate.maxWeightGrams);

/** "up to 2 kg", "2 kg and over", "2–5 kg", or null for any weight. */
export function rateWeight(rate: Pick<Rate, "minWeightGrams" | "maxWeightGrams">) {
  const { minWeightGrams: min, maxWeightGrams: max } = rate;
  if (min === null && max === null) return null;
  if (min === null) return `up to ${formatWeight(max!)}`;
  if (max === null) return `${formatWeight(min)} and over`;
  // "2–10 kg" rather than "2 kg–10 kg" when both are in kilograms.
  const from = min >= 1000 && max! >= 1000 ? formatWeight(min).replace(" kg", "") : formatWeight(min);
  return `${from}–${formatWeight(max!)}`;
}

/** What a rate costs for this much in goods. */
export const priceRate = (rate: Rate, goodsMinor: number) => (rate.freeOverMinor !== null && goodsMinor >= rate.freeOverMinor ? 0 : rate.priceMinor);

/** "3–5 days", or null if the merchant didn't say. */
export function rateDays(rate: Pick<Rate, "minDays" | "maxDays">) {
  if (rate.minDays === null || rate.maxDays === null) return null;
  return rate.minDays === rate.maxDays ? `${rate.minDays} days` : `${rate.minDays}–${rate.maxDays} days`;
}

export function describeRate(rate: Rate, currency: string) {
  const days = rateDays(rate);
  const price = rate.priceMinor ? formatMoney(rate.priceMinor, currency) : "Free";
  const free = rate.priceMinor && rate.freeOverMinor !== null ? `, free over ${formatMoney(rate.freeOverMinor, currency)}` : "";
  const weight = rateWeight(rate);
  return `${rate.name}${weight ? ` (orders ${weight})` : ""}: ${price}${free}${days ? ` (${days})` : ""}`;
}

/** The countries a buyer can pick at checkout. */
export function shipsTo(zones: Zone[]) {
  const usable = zones.filter((z) => z.rates.length);
  if (usable.some((z) => z.countries.includes(EVERYWHERE_ELSE))) return [...SHIPPING_COUNTRIES];
  return [...new Set(usable.flatMap((z) => z.countries))];
}

/** Plain-language shipping prices, for the support assistant. */
export async function describeShipping(db: Db, shop: Shop) {
  const { zones } = await listShippingZones(db, shop.id);
  return zones
    .filter((z) => z.rates.length)
    .map((z) => `${z.countries.map(countryName).join(", ")}: ${z.rates.map((r) => describeRate(r, shop.currency)).join("; ")}`)
    .join("\n");
}

// Editing -------------------------------------------------------------------------------------

const zoneInput = z.object({
  name: z.string().trim().min(1, "Give the zone a name, like Europe.").max(60, "Keep the name under 60 characters."),
  countries: z
    .array(z.string())
    .min(1, "Pick at least one country.")
    .refine((cs) => cs.every((c) => c === EVERYWHERE_ELSE || (SHIPPING_COUNTRIES as readonly string[]).includes(c)), "That country isn't one we ship to yet."),
});

async function checkOverlap(db: Db, shopId: string, countries: string[], exceptZoneId?: string) {
  const others = (await db.query.shippingZones.findMany({ where: eq(schema.shippingZones.shopId, shopId) })).filter((z) => z.id !== exceptZoneId);
  for (const c of countries) {
    const taken = others.find((z) => z.countries.includes(c));
    if (taken) throw new UserError(`${countryName(c)} is already in ${taken.name}. A country can only be in one zone.`);
  }
}

export async function createShippingZone(db: Db, shopId: string, input: z.input<typeof zoneInput>) {
  const parsed = zoneInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const countries = [...new Set(parsed.data.countries)];
  await checkOverlap(db, shopId, countries);
  const [zone] = await db.insert(schema.shippingZones).values({ shopId, name: parsed.data.name, countries }).returning();
  return zone!;
}

export async function updateShippingZone(db: Db, shopId: string, zoneId: string, input: z.input<typeof zoneInput>) {
  const parsed = zoneInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const countries = [...new Set(parsed.data.countries)];
  await checkOverlap(db, shopId, countries, zoneId);
  const [zone] = await db
    .update(schema.shippingZones)
    .set({ name: parsed.data.name, countries })
    .where(and(eq(schema.shippingZones.id, zoneId), eq(schema.shippingZones.shopId, shopId)))
    .returning();
  if (!zone) throw new NotFoundError("Shipping zone");
  return zone;
}

export async function deleteShippingZone(db: Db, shopId: string, zoneId: string) {
  const [zone] = await db
    .delete(schema.shippingZones)
    .where(and(eq(schema.shippingZones.id, zoneId), eq(schema.shippingZones.shopId, shopId)))
    .returning({ id: schema.shippingZones.id });
  if (!zone) throw new NotFoundError("Shipping zone");
}

const rateInput = z
  .object({
    name: z.string().trim().min(1, "Name the rate, like Standard or Express.").max(40, "Keep the name under 40 characters."),
    priceMinor: z.number().int().min(0, "The price can't be negative.").max(1_000_000),
    freeOverMinor: z.number().int().min(1, "Leave \"Free over\" empty, or enter an amount.").max(100_000_000).nullable(),
    minDays: z.number().int().min(0).max(120).nullable(),
    maxDays: z.number().int().min(0).max(120).nullable(),
    minWeightGrams: z.number().int().min(0, "The weight can't be negative.").max(MAX_WEIGHT_GRAMS, "Keep the weight under 1,000 kg.").nullable().default(null),
    maxWeightGrams: z.number().int().min(1, "Leave \"Up to\" empty, or enter a weight over 0.").max(MAX_WEIGHT_GRAMS, "Keep the weight under 1,000 kg.").nullable().default(null),
  })
  .refine((r) => r.minDays === null || r.maxDays === null || r.minDays <= r.maxDays, "The fastest delivery can't be slower than the slowest.")
  .refine((r) => r.minWeightGrams === null || r.maxWeightGrams === null || r.minWeightGrams < r.maxWeightGrams, "The lightest weight has to be under the heaviest.")
  // "From 0" means any weight up to the limit.
  .transform((r) => ({ ...r, minWeightGrams: r.minWeightGrams || null }));

export async function addShippingRate(db: Db, shopId: string, zoneId: string, input: z.input<typeof rateInput>) {
  const parsed = rateInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const zone = await db.query.shippingZones.findFirst({ where: and(eq(schema.shippingZones.id, zoneId), eq(schema.shippingZones.shopId, shopId)) });
  if (!zone) throw new NotFoundError("Shipping zone");
  const count = await db.query.shippingRates.findMany({ where: eq(schema.shippingRates.zoneId, zone.id), columns: { id: true } });
  if (count.length >= 5) throw new UserError("Up to 5 rates per zone.");
  const [rate] = await db.insert(schema.shippingRates).values({ zoneId: zone.id, shopId, ...parsed.data }).returning();
  return rate!;
}

export async function deleteShippingRate(db: Db, shopId: string, rateId: string) {
  const [rate] = await db
    .delete(schema.shippingRates)
    .where(and(eq(schema.shippingRates.id, rateId), eq(schema.shippingRates.shopId, shopId)))
    .returning({ id: schema.shippingRates.id });
  if (!rate) throw new NotFoundError("Shipping rate");
}

/**
 * Replaces the built-in default with two zones to edit: the store's own country (Standard, free
 * over the usual amount, and Express) and everywhere else.
 */
export async function setUpStarterZones(db: Db, shop: Shop) {
  const existing = await db.query.shippingZones.findFirst({ where: eq(schema.shippingZones.shopId, shop.id) });
  if (existing) throw new UserError("You already have shipping zones.");
  await db.transaction(async (tx) => {
    const [home] = await tx.insert(schema.shippingZones).values({ shopId: shop.id, name: countryName(shop.country), countries: [shop.country] }).returning();
    const [rest] = await tx.insert(schema.shippingZones).values({ shopId: shop.id, name: "International", countries: [EVERYWHERE_ELSE] }).returning();
    await tx.insert(schema.shippingRates).values([
      { zoneId: home!.id, shopId: shop.id, name: "Standard", priceMinor: FLAT_SHIPPING_MINOR, freeOverMinor: FREE_SHIPPING_OVER_MINOR, minDays: 5, maxDays: 10 },
      { zoneId: home!.id, shopId: shop.id, name: "Express", priceMinor: 1499, freeOverMinor: null, minDays: 2, maxDays: 4 },
      { zoneId: rest!.id, shopId: shop.id, name: "Standard", priceMinor: 1499, freeOverMinor: null, minDays: 7, maxDays: 20 },
    ]);
  });
}
