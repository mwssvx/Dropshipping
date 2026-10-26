"use server";
import { revalidatePath } from "next/cache";
import { schedulePublish, UserError } from "@sf/core";
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
