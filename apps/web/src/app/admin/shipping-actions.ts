"use server";
import { revalidatePath } from "next/cache";
import { addShippingRate, createShippingZone, deleteShippingRate, deleteShippingZone, parseMoney, setCheckoutPhone, setDeliveryEstimates, setDeliveryProtection, setUpStarterZones, updateShippingZone, UserError } from "@sf/core";
import { logged, requireShop } from "@/lib/server";
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

export async function setDeliveryEstimatesAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("shipping");
  try {
    const days = String(form.get("processingDays") ?? "").trim();
    await setDeliveryEstimates(db, shop.id, { enabled: form.get("on") === "on", processingDays: days === "" ? Number.NaN : Number(days) });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/shipping");
  return { saved: true };
}

/** Whether checkout asks for a phone number for the courier. */
export async function setCheckoutPhoneAction(form: FormData) {
  const { shop, db, user } = await requireShop("shipping");
  const mode = String(form.get("checkoutPhone") ?? "optional") as "off" | "optional" | "required";
  await setCheckoutPhone(db, shop.id, mode).catch((e) => {
    if (!(e instanceof UserError)) throw e;
  });
  const said = { off: "doesn't ask for a phone number", optional: "asks for an optional phone number", required: "needs a phone number" }[mode] ?? "asks for a phone number";
  await logged({ shop, user, db }, `Checkout now ${said}`, { href: "/admin/shipping#phone-heading" });
  revalidatePath("/admin/shipping");
}

export type ProtectionState = { error?: string; saved?: { percent: number; minMinor: number } | null };

/** Turns delivery protection at checkout on with its price, or off. */
export async function setDeliveryProtectionAction(_: ProtectionState, form: FormData): Promise<ProtectionState> {
  const { shop, db, user } = await requireShop("shipping");
  const on = form.get("enabled") === "on";
  let saved: ProtectionState["saved"] = null;
  try {
    if (on) {
      const percent = Number(String(form.get("percent") ?? "").trim().replace(",", "."));
      const min = String(form.get("min") ?? "").trim();
      let minMinor = 0;
      try {
        minMinor = min ? parseMoney(min) : 0;
      } catch {
        return { error: "Enter the lowest price as an amount, like 1.50." };
      }
      saved = await setDeliveryProtection(db, shop.id, { percent, minMinor });
    } else {
      await setDeliveryProtection(db, shop.id, null);
    }
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  await logged({ shop, user, db }, saved ? `Offered delivery protection at checkout for ${saved.percent}% of the order` : "Stopped offering delivery protection", { href: "/admin/shipping#protection-heading" });
  revalidatePath("/admin/shipping");
  return { saved };
}
