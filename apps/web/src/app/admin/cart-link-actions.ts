"use server";
import { revalidatePath } from "next/cache";
import { CART_LINK_MAX_LINES, createCartLink, deleteCartLink, UserError } from "@sf/core";
import { logged, requireShop } from "@/lib/server";
import type { FormState } from "./actions";

/** Makes a cart link from its numbered product and quantity fields. */
export async function createCartLinkAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, user, db } = await requireShop("marketing");
  const field = (name: string) => String(form.get(name) ?? "");
  try {
    const link = await createCartLink(db, shop.id, {
      name: field("name"),
      lines: Array.from({ length: CART_LINK_MAX_LINES }, (_, i) => ({ variantId: field(`v${i}`), quantity: Number(field(`q${i}`) || 1) })).filter((l) => l.variantId),
      discountCode: field("code") || null,
    });
    await logged({ shop, user, db }, `Made the cart link “${link.name}”`, { href: "/admin/cart-links" });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/cart-links");
  return { saved: true };
}

export async function deleteCartLinkAction(id: string, name: string) {
  const { shop, user, db } = await requireShop("marketing");
  await deleteCartLink(db, shop.id, id);
  await logged({ shop, user, db }, `Deleted the cart link “${name}”`, { href: "/admin/cart-links" });
  revalidatePath("/admin/cart-links");
}
