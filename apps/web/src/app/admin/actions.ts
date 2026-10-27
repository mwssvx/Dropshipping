"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addManualTracking,
  createProduct,
  duplicateProduct,
  createShop,
  importProduct,
  markDeliveredByStore,
  markPickedUp,
  markReadyForPickup,
  parseMoney,
  releaseHeldOrder,
  editOrder,
  updateOrderNotes,
  requireMember,
  retryOrder,
  sendPriceDrops,
  sendStockAlerts,
  setRiskHold,
  setBuyerCancel,
  syncTracking,
  updateProduct,
  UserError,
  type ProductInput,
} from "@sf/core";
import { db, fulfillment, logged, notifyLater, requireShop, requireUser, SHOP_COOKIE, stock, suppliers } from "@/lib/server";
import { readOrderEdit } from "@/lib/order-edit";
import type { OrderEditState } from "@/components/OrderEditForm";

export type FormState = { error?: string; saved?: boolean };

export async function createStoreAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    const shop = await createShop(await db(), user.id, {
      name: String(form.get("name") ?? ""),
      country: String(form.get("country") ?? ""),
    });
    (await cookies()).set(SHOP_COOKIE, shop.id, { httpOnly: true, sameSite: "lax", path: "/" });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  redirect("/admin");
}

export async function switchShopAction(form: FormData) {
  const user = await requireUser();
  const shopId = String(form.get("shopId") ?? "");
  await requireMember(await db(), user.id, shopId);
  (await cookies()).set(SHOP_COOKIE, shopId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/admin");
}

function optionalMoney(v: FormDataEntryValue | null) {
  const s = String(v ?? "").trim();
  return s ? parseMoney(s) : null;
}

/** Blank stock means it isn't counted; a missing field leaves it as it was. */
function readStock(v: FormDataEntryValue | null) {
  if (v === null) return undefined;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isInteger(n) || n < 0) throw new UserError("Enter stock as a whole number, or leave it blank to stop counting.");
  return n;
}

function readProduct(form: FormData): ProductInput {
  const count = [...form.keys()].filter((k) => k.startsWith("price.")).length;
  const variants = Array.from({ length: count }, (_, i) => {
    let price: number;
    try {
      price = parseMoney(String(form.get(`price.${i}`) ?? ""));
    } catch {
      throw new UserError("Enter a price like 24.99.");
    }
    const stock = readStock(form.get(`stock.${i}`));
    try {
      const rawOptions = form.get(`options.${i}`);
      let options: Record<string, string> | undefined;
      if (rawOptions !== null) {
        const parsed = JSON.parse(String(rawOptions)) as unknown;
        options = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)])) : {};
      }
      return {
        id: String(form.get(`variantId.${i}`) ?? "") || undefined,
        options,
        title: String(form.get(`variantTitle.${i}`) ?? "Default") || "Default",
        priceMinor: price,
        compareAtMinor: optionalMoney(form.get(`compareAt.${i}`)),
        costMinor: optionalMoney(form.get(`cost.${i}`)),
        stock,
      };
    } catch {
      throw new UserError("Enter prices like 24.99.");
    }
  });
  return {
    title: String(form.get("title") ?? ""),
    descriptionHtml: String(form.get("description") ?? ""),
    imageUrl: form.has("imageUrl") ? String(form.get("imageUrl")) : undefined,
    status: form.get("status") === "active" ? "active" : "draft",
    variants,
  };
}

export async function createProductAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db, user } = await requireShop("products");
  let id: string;
  try {
    const input = readProduct(form);
    id = (await createProduct(db, shop.id, input)).id;
    await logged({ shop, user, db }, `Added the product “${input.title}”`, { href: `/admin/products/${id}` });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/products");
  redirect(`/admin/products/${id}?created=1`);
}

export async function updateProductAction(productId: string, _: FormState, form: FormData): Promise<FormState> {
  const { shop, db, user } = await requireShop("products");
  try {
    const input = readProduct(form);
    await updateProduct(db, shop.id, productId, input);
    await logged({ shop, user, db }, `Edited the product “${input.title}”`, { href: `/admin/products/${productId}` });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  // Buyers waiting on an option that's back hear straight away.
  const { sent } = await sendStockAlerts(await stock(), { shopId: shop.id });
  // Buyers who saved it hear if it got cheaper.
  await sendPriceDrops(await stock(), { shopId: shop.id });
  revalidatePath("/admin/products");
  revalidatePath(`/s/${shop.handle}`, "layout");
  // The form remounts with the saved values, so the confirmation rides on the address.
  redirect(`/admin/products/${productId}?saved=1${sent ? `&emailed=${sent}` : ""}`);
}

export async function duplicateProductAction(productId: string) {
  const { shop, db, user } = await requireShop("products");
  const copy = await duplicateProduct(db, shop.id, productId);
  await logged({ shop, user, db }, `Duplicated a product as “${copy.title}”`, { href: `/admin/products/${copy.id}` });
  revalidatePath("/admin/products");
  redirect(`/admin/products/${copy.id}?duplicated=1`);
}

export async function importProductAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db, user } = await requireShop("products");
  let id: string;
  try {
    const prices: Record<string, number> = {};
    for (const [k, v] of form.entries()) {
      if (!k.startsWith("price:")) continue;
      try {
        prices[k.slice(6)] = parseMoney(String(v));
      } catch {
        throw new UserError("Enter prices like 24.99.");
      }
    }
    const product = await importProduct(db, suppliers(), shop.id, {
      url: String(form.get("url") ?? ""),
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      prices,
      publish: form.get("publish") === "1",
    });
    id = product.id;
    await logged({ shop, user, db }, `Imported the product “${product.title}” from a supplier`, { href: `/admin/products/${id}` });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/products");
  redirect(`/admin/products/${id}?imported=1`);
}

