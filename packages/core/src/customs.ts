// Customs forms. An order shipped to another country needs a customs declaration on the parcel:
// what's inside, each item's tariff (HS) code, where it was made, how many, what it's worth and
// what it weighs. Products carry their HS code and country of origin; the order page prints the
// form for orders that cross a border. Gift card lines aren't goods, so they're left off.
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Address, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";

const regions = new Intl.DisplayNames(["en"], { type: "region" });

/** A two-letter country code, or null when it isn't one. */
export function countryCode(raw: string | null | undefined) {
  const code = (raw ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  const name = regions.of(code);
  return name && name !== code && name !== "Unknown Region" ? code : null;
}

/**
 * Sets a product's HS code (6 to 10 digits, dots and spaces allowed), country of origin and the
 * country it ships from; empty clears them. Ships-from is left alone when it isn't passed, and is
 * cleared when it's the store's own country, since that's what an empty one means.
 */
export async function setCustomsInfo(db: Db, shopId: string, productId: string, input: { hsCode?: string | null; originCountry?: string | null; shipsFrom?: string | null }) {
  const digits = (input.hsCode ?? "").replace(/[\s.]/g, "");
  if (digits && !/^\d{6,10}$/.test(digits)) throw new UserError("An HS code is 6 to 10 digits, like 6912.00 or 691200.");
  const rawOrigin = (input.originCountry ?? "").trim();
  const originCountry = rawOrigin ? countryCode(rawOrigin) : null;
  if (rawOrigin && !originCountry) throw new UserError("Enter the country it was made in as a two-letter code, like CN or US.");
  let shipsFrom: string | null | undefined;
  if (input.shipsFrom !== undefined) {
    const raw = (input.shipsFrom ?? "").trim();
    shipsFrom = raw ? countryCode(raw) : null;
    if (raw && !shipsFrom) throw new UserError("Enter the country it ships from as a two-letter code, like CN or US.");
    if (shipsFrom) {
      const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId), columns: { country: true } });
      if (shop?.country === shipsFrom) shipsFrom = null;
    }
  }
  const [row] = await db
    .update(schema.products)
    .set({ hsCode: digits || null, originCountry, ...(shipsFrom !== undefined && { shipsFrom }), updatedAt: new Date() })
    .where(and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)))
    .returning({ hsCode: schema.products.hsCode, originCountry: schema.products.originCountry, shipsFrom: schema.products.shipsFrom });
  if (!row) throw new NotFoundError("Product");
  return row;
}

/** Whether an order ships to another country than the store's. */
export const crossesBorder = (order: { shippingAddress: Address | null }, shop: { country: string }) => !!order.shippingAddress && order.shippingAddress.country !== shop.country;

export type CustomsItem = { description: string; hsCode: string | null; originCountry: string | null; quantity: number; valueMinor: number; weightGrams: number | null };

/** The customs declaration for an order: from, to, and each item with its code, origin, value and weight. */
export async function customsDeclaration(db: Db, shopId: string, orderId: string) {
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
  const order = await db.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shopId)) });
  if (!shop || !order) throw new NotFoundError("Order");
  const lines = await db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
  const variantIds = [...new Set(lines.map((l) => l.variantId).filter((v): v is string => !!v))];
  const rows = variantIds.length
    ? await db
        .select({ id: schema.variants.id, weightGrams: schema.variants.weightGrams, hsCode: schema.products.hsCode, originCountry: schema.products.originCountry, giftCard: schema.products.giftCard, digital: schema.products.digital })
        .from(schema.variants)
        .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
        .where(inArray(schema.variants.id, variantIds))
    : [];
  const byVariant = new Map(rows.map((r) => [r.id, r]));
  const items: CustomsItem[] = lines
    .filter((l) => !(l.variantId && (byVariant.get(l.variantId)?.giftCard || byVariant.get(l.variantId)?.digital)))
    .map((l) => {
      const v = l.variantId ? byVariant.get(l.variantId) : undefined;
      return {
        description: l.title,
        hsCode: v?.hsCode ?? null,
        originCountry: v?.originCountry ?? null,
        quantity: l.quantity,
        valueMinor: l.unitPriceMinor * l.quantity,
        weightGrams: v?.weightGrams != null ? v.weightGrams * l.quantity : null,
      };
    });
  return {
    orderId: order.id,
    number: order.number,
    currency: order.currency,
    from: { name: shop.name, address: shop.mailingAddress, country: shop.country },
    to: order.shippingAddress,
    crossesBorder: crossesBorder(order, shop),
    /** Gifts are declared as gifts; everything else as a sale of goods. */
    kind: order.gift ? ("gift" as const) : ("sale" as const),
    items,
    totalValueMinor: items.reduce((s, i) => s + i.valueMinor, 0),
    shippingMinor: order.shippingMinor,
    /** Null when any item has no weight, since the total would be wrong. */
    totalWeightGrams: items.every((i) => i.weightGrams !== null) ? items.reduce((s, i) => s + i.weightGrams!, 0) : null,
    /** Items still missing an HS code or a country of origin, by name. */
    missing: [...new Set(items.filter((i) => !i.hsCode || !i.originCountry).map((i) => i.description))],
  };
}

/**
 * Where each physical product in a list ships from: its own ships-from country, or null for the
 * store's country. Gift cards and downloads don't ship, so they're left out.
 */
export async function shipsFromOf(db: Db, by: { productIds: string[] } | { orderId: string }): Promise<(string | null)[]> {
  const p = schema.products;
  const rows =
    "orderId" in by
      ? await db
          .select({ shipsFrom: p.shipsFrom, giftCard: p.giftCard, digital: p.digital })
          .from(schema.orderLines)
          .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
          .innerJoin(p, eq(p.id, schema.variants.productId))
          .where(eq(schema.orderLines.orderId, by.orderId))
      : by.productIds.length
        ? await db.query.products.findMany({ where: inArray(p.id, by.productIds), columns: { shipsFrom: true, giftCard: true, digital: true } })
        : [];
  return rows.filter((r) => !r.giftCard && !r.digital).map((r) => r.shipsFrom);
}
