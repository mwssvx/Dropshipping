"use server";
import { revalidatePath } from "next/cache";
import { formatMoney, sendStockAlerts, syncProductStock, UserError } from "@sf/core";
import { requireShop, stock } from "@/lib/server";

export type StockState = { error?: string; message?: string };

/** Reads the product's stock and cost from the supplier now, instead of waiting for the daily check. */
export async function checkSupplierStockAction(productId: string, _: StockState, _form: FormData): Promise<StockState> {
  const { shop } = await requireShop("products");
  const ctx = await stock();
  let result;
  try {
    result = await syncProductStock(ctx, shop.id, productId);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  const { sent } = await sendStockAlerts(ctx, { shopId: shop.id });
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath(`/s/${shop.handle}`, "layout");
  const parts: string[] = [];
  if (result.gone) parts.push("The supplier took this listing down, so it's sold out on your store. Find another supplier or archive it.");
  else if (result.changes.length === 0) parts.push("Nothing changed since the last check.");
  else
    for (const c of result.changes) {
      const name = c.option === "Default" ? "" : `${c.option}: `;
      const bits: string[] = [];
      if (c.stockAfter !== c.stockBefore) bits.push(c.stockAfter === 0 ? "now sold out" : c.stockAfter === null ? "in stock" : `${c.stockAfter} in stock`);
      if (c.costAfter !== c.costBefore && c.costAfter !== null) bits.push(`cost now ${formatMoney(c.costAfter, shop.currency)}`);
      parts.push(`${name}${bits.join(", ")}.`);
    }
  if (sent) parts.push(`${sent === 1 ? "1 buyer who was" : `${sent} buyers who were`} waiting got a back-in-stock email.`);
  return { message: parts.join(" ") };
}
