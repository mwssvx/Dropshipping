"use server";
import { revalidatePath } from "next/cache";
import { setStoreClosure, UserError } from "@sf/core";
import { logged, requireShop } from "@/lib/server";

export type ClosureState = { error?: string; saved?: "open" | "password" | "holiday" };

/** Opens the store, or puts it behind a password or on a holiday break. */
export async function storeClosureAction(_: ClosureState, form: FormData): Promise<ClosureState> {
  const { shop, db, user } = await requireShop("theme");
  const get = (k: string) => String(form.get(k) ?? "");
  const mode = get("mode") === "password" ? "password" : get("mode") === "holiday" ? "holiday" : "open";
  try {
    await setStoreClosure(db, shop, { mode, message: get("message"), until: get("until"), password: get("password") });
    const said = { open: "Opened the store to everyone", password: "Put the store behind a password", holiday: "Put the store on a break" }[mode];
    await logged({ shop, user, db }, said, { href: "/admin/store-status" });
    revalidatePath("/admin", "layout");
    revalidatePath(`/s/${shop.handle}`, "layout");
    return { saved: mode };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
