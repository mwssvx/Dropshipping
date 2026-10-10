"use server";
import { redirect } from "next/navigation";
import { confirmSignup } from "@sf/core";
import { campaigns } from "@/lib/server";
import { loadShop, storeBase } from "../../data";

export async function confirmSignupAction(handle: string, token: string) {
  const shop = await loadShop(handle);
  const done = await confirmSignup(await campaigns(), shop, token);
  redirect(`${await storeBase(handle)}/subscribe/${encodeURIComponent(token)}?done=1${done?.welcome ? "&welcome=1" : ""}`);
}
