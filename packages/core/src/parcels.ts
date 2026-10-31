// Orders that come in more than one parcel. A dropshipping cart often mixes products from different
// suppliers (and the merchant's own shelf), and each sends its own parcel on its own day. Buyers who
// get half an order think the rest is lost and write in, or open a dispute. So the cart and checkout
// say up front that it comes in N parcels, the buyer's order page lists what's in each one with its
// own tracking, and each parcel gets its own shipping email saying what's in it and what's still to come.
import { eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";

type Fulfillment = typeof schema.fulfillments.$inferSelect;

/** Where a product's parcel leaves from: its supplier, or the store's own shelf. */
export const parcelKey = (product: { supplierId: string | null }) => product.supplierId ?? "own";

/** How many parcels these products come in. Gift cards and downloads don't ship. */
export const parcelCount = (products: { supplierId: string | null; giftCard?: boolean; digital?: boolean }[]) =>
  new Set(products.filter((p) => !p.giftCard && !p.digital).map(parcelKey)).size;

export type Parcel = {
  key: string;
  items: { title: string; quantity: number }[];
  /** The parcel once the supplier or the merchant has it, with its tracking when shipped. */
  shipment: Pick<Fulfillment, "id" | "status" | "carrier" | "trackingNumber" | "trackingUrl" | "shippedAt" | "deliveredAt" | "createdAt"> | null;
};

/**
 * An order's lines grouped into the parcels they come in, each with its shipment. Empty when it
 * all comes in one parcel, which the order page already covers.
 */
export async function orderParcels(
  db: Db,
  order: { lines: { title: string; quantity: number; variantId: string | null }[]; fulfillments: Fulfillment[] },
): Promise<Parcel[]> {
  const ids = order.lines.map((l) => l.variantId).filter((v): v is string => !!v);
  if (!ids.length) return [];
  const rows = await db
    .select({ variantId: schema.variants.id, supplierId: schema.products.supplierId, giftCard: schema.products.giftCard, digital: schema.products.digital })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(inArray(schema.variants.id, ids));
  const groups = new Map<string, Parcel>();
  for (const line of order.lines) {
    const row = rows.find((r) => r.variantId === line.variantId);
    if (!row || row.giftCard || row.digital) continue;
    const key = parcelKey(row);
    const group = groups.get(key) ?? { key, items: [], shipment: null };
    group.items.push({ title: line.title, quantity: line.quantity });
    groups.set(key, group);
  }
  if (groups.size < 2) return [];
  const live = order.fulfillments.filter((f) => f.status !== "cancelled");
  for (const g of groups.values()) {
    // A backup supplier's parcel stands in for the main supplier's.
    const f = g.key === "own" ? live.find((x) => x.supplierId === null) : (live.find((x) => x.supplierId === g.key) ?? live.find((x) => x.backupForSupplierId === g.key));
    g.shipment = f ? { id: f.id, status: f.status, carrier: f.carrier, trackingNumber: f.trackingNumber, trackingUrl: f.trackingUrl, shippedAt: f.shippedAt, deliveredAt: f.deliveredAt, createdAt: f.createdAt } : null;
  }
  // Shipped parcels first, so the one on its way is at the top.
  return [...groups.values()].sort((a, b) => Number(!!b.shipment?.trackingNumber) - Number(!!a.shipment?.trackingNumber));
}

/** Parcels in the order they shipped, the ones still to ship last, so "parcel 1 of 2" stays the same. */
export const byShipping = (parcels: Parcel[]) =>
  [...parcels].sort(
    (a, b) =>
      (a.shipment?.shippedAt?.getTime() ?? Infinity) - (b.shipment?.shippedAt?.getTime() ?? Infinity) ||
      (a.shipment?.createdAt.getTime() ?? Infinity) - (b.shipment?.createdAt.getTime() ?? Infinity) ||
      (a.shipment?.id ?? "").localeCompare(b.shipment?.id ?? ""),
  );

const listItems = (p: Parcel) => p.items.map((i) => `  ${i.title}${i.quantity > 1 ? ` × ${i.quantity}` : ""}`);

/**
 * The shipping email for one parcel of an order that comes in several: what's in it, its tracking,
 * and what comes separately, so a buyer with half an order knows the rest isn't lost.
 */
export function parcelShippedEmail(input: { first: string; shopName: string; orderNumber: number; link: string; parcels: Parcel[]; index: number }) {
  const { first, shopName, orderNumber, link, index } = input;
  const parcels = byShipping(input.parcels);
  const p = parcels[index]!;
  const s = p.shipment!;
  const rest = parcels.filter((_, i) => i !== index);
  const waiting = rest.filter((r) => !r.shipment?.trackingNumber);
  return {
    subject: `Order #${orderNumber}: parcel ${index + 1} of ${parcels.length} is on its way`,
    text: [
      `Hi ${first},`,
      ``,
      `Your order from ${shopName} comes in ${parcels.length} parcels from different warehouses. Parcel ${index + 1} has shipped with:`,
      ``,
      ...listItems(p),
      ``,
      `Track it: ${s.carrier}: ${s.trackingNumber}${s.trackingUrl ? `  ${s.trackingUrl}` : ""}`,
      ``,
      ...(waiting.length
        ? [`Still to come in ${waiting.length === 1 ? "a separate parcel" : "separate parcels"}:`, ...waiting.flatMap(listItems), ``, `We'll email you its tracking as soon as it ships.`]
        : [`The rest of your order has already shipped, so this is the last parcel.`]),
      ``,
      `Order status: ${link}`,
    ].join("\n"),
  };
}
