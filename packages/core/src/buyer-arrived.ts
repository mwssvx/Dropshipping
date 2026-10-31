// "It arrived": a buyer whose parcel reached them can say so from their order page. Plenty of
// carriers (and stores adding tracking by hand) never report a delivery, so without this an order
// can sit at "Shipped" for good: the buyer keeps getting "still on its way" emails and the store
// sees it as past its delivery date. Marking it arrived makes the order delivered, which starts
// the return window and review requests the way a carrier's delivery scan does.
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Db, type OrderEdit } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { refreshOrderFulfillment } from "./fulfillment";

type Order = typeof schema.orders.$inferSelect;

/** Whether the buyer can mark this order arrived: paid, sent by courier, and every parcel shipped. */
export const canMarkArrived = (order: Pick<Order, "paymentStatus" | "fulfillmentStatus" | "pickup" | "localDelivery">) =>
  (order.paymentStatus === "paid" || order.paymentStatus === "partially_refunded") && order.fulfillmentStatus === "shipped" && !order.pickup && !order.localDelivery;

/** The buyer says their order arrived: its shipped parcels become delivered, today. No email goes out, since they know. */
export async function markArrivedByBuyer(db: Db, shopId: string, orderId: string, now = new Date()) {
  const order = await db.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shopId)) });
  if (!order) throw new NotFoundError("Order");
  if (order.fulfillmentStatus === "delivered") return order;
  if (!canMarkArrived(order)) throw new UserError("This order can't be marked as arrived yet.");
  await db
    .update(schema.fulfillments)
    .set({ status: "delivered", deliveredAt: now, updatedAt: now })
    .where(and(eq(schema.fulfillments.orderId, order.id), inArray(schema.fulfillments.status, ["shipped"])));
  const edit: OrderEdit = { at: now.toISOString(), by: "buyer", changes: ["Said it arrived"] };
  await db.update(schema.orders).set({ edits: [...order.edits, edit], updatedAt: now }).where(eq(schema.orders.id, order.id));
  await refreshOrderFulfillment(db, order.id, now);
  return (await db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
}
