"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createProduct, createShop, parseMoney, requireMember, updateProduct, UserError, type ProductInput } from "@sf/core";
import { db, requireShop, requireUser, SHOP_COOKIE } from "@/lib/server";

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

function readProduct(form: FormData): ProductInput {
  let price: number;
  try {
    price = parseMoney(String(form.get("price") ?? ""));
  } catch {
    throw new UserError("Enter a price like 24.99.");
  }
  let compareAt: number | null, cost: number | null;
  try {
    compareAt = optionalMoney(form.get("compareAt"));
    cost = optionalMoney(form.get("cost"));
  } catch {
    throw new UserError("Enter prices like 24.99.");
  }
  return {
    title: String(form.get("title") ?? ""),
    descriptionHtml: String(form.get("description") ?? ""),
    imageUrl: String(form.get("imageUrl") ?? ""),
    status: form.get("status") === "active" ? "active" : "draft",
    variants: [{ title: "Default", priceMinor: price, compareAtMinor: compareAt, costMinor: cost }],
  };
}

export async function createProductAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop();
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
  const { shop, db } = await requireShop();
  try {
    await updateProduct(db, shop.id, productId, readProduct(form));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/products");
  revalidatePath(`/s/${shop.handle}`, "layout");
  return { saved: true };
}
