"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addManualTracking,
  createProduct,
  createShop,
  importProduct,
  parseMoney,
  requireMember,
  retryOrder,
  sendStockAlerts,
  syncTracking,
  updateProduct,
  UserError,
  type ProductInput,
} from "@sf/core";
import { db, fulfillment, notifyLater, requireShop, requireUser, SHOP_COOKIE, stock, suppliers } from "@/lib/server";

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
      return {
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
    imageUrl: String(form.get("imageUrl") ?? ""),
    status: form.get("status") === "active" ? "active" : "draft",
    variants,
  };
}

export async function createProductAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("products");
  let id: string;
  try {
    id = (await createProduct(db, shop.id, readProduct(form))).id;
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/products");
  redirect(`/admin/products/${id}?created=1`);
}

export async function updateProductAction(productId: string, _: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("products");
  try {
    await updateProduct(db, shop.id, productId, readProduct(form));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  // Buyers waiting on an option that's back hear straight away.
  const { sent } = await sendStockAlerts(await stock(), { shopId: shop.id });
  revalidatePath("/admin/products");
  revalidatePath(`/s/${shop.handle}`, "layout");
  // The form remounts with the saved values, so the confirmation rides on the address.
  redirect(`/admin/products/${productId}?saved=1${sent ? `&emailed=${sent}` : ""}`);
}

export async function importProductAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("products");
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
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/products");
  redirect(`/admin/products/${id}?imported=1`);
}

async function orderAction(orderId: string, run: (shopId: string) => Promise<unknown>): Promise<FormState> {
  const { shop } = await requireShop("orders");
  try {
    await run(shop.id);
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
  return orderAction(orderId, async (shopId) => retryOrder(await fulfillment(), shopId, orderId));
}

export async function addTrackingAction(orderId: string, _: FormState, form: FormData): Promise<FormState> {
  return orderAction(orderId, async (shopId) =>
    addManualTracking(await fulfillment(), shopId, orderId, {
      carrier: String(form.get("carrier") ?? ""),
      trackingNumber: String(form.get("trackingNumber") ?? ""),
      url: String(form.get("trackingUrl") ?? ""),
    }),
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
