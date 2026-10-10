"use server";
import { revalidatePath } from "next/cache";
import { createAddon, deleteAddon, setAddonActive, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

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
