"use server";
import { revalidatePath } from "next/cache";
import { createSale, deleteSale, endSale, sendPriceDrops, setLowestPriceNote, UserError } from "@sf/core";
import { requireShop, stock } from "@/lib/server";

export type SaleState = { error?: string; message?: string; key?: number };

function refresh(handle: string) {
  revalidatePath("/admin/sales");
  revalidatePath(`/s/${handle}`, "layout");
}

/** Times come from the browser as ISO strings, so they mean the merchant's own clock. */
const time = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

export async function createSaleAction(_: SaleState, form: FormData): Promise<SaleState> {
  const { shop, db } = await requireShop("marketing");
  const startsAt = time(form.get("startsAt")) ?? new Date();
  const endsAt = time(form.get("endsAt"));
  if (endsAt === undefined) return { error: "Pick when the sale ends, or leave it empty." };
  let started = false;
  try {
    const sale = await createSale(db, shop.id, {
      title: String(form.get("title") ?? ""),
      percentOff: Number(form.get("percentOff") ?? ""),
      scope: String(form.get("scope") ?? "all") as "all" | "collection" | "products",
      collectionId: String(form.get("collectionId") ?? "") || null,
      productIds: form.getAll("productIds").map(String),
      startsAt,
      endsAt,
    });
    started = sale.startsAt <= new Date();
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  // Buyers who saved a product hear about it right away when the sale starts now.
  if (started) await sendPriceDrops(await stock(), { shopId: shop.id });
  refresh(shop.handle);
  return { message: started ? "Sale added. It's on the store now." : "Sale scheduled. It starts by itself.", key: Date.now() };
}

export async function endSaleAction(id: string) {
  const { shop, db } = await requireShop("marketing");
  await endSale(db, shop.id, id).catch((e) => {
    if (!(e instanceof UserError)) throw e;
  });
  refresh(shop.handle);
}

export async function deleteSaleAction(id: string) {
  const { shop, db } = await requireShop("marketing");
  await deleteSale(db, shop.id, id).catch((e) => {
    if (!(e instanceof UserError)) throw e;
  });
  refresh(shop.handle);
}

/** Who sees the lowest earlier price under reduced prices. */
export async function lowestPriceAction(_: SaleState, form: FormData): Promise<SaleState> {
  const { shop, db } = await requireShop("marketing");
  try {
    await setLowestPriceNote(db, shop.id, String(form.get("note") ?? ""));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/sales");
  revalidatePath(`/s/${shop.handle}`, "layout");
  return { message: "Saved." };
}
