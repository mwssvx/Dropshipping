"use server";
import { revalidatePath } from "next/cache";
import { addAdSpend, deleteAdSpend, parseMoney, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";

export type AdSpendState = { error?: string; saved?: boolean; values?: { day: string; channel: string; amount: string; productId: string; note: string } };

export async function addAdSpendAction(_: AdSpendState, form: FormData): Promise<AdSpendState> {
  const { shop, db, user } = await requireShop("money");
  const values = {
    day: String(form.get("day") ?? ""),
    channel: String(form.get("channel") ?? ""),
    amount: String(form.get("amount") ?? ""),
    productId: String(form.get("productId") ?? ""),
    note: String(form.get("note") ?? ""),
  };
  try {
    let amountMinor = 0;
    try {
      amountMinor = parseMoney(values.amount.trim().replace(/^[^\d]+/, ""));
    } catch {
      throw new UserError("Enter how much you spent, like 25.00.");
    }
    await addAdSpend(db, shop.id, { day: values.day, channel: values.channel as never, amountMinor, productId: values.productId || null, note: values.note }, { userId: user.id });
  } catch (e) {
    // Return what was typed: React clears the form after an action.
    if (e instanceof UserError) return { error: e.message, values };
    throw e;
  }
  revalidatePath("/admin/profit");
  revalidatePath("/admin/money");
  return { saved: true, values: { ...values, amount: "", note: "" } };
}

export async function deleteAdSpendAction(id: string) {
  const { shop, db } = await requireShop("money");
  await deleteAdSpend(db, shop.id, id);
  revalidatePath("/admin/profit");
  revalidatePath("/admin/money");
}
