"use server";
import { revalidatePath } from "next/cache";
import { blockBuyer, blockOrderBuyer, unblockBuyer, UserError } from "@sf/core";
import { logged, requireShop } from "@/lib/server";

export type BlockState = { error?: string; saved?: boolean };

/** Blocks an email address typed by hand. */
export async function blockEmailAction(_: BlockState, form: FormData): Promise<BlockState> {
  const { shop, db, user } = await requireShop("customers");
  const email = String(form.get("email") ?? "");
  try {
    await blockBuyer(db, shop.id, { email, note: String(form.get("note") ?? "") });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  await logged({ shop, user, db }, `Blocked ${email.trim().toLowerCase()} from checking out`, { href: "/admin/blocked" });
  revalidatePath("/admin/blocked");
  return { saved: true };
}

/** Blocks the email and address an order came from. */
export async function blockOrderBuyerAction(orderId: string, _: BlockState, form: FormData): Promise<BlockState> {
  const { shop, db, user } = await requireShop("orders");
  try {
    const order = await blockOrderBuyer(db, shop.id, orderId, String(form.get("note") ?? ""));
    await logged({ shop, user, db }, `Blocked the buyer of order #${order.number} from checking out`, { orderId, href: "/admin/blocked" });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/blocked");
  return { saved: true };
}

export async function unblockAction(id: string) {
  const { shop, db, user } = await requireShop("customers");
  const row = await unblockBuyer(db, shop.id, id);
  await logged({ shop, user, db }, `Unblocked ${row.label}`, { href: "/admin/blocked" });
  revalidatePath("/admin/blocked");
}
