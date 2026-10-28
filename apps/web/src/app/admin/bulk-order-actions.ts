"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { tagOrders, UserError } from "@sf/core";
import { logged, requireShop } from "@/lib/server";

/** The order list's bulk bar: tag or untag the picked orders, or open their packing slips. */
export async function bulkOrdersAction(form: FormData) {
  const { shop, db, user } = await requireShop("orders");
  const ids = form.getAll("ids").map(String);
  // Back to the same view of the list.
  const back = new URLSearchParams(["show", "q", "tag", "product", "country", "code", "total", "before"].flatMap((k) => (form.get(`keep-${k}`) ? [[k, String(form.get(`keep-${k}`))]] : [])));
  const op = String(form.get("op") ?? "");
  if (op === "slips") {
    if (!ids.length) back.set("bulk", "none");
    else redirect(`/admin/orders/packing-slips?ids=${ids.join(",")}`);
  } else {
    const tag = String(form.get("bulkTag") ?? "");
    try {
      const done = await tagOrders(db, shop.id, ids, op === "remove" ? { remove: tag } : { add: tag });
      back.set("bulk", `${op === "remove" ? "untagged" : "tagged"}:${done.changed}:${done.full}:${done.tag}`);
      if (done.changed) await logged({ shop, user, db }, `${op === "remove" ? "Took the tag off" : "Tagged"} ${done.changed === 1 ? "1 order" : `${done.changed} orders`} “${done.tag}”`, { href: `/admin/orders?tag=${encodeURIComponent(done.tag)}` });
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      back.set("bulk", `error:${e.message}`);
    }
    revalidatePath("/admin/orders");
  }
  redirect(`/admin/orders${back.size ? `?${back}` : ""}`);
}
