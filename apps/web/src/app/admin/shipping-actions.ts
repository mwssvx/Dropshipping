"use server";
import { revalidatePath } from "next/cache";
import { addShippingRate, createShippingZone, deleteShippingRate, deleteShippingZone, parseMoney, setUpStarterZones, updateShippingZone, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";
import type { FormState } from "./actions";

async function attempt(fn: () => Promise<unknown>): Promise<FormState> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/shipping");
  return { saved: true };
}

function money(raw: FormDataEntryValue | null, label: string) {
  const s = String(raw ?? "").trim().replace(/^[^\d]+/, "");
  if (!s) return null;
  try {
    return parseMoney(s);
  } catch {
    throw new UserError(`Enter ${label} like 4.99.`);
  }
}

function days(raw: FormDataEntryValue | null) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n)) throw new UserError("Enter delivery days as whole numbers.");
  return n;
}

const zone = (form: FormData) => ({ name: String(form.get("name") ?? ""), countries: form.getAll("countries").map(String) });

export async function starterZonesAction(_: FormState, _form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("shipping");
  return attempt(() => setUpStarterZones(db, shop));
}

export async function createZoneAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("shipping");
  return attempt(() => createShippingZone(db, shop.id, zone(form)));
}

export async function updateZoneAction(id: string, _: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("shipping");
  return attempt(() => updateShippingZone(db, shop.id, id, zone(form)));
}

export async function deleteZoneAction(id: string, _: FormState, _form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("shipping");
  return attempt(() => deleteShippingZone(db, shop.id, id));
}

export async function addRateAction(zoneId: string, _: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("shipping");
  return attempt(async () =>
    addShippingRate(db, shop.id, zoneId, {
      name: String(form.get("name") ?? ""),
      priceMinor: money(form.get("price"), "the price") ?? 0,
      freeOverMinor: money(form.get("freeOver"), "the free shipping amount"),
      minDays: days(form.get("minDays")),
      maxDays: days(form.get("maxDays")),
    }),
  );
}

export async function deleteRateAction(id: string, _: FormState, _form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("shipping");
  return attempt(() => deleteShippingRate(db, shop.id, id));
}
