"use server";
import { revalidatePath } from "next/cache";
import { createBundle, deleteBundle, setBundleActive, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type BundleState = { error?: string; message?: string; key?: number };

function refresh(handle: string) {
  revalidatePath("/admin/bundles");
  revalidatePath(`/s/${handle}`, "layout");
}

export async function createBundleAction(_: BundleState, form: FormData): Promise<BundleState> {
  const { shop, db } = await requireShop("marketing");
  const productIds = [1, 2, 3, 4].map((n) => String(form.get(`product${n}`) ?? "")).filter(Boolean);
  try {
    await createBundle(db, shop.id, { title: String(form.get("title") ?? ""), productIds, percentOff: Number(form.get("percentOff") ?? "") });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  refresh(shop.handle);
  // A new key empties the form for the next bundle.
  return { message: "Bundle added. It shows on each of its products' pages.", key: Date.now() };
}

export async function toggleBundleAction(id: string, active: boolean) {
  const { shop, db } = await requireShop("marketing");
  await setBundleActive(db, shop.id, id, active).catch((e) => {
    if (!(e instanceof UserError)) throw e;
  });
  refresh(shop.handle);
}

export async function deleteBundleAction(id: string) {
  const { shop, db } = await requireShop("marketing");
  await deleteBundle(db, shop.id, id).catch((e) => {
    if (!(e instanceof UserError)) throw e;
  });
  refresh(shop.handle);
}
