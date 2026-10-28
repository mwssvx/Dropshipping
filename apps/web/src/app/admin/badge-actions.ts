"use server";
import { revalidatePath } from "next/cache";
import { setBadgeSettings, setCardQuickAdd, setProductBadge, setShareButtons, setSoldOutDisplay, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type BadgeState = { error?: string; saved?: boolean };

/** Which automatic badges the store's product cards show. */
export async function badgeSettingsAction(_: BadgeState, form: FormData): Promise<BadgeState> {
  const { shop, db } = await requireShop("products");
  const days = String(form.get("newDays") ?? "").trim();
  try {
    await setBadgeSettings(db, shop.id, { sale: form.get("sale") === "on", soldOut: form.get("soldOut") === "on", newDays: days === "" ? 0 : Number(days) });
    revalidatePath("/admin/products");
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { saved: true };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

/** The merchant's own label on one product's card. */
export async function productBadgeAction(productId: string, _: BadgeState, form: FormData): Promise<BadgeState> {
  const { shop, db } = await requireShop("products");
  try {
    const badge = await setProductBadge(db, shop.id, productId, String(form.get("badge") ?? ""));
    revalidatePath(`/admin/products/${productId}`);
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { saved: !!badge };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

/** Where sold-out products go in the store's lists. */
export async function soldOutAction(_: BadgeState, form: FormData): Promise<BadgeState> {
  const { shop, db } = await requireShop("products");
  try {
    await setSoldOutDisplay(db, shop.id, String(form.get("soldOut") ?? ""));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/products");
  revalidatePath(`/s/${shop.handle}`, "layout");
  return { saved: true };
}

/** The "Add to cart" button on product cards. */
export async function shareButtonsAction(_: BadgeState, form: FormData): Promise<BadgeState> {
  const { shop, db } = await requireShop("products");
  await setShareButtons(db, shop.id, form.get("share") === "on");
  revalidatePath("/admin/products");
  revalidatePath(`/s/${shop.handle}`, "layout");
  return { saved: true };
}

export async function quickAddAction(_: BadgeState, form: FormData): Promise<BadgeState> {
  const { shop, db } = await requireShop("products");
  await setCardQuickAdd(db, shop.id, form.get("quickAdd") === "on");
  revalidatePath("/admin/products");
  revalidatePath(`/s/${shop.handle}`, "layout");
  return { saved: true };
}
