"use server";
import { revalidatePath } from "next/cache";
import { schedulePublish, setComingSoon, UserError } from "@sf/core";
import { logged, requireShop } from "@/lib/server";

export type PublishLaterState = { error?: string; saved?: "scheduled" | "cleared" };

/** When a draft goes on sale by itself; an empty time cancels it. */
export async function publishLaterAction(productId: string, title: string, _: PublishLaterState, form: FormData): Promise<PublishLaterState> {
  const { shop, db, user } = await requireShop("products");
  const value = String(form.get("publishAt") ?? "");
  try {
    const at = value ? new Date(value) : null;
    await schedulePublish(db, shop.id, productId, at);
    await logged({ shop, user, db }, at ? `Scheduled “${title}” to go on sale` : `Cancelled the scheduled sale start of “${title}”`, { href: `/admin/products/${productId}` });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath("/admin/products");
  return { saved: value ? "scheduled" : "cleared" };
}

/** Turns the product's coming-soon page on or off while it waits to go on sale. */
export async function comingSoonAction(productId: string, title: string, on: boolean) {
  const { shop, db, user } = await requireShop("products");
  await setComingSoon(db, shop.id, productId, on);
  await logged({ shop, user, db }, on ? `Turned on the coming-soon page of “${title}”` : `Turned off the coming-soon page of “${title}”`, { href: `/admin/products/${productId}` });
  revalidatePath(`/admin/products/${productId}`);
}
