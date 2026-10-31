// Packing slips: a printable page that goes in the parcel, for merchants who pack orders
// themselves or send stock from their own shelf. It says who it's for and what should be in the
// box, with no prices, so it also works for gifts. A store can print a note at the foot, like a
// thank-you or a code for next time. Slips come one order at a time from the order page, or all
// the orders waiting for tracking at once, one per sheet. In an order a supplier sends part of, the
// slip lists only what goes in the merchant's box and says the rest comes separately, so a buyer
// opening it doesn't think the supplier's items are missing.
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { schema, type Address, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { giftReturnCode } from "./gift-returns";
import { describePersonalization } from "./personalization";
import { ordersWaitingForTracking } from "./tracking-import";
import { groupBy } from "./group";
import { ownItemsWaiting, sameAddressOnList } from "./same-address";
import { z } from "zod";

export const MAX_PACKING_SLIP_NOTE = 500;
/** More than this at once is too many to print in one go. */
export const MAX_PACKING_SLIPS = 200;

export type PackingSlip = {
  orderId: string;
  number: number;
  placedAt: Date;
  shipTo: Address;
  items: { title: string; sku: string | null; quantity: number; personalization: string | null; preorder: boolean }[];
  /** In an order the suppliers send part of: what comes in their parcels, not this box. */
  separately: { title: string; quantity: number }[];
  /** `returnCode`: the recipient can return the gift for store credit with it (when the store takes returns). */
  gift: { from: string; message: string | null; returnCode: string | null } | null;
  /** The buyer paid to have it gift wrapped. */
  giftWrap: boolean;
  buyerNote: string | null;
  /** Other orders to the same door that also have items the store posts: they can share this box. Not printed. */
  sameBox: number[];
};

/** The store's name, address and note, and a slip for each order, in order number order. */
export async function packingSlips(db: Db, shopId: string, scope: { orderId: string } | { orderIds: string[] } | "waiting") {
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
  if (!shop) throw new NotFoundError("Store");
  let orders;
  if (scope === "waiting") {
    orders = (await ordersWaitingForTracking(db, shopId)).slice(0, MAX_PACKING_SLIPS);
  } else if ("orderIds" in scope) {
    // Orders picked on the order list, oldest first like the waiting ones. Ids from another store are left out.
    const ids = scope.orderIds.filter((id) => z.string().uuid().safeParse(id).success).slice(0, MAX_PACKING_SLIPS);
    orders = ids.length
      ? await db.query.orders.findMany({ where: and(eq(schema.orders.shopId, shopId), inArray(schema.orders.id, ids)), orderBy: asc(schema.orders.number) })
      : [];
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
  // Which options a supplier sends: their lines leave the box when the order also has the store's own.
  const supplied = new Set(
    variantIds.length
      ? (
          await db
            .select({ id: schema.variants.id })
            .from(schema.variants)
            .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
            .where(and(inArray(schema.variants.id, variantIds), isNotNull(schema.products.supplierId)))
        ).map((r) => r.id)
      : [],
  );
  const fromSupplier = (l: { variantId: string | null }) => !!l.variantId && supplied.has(l.variantId);
  const linesOf = groupBy(lines, (l) => l.orderId);
  const codes = new Map<string, string | null>();
  if (shop.returnWindowDays) for (const o of orders) if (o.gift) codes.set(o.id, await giftReturnCode(db, o));
  // Orders to the same door that also wait on the store's own items, to pack together.
  const doors = await sameAddressOnList(db, shopId, orders);
  const others = [...new Set([...doors.values()].flat().map((x) => x.id))];
  const waiting = doors.size ? await ownItemsWaiting(db, [...doors.keys(), ...others]) : new Set<string>();
  const slips: PackingSlip[] = orders.map((o) => {
    const all = linesOf.get(o.id) ?? [];
    const mixed = all.some(fromSupplier) && all.some((l) => !fromSupplier(l));
    const boxed = mixed ? all.filter((l) => !fromSupplier(l)) : all;
    return {
      orderId: o.id,
      number: o.number,
      placedAt: o.createdAt,
      shipTo: o.shippingAddress,
      separately: mixed ? all.filter(fromSupplier).map((l) => ({ title: l.title, quantity: l.quantity })) : [],
      items: boxed
        .map((l) => ({
          title: l.title,
          sku: (l.variantId && skus.get(l.variantId)) || null,
          quantity: l.quantity,
          personalization: describePersonalization(l.personalization),
          preorder: l.preorder,
        })),
      gift: o.gift ? { from: o.gift.from, message: o.gift.message, returnCode: codes.get(o.id) ?? null } : null,
      giftWrap: o.giftWrapMinor > 0,
      buyerNote: o.buyerNote,
      sameBox: waiting.has(o.id) ? (doors.get(o.id) ?? []).filter((x) => waiting.has(x.id)).map((x) => x.number) : [],
    };
  });
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
