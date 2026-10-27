"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { markTransferPaid, setBankTransfer, UserError } from "@sf/core";
import { requireShop } from "@/lib/server";
import { afterOrderPaid } from "@/lib/webhooks";

export type BankTransferState = { error?: string; saved?: boolean };

/** Turns bank transfers on with the account details and days to pay, or off. */
export async function bankTransferAction(_: BankTransferState, form: FormData): Promise<BankTransferState> {
  const { shop, db } = await requireShop("money");
  try {
    await setBankTransfer(db, shop, form.get("on") ? { details: String(form.get("details") ?? ""), days: Number(form.get("days")) } : null);
    revalidatePath("/admin/orders");
    return { saved: true };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

/** The transfer arrived: the order is paid, and goes to the supplier like any other. */
export async function markTransferPaidAction(orderId: string) {
  const { shop, db } = await requireShop("money");
  if (await markTransferPaid(db, shop.id, orderId)) afterOrderPaid(orderId);
  redirect(`/admin/orders/${orderId}?transfer=paid`);
}
