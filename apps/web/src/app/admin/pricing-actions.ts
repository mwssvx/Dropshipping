"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { applyRepricing, parseMoney, setPricingRule, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";
import type { FormState } from "./actions";

export type RepriceState = FormState;

const money = (raw: string, what: string) => {
  try {
    return parseMoney(raw.trim().replace(/^[^\d]+/, ""));
  } catch {
    throw new UserError(`Enter ${what} like 10.00.`);
  }
};

export async function pricingRuleAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("products");
  try {
    const kind = form.get("kind") === "fixed" ? "fixed" : "multiplier";
    const raw = String(form.get(kind === "fixed" ? "fixedValue" : "multiplier") ?? "").trim();
    await setPricingRule(db, shop.id, {
      kind,
      value: kind === "fixed" ? money(raw, "the amount") : Number(raw.replace(/[^\d.]/g, "")) || 0,
      ending: (["99", "95", "00", "none"] as const).find((e) => e === form.get("ending")) ?? "99",
      compareAtPercent: form.get("compareAt") === "on" ? Math.round(Number(form.get("compareAtPercent")) || 0) : null,
      minPriceMinor: String(form.get("minPrice") ?? "").trim() ? money(String(form.get("minPrice")), "the lowest price") : 0,
    });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/pricing");
  return { saved: true };
}

export async function repriceAction(_: RepriceState): Promise<RepriceState> {
  const { shop, db } = await requireShop("products");
  let r: Awaited<ReturnType<typeof applyRepricing>>;
  try {
    r = await applyRepricing(db, shop);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/products");
  revalidatePath(`/s/${shop.handle}`, "layout");
  // The list empties once everything follows the rule, so the result is said on the page itself.
  redirect(`/admin/pricing?updated=${r.variants}&products=${r.products}`);
}
