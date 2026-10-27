"use server";
import { revalidatePath } from "next/cache";
import { addShippingRate, createShippingZone, deleteShippingRate, deleteShippingZone, parseKg, parseMoney, setCheckoutPhone, setDeliveryEstimates, setDeliveryProtection, setGiftWrap, setLocalDelivery, setLocalPickup, setMinOrder, setShipCutoff, setUpStarterZones, updateShippingZone, UserError } from "@sf/core";
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

function kg(raw: FormDataEntryValue | null) {
  const grams = parseKg(String(raw ?? ""));
  if (Number.isNaN(grams)) throw new UserError("Enter weights in kg, like 0.5 or 2.");
  return grams;
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
      minWeightGrams: kg(form.get("minKg")),
      maxWeightGrams: kg(form.get("maxKg")),
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

export type PickupState = { error?: string; saved?: { address: string; instructions: string | null } | null };

/** Turns local pickup at checkout on with where and how, or off. */
export async function setLocalPickupAction(_: PickupState, form: FormData): Promise<PickupState> {
  const { shop, db, user } = await requireShop("shipping");
  const on = form.get("enabled") === "on";
  let saved: PickupState["saved"] = null;
  try {
    saved = await setLocalPickup(db, shop.id, on ? { address: String(form.get("address") ?? ""), instructions: String(form.get("instructions") ?? "") } : null);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  await logged({ shop, user, db }, saved ? "Offered local pickup at checkout" : "Stopped offering local pickup", { href: "/admin/shipping#pickup-heading" });
  revalidatePath("/admin/shipping");
  return { saved };
}

export type LocalDeliveryState = { error?: string; saved?: { postalPrefixes: string[] } | null };

/** Turns local delivery on with its area and price, or off. */
export async function setLocalDeliveryAction(_: LocalDeliveryState, form: FormData): Promise<LocalDeliveryState> {
  const { shop, db, user } = await requireShop("shipping");
  const on = form.get("enabled") === "on";
  let saved: LocalDeliveryState["saved"] = null;
  try {
    if (on) {
      const amount = (name: string, what: string) => {
        const raw = String(form.get(name) ?? "").trim();
        if (!raw) return null;
        try {
          return parseMoney(raw);
        } catch {
          throw new UserError(`Enter the ${what} as an amount, like 5.00.`);
        }
      };
      saved = await setLocalDelivery(db, shop.id, {
        postalPrefixes: String(form.get("postalPrefixes") ?? ""),
        priceMinor: amount("price", "delivery price") ?? 0,
        freeOverMinor: amount("freeOver", "amount for free delivery"),
        note: String(form.get("note") ?? ""),
      });
    } else {
      await setLocalDelivery(db, shop.id, null);
    }
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  await logged({ shop, user, db }, saved ? `Offered local delivery to ${saved.postalPrefixes.length} postal code${saved.postalPrefixes.length === 1 ? "" : "s"}` : "Stopped offering local delivery", { href: "/admin/shipping#local-delivery-heading" });
  revalidatePath("/admin/shipping");
  return { saved };
}

export type GiftWrapState = { error?: string; saved?: { priceMinor: number } | null };

/** Turns gift wrapping at checkout on with its price, or off. */
export async function setGiftWrapAction(_: GiftWrapState, form: FormData): Promise<GiftWrapState> {
  const { shop, db, user } = await requireShop("shipping");
  const on = form.get("enabled") === "on";
  let saved: GiftWrapState["saved"] = null;
  try {
    if (on) {
      const raw = String(form.get("price") ?? "").trim();
      let priceMinor = 0;
      try {
        priceMinor = raw ? parseMoney(raw) : 0;
      } catch {
        return { error: "Enter the wrapping price as an amount, like 4.00." };
      }
      saved = await setGiftWrap(db, shop.id, { priceMinor, note: String(form.get("note") ?? "") });
    } else {
      await setGiftWrap(db, shop.id, null);
    }
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  await logged({ shop, user, db }, saved ? "Offered gift wrapping at checkout" : "Stopped offering gift wrapping", { href: "/admin/shipping#gift-wrap-heading" });
  revalidatePath("/admin/shipping");
  return { saved };
}

export type MinOrderState = { error?: string; saved?: number };

/** Sets the smallest order the store takes; empty or 0 takes any amount. */
export async function setMinOrderAction(_: MinOrderState, form: FormData): Promise<MinOrderState> {
  const { shop, db, user } = await requireShop("shipping");
  const raw = String(form.get("min") ?? "").trim();
  let saved = 0;
  try {
    let minor = 0;
    try {
      minor = raw ? parseMoney(raw) : 0;
    } catch {
      return { error: "Enter the smallest order as an amount, like 15.00." };
    }
    saved = await setMinOrder(db, shop.id, minor);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  await logged({ shop, user, db }, saved ? "Set the smallest order" : "Took orders of any amount", { href: "/admin/shipping#min-order-heading" });
  revalidatePath("/admin/shipping");
  revalidatePath(`/s/${shop.handle}`, "layout");
  return { saved };
}

export type ShipCutoffState = { error?: string; saved?: { hour: number } | null };

/** Sets the time orders must be in by to ship that day, or turns the cutoff off. */
export async function setShipCutoffAction(_: ShipCutoffState, form: FormData): Promise<ShipCutoffState> {
  const { shop, db, user } = await requireShop("shipping");
  const on = form.get("enabled") === "on";
  let saved: ShipCutoffState["saved"] = null;
  try {
    saved = on
      ? await setShipCutoff(db, shop.id, { hour: Number(form.get("hour") ?? ""), timeZone: String(form.get("timeZone") ?? ""), weekends: form.get("weekends") === "on" })
      : await setShipCutoff(db, shop.id, null);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  await logged({ shop, user, db }, saved ? "Set a same-day shipping cutoff" : "Turned off the same-day shipping cutoff", { href: "/admin/shipping#cutoff-heading" });
  revalidatePath("/admin/shipping");
  return { saved };
}
