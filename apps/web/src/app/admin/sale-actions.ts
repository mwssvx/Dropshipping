"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSale, deleteSale, endEarlyAccess, endSale, extendSale, giveEarlyAccess, planDailyDeals, sendPriceDrops, setLowestPriceNote, UserError } from "@sf/core";
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
      countdown: form.get("countdown") === "on",
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

/** A run of deals of the day, one product a day from the first day picked. */
export async function planDailyDealsAction(_: SaleState, form: FormData): Promise<SaleState> {
  const { shop, db } = await requireShop("marketing");
  let deals;
  try {
    deals = await planDailyDeals(db, shop, {
      productIds: form.getAll("dealProductIds").map(String),
      percentOff: Number(form.get("dealPercent") ?? ""),
      startDate: String(form.get("dealStart") ?? ""),
    });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  const started = deals[0]!.startsAt <= new Date();
  if (started) await sendPriceDrops(await stock(), { shopId: shop.id });
  refresh(shop.handle);
  return { message: `${deals.length} deals planned, one a day.${started ? " The first is on now." : ""}`, key: Date.now() };
}

export async function endSaleAction(id: string) {
  const { shop, db } = await requireShop("marketing");
  await endSale(db, shop.id, id).catch((e) => {
    if (!(e instanceof UserError)) throw e;
  });
  refresh(shop.handle);
}

export async function extendSaleAction(id: string, form: FormData) {
  const { shop, db } = await requireShop("marketing");
  try {
    await extendSale(db, shop.id, id, Number(form.get("days") ?? ""));
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    redirect(`/admin/sales?error=${encodeURIComponent(e.message)}`);
  }
  refresh(shop.handle);
}

export async function deleteSaleAction(id: string) {
  const { shop, db } = await requireShop("marketing");
  await deleteSale(db, shop.id, id).catch((e) => {
    if (!(e instanceof UserError)) throw e;
  });
  refresh(shop.handle);
}

/** Makes a scheduled sale's early access code, for subscribers or tagged customers. */
export async function giveEarlyAccessAction(id: string, form: FormData) {
  const { shop, db } = await requireShop("marketing");
  try {
    await giveEarlyAccess(db, shop.id, id, { hours: Number(form.get("hours") ?? 0), customerTag: String(form.get("tag") ?? "") || null });
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    redirect(`/admin/sales?error=${encodeURIComponent(e.message)}`);
  }
  revalidatePath("/admin/sales");
  revalidatePath("/admin/marketing");
}

export async function endEarlyAccessAction(id: string) {
  const { shop, db } = await requireShop("marketing");
  await endEarlyAccess(db, shop.id, id).catch((e) => {
    if (!(e instanceof UserError)) throw e;
  });
  revalidatePath("/admin/sales");
  revalidatePath("/admin/marketing");
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
