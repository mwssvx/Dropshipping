"use server";
import { revalidatePath } from "next/cache";
import { removeBackupSupplier, setBackupSupplier, syncProductStock, UserError } from "@sf/core";
import { requireShop, stock, suppliers } from "@/lib/server";

export type BackupState = { error?: string; message?: string };

/** Stock on the store is the main supplier's plus the backup's, so it's re-read after a change. */
async function resync(shopId: string, productId: string) {
  try {
    await syncProductStock(await stock(), shopId, productId);
  } catch (e) {
    if (!(e instanceof UserError)) throw e; // a supplier that's down is read again at the daily check
  }
}

export async function setBackupAction(productId: string, _: BackupState, form: FormData): Promise<BackupState> {
  const { shop, db } = await requireShop("products");
  let unmatched: string[];
  try {
    ({ unmatched } = await setBackupSupplier(db, suppliers(), shop.id, productId, String(form.get("url") ?? "")));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  await resync(shop.id, productId);
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath(`/s/${shop.handle}`, "layout");
  return {
    message: unmatched.length
      ? `Backup saved. ${unmatched.join(", ")} ${unmatched.length === 1 ? "has" : "have"} no match there, so ${unmatched.length === 1 ? "it isn't" : "they aren't"} covered.`
      : "Backup saved. Orders go there when the main supplier is out of stock.",
  };
}

export async function removeBackupAction(productId: string, _: BackupState, _form: FormData): Promise<BackupState> {
  const { shop, db } = await requireShop("products");
  await removeBackupSupplier(db, shop.id, productId);
  await resync(shop.id, productId);
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath(`/s/${shop.handle}`, "layout");
  return { message: "Backup removed." };
}
