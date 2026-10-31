"use server";
import { revalidatePath } from "next/cache";
import { parseMoney, setBlockedCountries, setCustomsInfo, setMinAge, setProductProcessingDays, setReorderDays, setShippingSurcharge, setSwatches, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type CustomsState = { error?: string; saved?: boolean };

/** Saves a product's HS code, the country it's made in and the one it ships from, for customs forms and duty notes. */
export async function customsAction(productId: string, _: CustomsState, form: FormData): Promise<CustomsState> {
  const { shop, db } = await requireShop("products");
  try {
    await setCustomsInfo(db, shop.id, productId, { hsCode: String(form.get("hsCode") ?? ""), originCountry: String(form.get("originCountry") ?? ""), shipsFrom: String(form.get("shipsFrom") ?? "") });
    revalidatePath(`/admin/products/${productId}`);
    return { saved: true };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export type MinAgeState = { error?: string; saved?: boolean };

/** Saves the age a buyer must confirm to check out with a product, or clears it. */
export async function minAgeAction(productId: string, _: MinAgeState, form: FormData): Promise<MinAgeState> {
  const { shop, db } = await requireShop("products");
  const raw = String(form.get("minAge") ?? "");
  try {
    await setMinAge(db, shop.id, productId, raw ? Number(raw) : null);
    revalidatePath(`/admin/products/${productId}`);
    return { saved: true };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export type ReorderDaysState = { error?: string; saved?: boolean };

/** Saves how long a product usually lasts, for the reorder reminder, or turns the reminder off. */
export async function reorderDaysAction(productId: string, _: ReorderDaysState, form: FormData): Promise<ReorderDaysState> {
  const { shop, db } = await requireShop("products");
  const raw = String(form.get("reorderDays") ?? "").trim();
  try {
    await setReorderDays(db, shop.id, productId, raw ? Number(raw) : null);
    revalidatePath(`/admin/products/${productId}`);
    return { saved: true };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export type BlockedCountriesState = { error?: string; saved?: boolean };

/** Saves the countries a product can't be shipped to. */
export async function blockedCountriesAction(productId: string, _: BlockedCountriesState, form: FormData): Promise<BlockedCountriesState> {
  const { shop, db } = await requireShop("products");
  try {
    await setBlockedCountries(db, shop.id, productId, form.getAll("country").map(String));
    revalidatePath(`/admin/products/${productId}`);
    return { saved: true };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export type SwatchesState = { error?: string; saved?: boolean };

/** Saves the colour each value of a product's colour option shows as on the store. */
export async function swatchesAction(productId: string, _: SwatchesState, form: FormData): Promise<SwatchesState> {
  const { shop, db } = await requireShop("products");
  const colors: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (key.startsWith("swatch:")) colors[key.slice("swatch:".length)] = String(value);
  try {
    await setSwatches(db, shop.id, productId, colors);
    revalidatePath(`/admin/products/${productId}`);
    return { saved: true };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export type ProcessingDaysState = { error?: string; saved?: boolean };

/** Saves the days a product takes to get ready before it ships, or goes back to the store's. */
export async function processingDaysAction(productId: string, _: ProcessingDaysState, form: FormData): Promise<ProcessingDaysState> {
  const { shop, db } = await requireShop("products");
  const raw = String(form.get("processingDays") ?? "").trim();
  try {
    await setProductProcessingDays(db, shop.id, productId, raw ? Number(raw) : null);
    revalidatePath(`/admin/products/${productId}`);
    return { saved: true };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export type SurchargeState = { error?: string; saved?: boolean };

/** Saves what one of a bulky product adds to shipping. Empty is the same as nothing. */
export async function surchargeAction(productId: string, _: SurchargeState, form: FormData): Promise<SurchargeState> {
  const { shop, db } = await requireShop("products");
  const raw = String(form.get("surcharge") ?? "").trim();
  let minor = 0;
  if (raw) {
    try {
      minor = parseMoney(raw);
    } catch {
      return { error: "Enter an amount like 15 or 15.50." };
    }
  }
  try {
    await setShippingSurcharge(db, shop.id, productId, minor);
    revalidatePath(`/admin/products/${productId}`);
    return { saved: true };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
