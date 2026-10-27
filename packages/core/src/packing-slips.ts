// Packing slips: a printable page that goes in the parcel, for merchants who pack orders
// themselves or send stock from their own shelf. It says who it's for and what should be in the
// box, with no prices, so it also works for gifts. A store can print a note at the foot, like a
// thank-you or a code for next time. Slips come one order at a time from the order page, or all
// the orders waiting for tracking at once, one per sheet.
import { and, asc, eq, inArray } from "drizzle-orm";
import { schema, type Address, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { describePersonalization } from "./personalization";
import { ordersWaitingForTracking } from "./tracking-import";

export const MAX_PACKING_SLIP_NOTE = 500;
/** More than this at once is too many to print in one go. */
export const MAX_PACKING_SLIPS = 200;

export type PackingSlip = {
  orderId: string;
  number: number;
  placedAt: Date;
  shipTo: Address;
  items: { title: string; sku: string | null; quantity: number; personalization: string | null; preorder: boolean }[];
  gift: { from: string; message: string | null } | null;
  buyerNote: string | null;
};

/** The store's name, address and note, and a slip for each order, in order number order. */
export async function packingSlips(db: Db, shopId: string, scope: { orderId: string } | "waiting") {
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
  if (!shop) throw new NotFoundError("Store");
  let orders;
  if (scope === "waiting") {
    orders = (await ordersWaitingForTracking(db, shopId)).slice(0, MAX_PACKING_SLIPS);
  } else {
    const order = await db.query.orders.findFirst({ where: and(eq(schema.orders.id, scope.orderId), eq(schema.orders.shopId, shopId)) });
    if (!order) throw new NotFoundError("Order");
    orders = [order];
  }
  const ids = orders.map((o) => o.id);
  const lines = ids.length
    ? await db.query.orderLines.findMany({ where: inArray(schema.orderLines.orderId, ids), orderBy: asc(schema.orderLines.title) })
    : [];
  const variantIds = [...new Set(lines.map((l) => l.variantId).filter((v): v is string => !!v))];
  const skus = new Map(
    (variantIds.length ? await db.query.variants.findMany({ where: inArray(schema.variants.id, variantIds), columns: { id: true, sku: true } }) : []).map((v) => [v.id, v.sku]),
  );
  const slips: PackingSlip[] = orders.map((o) => ({
    orderId: o.id,
    number: o.number,
    placedAt: o.createdAt,
    shipTo: o.shippingAddress,
    items: lines
      .filter((l) => l.orderId === o.id)
      .map((l) => ({
        title: l.title,
        sku: (l.variantId && skus.get(l.variantId)) || null,
        quantity: l.quantity,
        personalization: describePersonalization(l.personalization),
        preorder: l.preorder,
      })),
    gift: o.gift ? { from: o.gift.from, message: o.gift.message } : null,
    buyerNote: o.buyerNote,
  }));
  return {
    store: { name: shop.name, address: shop.mailingAddress, note: shop.packingSlipNote },
    slips,
  };
}

/** Sets the note printed at the foot of every packing slip, or removes it (empty). */
export async function setPackingSlipNote(db: Db, shopId: string, note: string | null) {
  const value = (note ?? "").trim().replace(/\r\n/g, "\n") || null;
  if (value && value.length > MAX_PACKING_SLIP_NOTE) throw new UserError(`Keep the note under ${MAX_PACKING_SLIP_NOTE} characters.`);
  await db.update(schema.shops).set({ packingSlipNote: value }).where(eq(schema.shops.id, shopId));
  return value;
}
