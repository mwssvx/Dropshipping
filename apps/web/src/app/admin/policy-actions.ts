"use server";
import { revalidatePath } from "next/cache";
import { addPolicyPages, UserError } from "@sf/core";
import { logged, requireShop } from "@/lib/server";

export type PolicyState = { error?: string; added?: string[] };

/** Adds the ticked policies as pages, written from the store's own settings. */
export async function addPoliciesAction(_: PolicyState, form: FormData): Promise<PolicyState> {
  const { shop, db, user } = await requireShop("pages");
  try {
    const pages = await addPolicyPages(db, shop, form.getAll("kind").map(String));
    if (pages.length) await logged({ shop, user, db }, `Added policy pages: ${pages.map((p) => p.title).join(", ")}`, { href: "/admin/pages" });
    revalidatePath("/admin/pages");
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { added: pages.map((p) => p.title) };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
