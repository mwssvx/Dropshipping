"use server";
import { revalidatePath } from "next/cache";
import { formatMoney, recordStockCount, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type CountState = { error?: string; message?: string; key?: number };

export async function stockCountAction(_: CountState, form: FormData): Promise<CountState> {
  const { shop, db } = await requireShop("products");
  try {
    const counts = [...form.entries()]
      .filter(([k, v]) => k.startsWith("count.") && String(v).trim() !== "")
      .map(([k, v]) => ({ variantId: k.slice(6), counted: Number(String(v).trim().replace(/,/g, "")) }));
    const r = await recordStockCount(db, shop.id, counts);
    revalidatePath("/admin/inventory");
    revalidatePath("/admin/products");
    if (!r.changed) return { message: "Everything matched. Nothing to change.", key: Date.now() };
    const parts = [`Updated ${r.changed === 1 ? "1 option" : `${r.changed} options`}.`];
    if (r.missing) parts.push(`${r.missing} fewer than expected${r.missingCostMinor ? `, worth ${formatMoney(r.missingCostMinor, shop.currency)} at cost` : ""}.`);
    if (r.found) parts.push(`${r.found} more than expected.`);
    return { message: parts.join(" "), key: Date.now() };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
