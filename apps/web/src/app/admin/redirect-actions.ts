"use server";
import { revalidatePath } from "next/cache";
import { addRedirects, changeProductHandle, deleteRedirect, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type HandleState = { error?: string; message?: string; handle?: string };

/** A new web address for a product; the old one keeps working. */
export async function productHandleAction(productId: string, _: HandleState, form: FormData): Promise<HandleState> {
  const { shop, db } = await requireShop("products");
  const typed = String(form.get("handle") ?? "");
  let handle: string;
  try {
    const before = await db.query.products.findFirst({ where: (p, { eq }) => eq(p.id, productId), columns: { handle: true } });
    handle = (await changeProductHandle(db, shop.id, productId, typed)).handle;
    if (before?.handle === handle) return { handle, message: "That's already its address." };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, handle: typed };
    throw e;
  }
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath("/admin/redirects");
  revalidatePath(`/s/${shop.handle}`, "layout");
  return { handle, message: "Saved. Links to the old address still work: they send buyers here." };
}

export type RedirectsState = { error?: string; message?: string; skipped?: { line: string; reason: string }[]; text?: string };

export async function addRedirectsAction(_: RedirectsState, form: FormData): Promise<RedirectsState> {
  const { shop, db } = await requireShop("domains");
  const text = String(form.get("lines") ?? "");
  let result;
  try {
    result = await addRedirects(db, shop.id, text);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, text };
    throw e;
  }
  revalidatePath("/admin/redirects");
  const message = result.added === 1 ? "Added 1 redirect." : `Added ${result.added} redirects.`;
  // Lines that didn't work stay in the box to fix.
  return { message, skipped: result.skipped, text: result.skipped.map((s) => s.line).join("\n") };
}

export async function deleteRedirectAction(id: string) {
  const { shop, db } = await requireShop("domains");
  await deleteRedirect(db, shop.id, id).catch((e) => {
    if (!(e instanceof UserError)) throw e;
  });
  revalidatePath("/admin/redirects");
}
