"use server";
import { revalidatePath } from "next/cache";
import { setBlockedCountries, setCustomsInfo, setMinAge, setReorderDays, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type CustomsState = { error?: string; saved?: boolean };

/** Saves a product's HS code and the country it's made in, for customs forms on orders abroad. */
export async function customsAction(productId: string, _: CustomsState, form: FormData): Promise<CustomsState> {
  const { shop, db } = await requireShop("products");
  try {
    await setCustomsInfo(db, shop.id, productId, { hsCode: String(form.get("hsCode") ?? ""), originCountry: String(form.get("originCountry") ?? "") });
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
