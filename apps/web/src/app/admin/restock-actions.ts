"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cancelRestockOrder, createRestockOrder, emailRestockOrder, parseMoney, receiveRestock, UserError } from "@sf/core";
import { mailer, requireShop } from "@/lib/server";

export type RestockState = { error?: string; message?: string };

function cost(raw: FormDataEntryValue | null) {
  const s = String(raw ?? "").trim().replace(/^[^\d]+/, "");
  if (!s) return null;
  try {
    return parseMoney(s);
  } catch {
    throw new UserError("Enter costs like 4.50, or leave them empty.");
  }
}

function count(raw: FormDataEntryValue | null) {
  const s = String(raw ?? "").trim().replace(/,/g, "");
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) throw new UserError("Enter quantities as whole numbers.");
  return n;
}

export async function createRestockAction(_: RestockState, form: FormData): Promise<RestockState> {
  const { shop, db } = await requireShop("products");
  let id: string;
  try {
    const variantIds = [...form.keys()].filter((k) => k.startsWith("qty.")).map((k) => k.slice(4));
    const lines = variantIds.map((variantId) => ({ variantId, quantity: count(form.get(`qty.${variantId}`)), unitCostMinor: cost(form.get(`cost.${variantId}`)) }));
    const order = await createRestockOrder(db, shop.id, {
      supplierName: String(form.get("supplierName") ?? ""),
      supplierEmail: String(form.get("supplierEmail") ?? ""),
      expectedOn: String(form.get("expectedOn") ?? ""),
      note: String(form.get("note") ?? ""),
      lines: lines.filter((l) => l.quantity > 0),
    });
    id = order.id;
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/restock");
  redirect(`/admin/restock/${id}?created=1`);
}

export async function receiveRestockAction(id: string, _: RestockState, form: FormData): Promise<RestockState> {
  const { shop, db } = await requireShop("products");
  let result: { added: number; done: boolean };
  try {
    const received = [...form.keys()].filter((k) => k.startsWith("recv.")).map((k) => ({ lineId: k.slice(5), quantity: count(form.get(k)) }));
    result = await receiveRestock(db, shop.id, id, received);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/restock");
  revalidatePath(`/admin/restock/${id}`);
  revalidatePath("/admin/products");
  return { message: result.done ? `Added ${result.added} to your stock. Everything on this order is in.` : `Added ${result.added} to your stock. The rest is still on the way.` };
}

export async function cancelRestockAction(id: string, _: RestockState, _form: FormData): Promise<RestockState> {
  const { shop, db } = await requireShop("products");
  try {
    await cancelRestockOrder(db, shop.id, id);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/restock");
  revalidatePath(`/admin/restock/${id}`);
  return { message: "Cancelled. Anything that already arrived stays in your stock." };
}

/** Emails the order to the supplier; their reply comes back to whoever sent it. */
export async function emailRestockAction(id: string, _: RestockState, form: FormData): Promise<RestockState> {
  const { user, shop, db } = await requireShop("products");
  try {
    const { to } = await emailRestockOrder(db, mailer(), shop, id, { to: String(form.get("to") ?? ""), replyTo: user.email });
    revalidatePath(`/admin/restock/${id}`);
    return { message: `Sent to ${to}. Their reply comes to ${user.email}.` };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
