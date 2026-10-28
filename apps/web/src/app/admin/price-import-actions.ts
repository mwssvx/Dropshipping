"use server";
import { revalidatePath } from "next/cache";
import { importPrices, UserError, type PriceImportResult } from "@sf/core";
import { logged, requireShop } from "@/lib/server";

export type PriceImportState = { error?: string; result?: PriceImportResult };

/** Changes prices, compare-at prices, costs and own stock from an uploaded spreadsheet. */
export async function priceImportAction(_: PriceImportState, form: FormData): Promise<PriceImportState> {
  const { shop, user, db } = await requireShop("products");
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose the file with your prices." };
  if (file.size > 2 * 1024 * 1024) return { error: "That file is over 2 MB. Split it into smaller files." };
  try {
    const result = await importPrices(db, shop.id, await file.text());
    if (result.changed) {
      const n = result.changed;
      await logged({ shop, user, db }, `Changed ${n === 1 ? "1 option" : `${n} options`} from a spreadsheet`, { href: "/admin/products" });
    }
    revalidatePath("/admin/products");
    return { result };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
