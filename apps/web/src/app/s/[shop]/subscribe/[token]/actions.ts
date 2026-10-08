"use server";
import { redirect } from "next/navigation";
import { confirmNewsletterSignup } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop, storeBase } from "../../data";

export async function confirmSignupAction(handle: string, token: string) {
  const shop = await loadShop(handle);
  await confirmNewsletterSignup(await db(), shop.id, token);
  redirect(`${await storeBase(handle)}/subscribe/${encodeURIComponent(token)}?done=1`);
}
