"use server";
import { revalidatePath } from "next/cache";
import { adjustPoints, parseMoney, setRewardsSettings, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";
import type { FormState } from "./actions";

export async function rewardsSettingsAction(_: FormState, form: FormData): Promise<FormState> {
  const { shop, db } = await requireShop("marketing");
  let valueMinor: number;
  try {
    valueMinor = parseMoney(String(form.get("value") ?? ""));
  } catch {
    return { error: "Enter what 100 points are worth, like 1.00." };
  }
  try {
    await setRewardsSettings(db, shop.id, {
      enabled: form.get("enabled") === "on",
      earnRate: Number.parseInt(String(form.get("earnRate") ?? ""), 10) || 0,
      valueMinor,
    });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/rewards");
  revalidatePath(`/s/${shop.handle}`, "layout");
  return { saved: true };
}

export type PointsState = { error?: string; message?: string };

export async function adjustPointsAction(customerId: string, _: PointsState, form: FormData): Promise<PointsState> {
  const { shop, db } = await requireShop("customers");
  try {
    const points = Number(String(form.get("points") ?? "").replace(/[\s,]/g, ""));
    const balance = await adjustPoints(db, shop.id, customerId, { points, note: String(form.get("note") ?? "") });
    revalidatePath(`/admin/customers/${customerId}`);
    return { message: `Saved. They have ${balance.toLocaleString("en-US")} points now.` };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
