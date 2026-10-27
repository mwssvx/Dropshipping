"use server";
import { revalidatePath } from "next/cache";
import { removeDigitalFile, resetDownloads, setDigitalFile, UserError } from "@sf/core";
import { redirect } from "next/navigation";
import { requireShop } from "@/lib/server";

export type DigitalState = { error?: string; saved?: "uploaded" | "removed" };

/** Uploads the file a buyer downloads after paying, which makes the product a digital one. */
export async function digitalFileAction(productId: string, _: DigitalState, form: FormData): Promise<DigitalState> {
  const { shop, db } = await requireShop("products");
  try {
    if (form.get("remove")) {
      await removeDigitalFile(db, shop.id, productId);
    } else {
      const file = form.get("file");
      if (!(file instanceof File) || !file.size) throw new UserError("Pick a file to upload.");
      await setDigitalFile(db, shop.id, productId, { name: file.name, contentType: file.type || undefined, data: Buffer.from(await file.arrayBuffer()) });
    }
    revalidatePath(`/admin/products/${productId}`);
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { saved: form.get("remove") ? "removed" : "uploaded" };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

/** Lets the buyer download everything on the order again, from the full count. */
export async function resetDownloadsAction(orderId: string) {
  const { shop, db } = await requireShop("orders");
  await resetDownloads(db, shop.id, orderId);
  redirect(`/admin/orders/${orderId}?downloads=reset#downloads`);
}
