"use server";
import { revalidatePath } from "next/cache";
import { addWholesaleBuyer, decideWholesale, parseMoney, setQuantityBreaks, setWholesaleSettings, UserError } from "@sf/core";
import { campaigns, requireShop } from "@/lib/server";
import type { FormState } from "./actions";

async function attempt(path: string, fn: () => Promise<unknown>): Promise<FormState> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath(path);
  return { saved: true };
}

export async function wholesaleSettingsAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("wholesale");
  return attempt("/admin/wholesale", async () => {
    const min = String(form.get("minOrder") ?? "").trim();
    await setWholesaleSettings(db, shop.id, {
      enabled: form.get("enabled") === "on",
      percentOff: Number.parseInt(String(form.get("percentOff") ?? ""), 10) || 0,
      minOrderMinor: min ? parseMoney(min) : 0,
    });
  });
}

export async function decideWholesaleAction(customerId: string, decision: "approve" | "decline" | "remove", _: FormState, _form: FormData): Promise<FormState> {
  const { shop } = await requireShop("wholesale");
  return attempt("/admin/wholesale", async () => decideWholesale(await campaigns(), shop, customerId, decision));
}

export async function addWholesaleBuyerAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("wholesale");
  return attempt("/admin/wholesale", () => addWholesaleBuyer(db, shop, { email: String(form.get("email") ?? ""), company: String(form.get("company") ?? "") }));
}

/** Up to three rows of "quantity" and "percent off"; empty rows are skipped. */
export async function quantityBreaksAction(productId: string, _: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("products");
  const qty = form.getAll("minQty").map(String);
  const pct = form.getAll("percentOff").map(String);
  const tiers = qty
    .map((q, i) => ({ q: q.trim(), p: (pct[i] ?? "").trim() }))
    .filter((r) => r.q || r.p)
    .map((r) => ({ minQty: Number.parseInt(r.q, 10) || 0, percentOff: Number.parseInt(r.p, 10) || 0 }));
  return attempt(`/admin/products/${productId}`, () => setQuantityBreaks(db, shop.id, productId, tiers));
}
