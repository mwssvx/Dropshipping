"use server";
import { revalidatePath } from "next/cache";
import { createAddon, deleteAddon, setAddonActive, setTipping, UserError } from "@sf/core";
import { logged, requireShop } from "@/lib/server";

export type AddonState = { error?: string; message?: string; key?: number };

function refresh(handle: string) {
  revalidatePath("/admin/addons");
  revalidatePath(`/s/${handle}`, "layout");
}

export async function createAddonAction(_: AddonState, form: FormData): Promise<AddonState> {
  const { shop, db } = await requireShop("marketing");
  try {
    await createAddon(db, shop.id, { productId: String(form.get("productId") ?? ""), percentOff: Number(form.get("percentOff") ?? ""), pitch: String(form.get("pitch") ?? "") });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  refresh(shop.handle);
  return { message: "Add-on saved. Buyers see it at checkout.", key: Date.now() };
}

export async function toggleAddonAction(id: string, active: boolean) {
  const { shop, db } = await requireShop("marketing");
  await setAddonActive(db, shop.id, id, active).catch((e) => {
    if (!(e instanceof UserError)) throw e;
  });
  refresh(shop.handle);
}

export async function deleteAddonAction(id: string) {
  const { shop, db } = await requireShop("marketing");
  await deleteAddon(db, shop.id, id).catch((e) => {
    if (!(e instanceof UserError)) throw e;
  });
  refresh(shop.handle);
}

export type TippingState = { error?: string; saved?: { percents: number[] } | null };

/** Turns tips at checkout on with the percentages buyers can pick, or off. */
export async function setTippingAction(_: TippingState, form: FormData): Promise<TippingState> {
  const { shop, db, user } = await requireShop("marketing");
  const on = form.get("enabled") === "on";
  let saved: TippingState["saved"] = null;
  try {
    if (on) {
      const percents = form.getAll("percent").map((v) => String(v).trim().replace(/%$/, "")).filter(Boolean).map(Number);
      if (percents.some((p) => !Number.isFinite(p))) return { error: "Enter each tip as a whole percentage, like 10." };
      saved = await setTipping(db, shop.id, { percents, note: String(form.get("note") ?? "") });
    } else {
      await setTipping(db, shop.id, null);
    }
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  await logged({ shop, user, db }, saved ? "Asked for tips at checkout" : "Stopped asking for tips", { href: "/admin/addons#tips-heading" });
  refresh(shop.handle);
  return { saved };
}
