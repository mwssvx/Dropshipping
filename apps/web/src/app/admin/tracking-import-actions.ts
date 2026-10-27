"use server";
import { revalidatePath } from "next/cache";
import { importTracking, UserError, type TrackingImportResult } from "@sf/core";
import { fulfillment, logged, notifyLater, requireShop } from "@/lib/server";

export type TrackingImportState = { error?: string; result?: TrackingImportResult };

/** Marks the orders in a tracking file shipped and emails their buyers. */
export async function trackingImportAction(_: TrackingImportState, form: FormData): Promise<TrackingImportState> {
  const { shop, user, db } = await requireShop("orders");
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose the file with your tracking numbers." };
  if (file.size > 2 * 1024 * 1024) return { error: "That file is over 2 MB. Split it into smaller files." };
  try {
    const result = await importTracking(await fulfillment(), shop.id, await file.text());
    if (result.shipped.length) {
      const n = result.shipped.length;
      await logged({ shop, user, db }, `Added tracking to ${n === 1 ? "1 order" : `${n} orders`} from a spreadsheet`, { href: "/admin/orders" });
      notifyLater(shop.id);
    }
    revalidatePath("/admin/orders");
    return { result };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
