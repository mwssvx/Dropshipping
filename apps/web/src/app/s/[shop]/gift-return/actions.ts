"use server";
import { redirect } from "next/navigation";
import { findGiftOrder, requestReturn, UserError } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop, storeBase } from "../data";

export type GiftReturnState = { error?: string };

/** The gift's recipient asks to return it, with the code on the gift note. */
export async function giftReturnAction(handle: string, code: string, _: GiftReturnState, form: FormData): Promise<GiftReturnState> {
  const shop = await loadShop(handle);
  const order = await findGiftOrder(await db(), shop.id, code);
  if (!order) return { error: "We couldn't find a gift with that code." };
  try {
    await requestReturn(await db(), shop, order, {
      gift: { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? "") },
      reason: String(form.get("reason") ?? "") as never,
      note: String(form.get("note") ?? ""),
      items: form.getAll("lineId").map((id) => ({ lineId: String(id), quantity: Number(form.get(`qty-${id}`) ?? 0) || 0 })),
    });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  redirect(`${await storeBase(handle)}/gift-return?code=${encodeURIComponent(order.gift!.returnCode!)}`);
}