async function orderAction(orderId: string, run: (shopId: string) => Promise<unknown>, done?: string): Promise<FormState> {
  const { shop, user, db } = await requireShop("orders");
  try {
    await run(shop.id);
    if (done) await logged({ shop, user, db }, done, { orderId });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  // Shipping and fixes are events for phones and webhooks.
  notifyLater(shop.id);
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return { saved: true };
}

export async function retryOrderAction(orderId: string, _: FormState, _form: FormData): Promise<FormState> {
  return orderAction(orderId, async (shopId) => retryOrder(await fulfillment(), shopId, orderId), "Sent order {order} to the supplier again");
}

export async function readyForPickupAction(orderId: string, _: FormState, _form: FormData): Promise<FormState> {
  return orderAction(orderId, async (shopId) => markReadyForPickup(await fulfillment(), shopId, orderId), "Told the buyer order {order} is ready to pick up");
}

export async function pickedUpAction(orderId: string, _: FormState, _form: FormData): Promise<FormState> {
  return orderAction(orderId, async (shopId) => markPickedUp(await fulfillment(), shopId, orderId), "Marked order {order} picked up");
}

export async function deliveredByStoreAction(orderId: string, _: FormState, _form: FormData): Promise<FormState> {
  return orderAction(orderId, async (shopId) => markDeliveredByStore(await fulfillment(), shopId, orderId), "Marked order {order} delivered");
}

export type OrderNotesState = { error?: string; saved?: boolean; note?: string; tags?: string };

export async function orderNotesAction(orderId: string, _: OrderNotesState, form: FormData): Promise<OrderNotesState> {
  const { shop, db } = await requireShop("orders");
  const note = String(form.get("note") ?? "");
  const tags = String(form.get("tags") ?? "");
  try {
    const saved = await updateOrderNotes(db, shop.id, orderId, { note, tags });
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/orders");
    return { saved: true, note: saved.staffNote ?? "", tags: saved.tags.join(", ") };
  } catch (e) {
    // Typed values come back so a mistake doesn't wipe the note.
    if (e instanceof UserError) return { error: e.message, note, tags };
    throw e;
  }
}

/** The merchant changes the address or a size before the order ships. */
export async function editOrderAction(orderId: string, _: OrderEditState, form: FormData): Promise<OrderEditState> {
  const { shop, user, db } = await requireShop("orders");
  let held = false;
  let resent = false;
  try {
    ({ held, resent } = await editOrder(await fulfillment(), shop.id, orderId, readOrderEdit(form), "merchant"));
    await logged({ shop, user, db }, "Changed the address or items on order {order}", { orderId });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  notifyLater(shop.id);
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return {
    message: held
      ? "Saved and emailed to the customer. It's on hold, so send it on when you're ready."
      : resent
        ? "Saved. The supplier has the updated order, and we emailed the customer."
        : "Saved and emailed to the customer.",
  };
}

export async function releaseHeldOrderAction(orderId: string, _: FormState, _form: FormData): Promise<FormState> {
  return orderAction(orderId, async (shopId) => releaseHeldOrder(await fulfillment(), shopId, orderId), "Released held order {order} to the supplier");
}

export async function setRiskHoldAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db, user } = await requireShop("orders");
  try {
    await setRiskHold(db, shop.id, String(form.get("hold") ?? ""));
    await logged({ shop, user, db }, "Changed which risky orders are held for review", { href: "/admin/orders" });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/orders");
  return { saved: true };
}

/** Whether buyers can cancel their own orders in the first hours. A refund setting, so not for staff. */
export async function setBuyerCancelAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db, user } = await requireShop("refunds");
  const on = form.get("buyerCancel") === "on";
  await setBuyerCancel(db, shop.id, on);
  await logged({ shop, user, db }, on ? "Let buyers cancel their own orders" : "Stopped buyers cancelling their own orders", { href: "/admin/orders" });
  revalidatePath("/admin/orders");
  return { saved: true };
}

export async function addTrackingAction(orderId: string, _: FormState, form: FormData): Promise<FormState> {
  return orderAction(orderId, async (shopId) =>
    addManualTracking(await fulfillment(), shopId, orderId, {
      carrier: String(form.get("carrier") ?? ""),
      trackingNumber: String(form.get("trackingNumber") ?? ""),
      url: String(form.get("trackingUrl") ?? ""),
    }),
    "Added tracking to order {order}",
  );
}

export async function checkTrackingAction(orderId: string, _: FormState, _form: FormData): Promise<FormState> {
  return orderAction(orderId, async (shopId) => {
    const ctx = await fulfillment();
    const order = await ctx.db.query.orders.findFirst({ where: (o, { and, eq }) => and(eq(o.id, orderId), eq(o.shopId, shopId)) });
    if (!order) throw new UserError("Order not found.", "not_found");
    await syncTracking(ctx, { orderId });
  });
}
