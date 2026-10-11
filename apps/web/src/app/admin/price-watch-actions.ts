"use server";
import { revalidatePath } from "next/cache";
import { applySupplierCost, resolveCostChange, setPriceWatch, UserError } from "@sf/core";
import { requireShop, testPayments } from "@/lib/server";

export type PriceWatchState = { error?: string; done?: string };

function refresh() {
  revalidatePath("/admin/price-changes");
  revalidatePath("/admin", "layout");
}

export async function setPriceWatchAction(_: PriceWatchState, form: FormData): Promise<PriceWatchState> {
  const { shop, db } = await requireShop("products");
  const raw = String(form.get("minMarginPercent") ?? "").trim();
  try {
    await setPriceWatch(db, shop.id, { minMarginPercent: raw ? Number(raw) : Number.NaN, autoReprice: form.get("autoReprice") === "on" });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  refresh();
  return { done: "Saved." };
}

export async function resolveCostChangeAction(id: string, action: "raise" | "keep", _: PriceWatchState): Promise<PriceWatchState> {
  const { shop, db } = await requireShop("products");
  try {
    await resolveCostChange(db, shop, id, action);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  refresh();
  return {};
}

/** Test mode only: the supplier of this product's first option charges 90% of its price from now on. */
export async function simulateCostRiseAction(_: PriceWatchState, form: FormData): Promise<PriceWatchState> {
  const { shop, db } = await requireShop("products");
  if (!testPayments()) return { error: "Only in test mode." };
  const productId = String(form.get("productId") ?? "");
  const variant = await db.query.variants.findFirst({
    where: (v, { and, eq, isNotNull }) => and(eq(v.productId, productId), isNotNull(v.costMinor)),
    orderBy: (v, { asc }) => asc(v.position),
  });
  const product = variant && (await db.query.products.findFirst({ where: (p, { and, eq }) => and(eq(p.id, productId), eq(p.shopId, shop.id)) }));
  if (!variant || !product) return { error: "Pick a product with a supplier cost." };
  const cost = Math.max(variant.costMinor! + 1, Math.round(variant.priceMinor * 0.9));
  await applySupplierCost(db, shop, variant.id, cost);
  refresh();
  return {};
}
