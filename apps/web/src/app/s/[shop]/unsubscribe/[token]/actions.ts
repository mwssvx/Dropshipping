"use server";
import { redirect } from "next/navigation";
import { unsubscribeByToken } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop, storeBase } from "../../data";

export async function unsubscribeAction(handle: string, token: string) {
  const shop = await loadShop(handle);
  await unsubscribeByToken(await db(), shop.id, token);
  redirect(`${await storeBase(handle)}/unsubscribe/${encodeURIComponent(token)}?done=1`);
}
