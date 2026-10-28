"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { emailOrderUpdate, tagOrders, UserError } from "@sf/core";
import { fulfillment, logged, requireShop } from "@/lib/server";

/** The order list's bulk bar: tag or untag the picked orders, or open their packing slips or an update to email them. */
export async function bulkOrdersAction(form: FormData) {
  const { shop, db, user } = await requireShop("orders");
  const ids = form.getAll("ids").map(String);
  // Back to the same view of the list.
  const back = new URLSearchParams(["show", "q", "tag", "product", "country", "code", "total", "buyer", "before"].flatMap((k) => (form.get(`keep-${k}`) ? [[k, String(form.get(`keep-${k}`))]] : [])));
  const op = String(form.get("op") ?? "");
  if (op === "slips" || op === "email") {
    if (!ids.length) back.set("bulk", "none");
    else if (op === "slips") redirect(`/admin/orders/packing-slips?ids=${ids.join(",")}`);
    else redirect(`/admin/orders/email?ids=${ids.join(",")}${back.size ? `&back=${encodeURIComponent(back.toString())}` : ""}`);
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

export type OrderUpdateState = { error?: string };

/** Emails the buyers of the picked orders the merchant's update, then goes back to the list. */
export async function emailOrdersAction(ids: string[], back: string, _: OrderUpdateState, form: FormData): Promise<OrderUpdateState> {
  const { shop, db, user } = await requireShop("orders");
  let done: Awaited<ReturnType<typeof emailOrderUpdate>>;
  try {
    done = await emailOrderUpdate(await fulfillment(), shop.id, ids, { message: String(form.get("message") ?? "") });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  if (done.sent) await logged({ shop, user, db }, `Emailed an update to the buyers of ${done.sent === 1 ? "1 order" : `${done.sent} orders`}`, { href: "/admin/orders" });
  revalidatePath("/admin/orders", "layout");
  const params = new URLSearchParams(back);
  params.set("bulk", `emailed:${done.sent}:${done.skipped}:${done.failed}`);
  redirect(`/admin/orders?${params}`);
}
