import "server-only";
import { cookies } from "next/headers";
import { getBuyer } from "@sf/core";
import { db } from "./server";

/** One cookie per store, so signing in to one store doesn't sign you out of another. */
const name = (shopId: string) => `sf_buyer_${shopId}`;

export async function currentBuyer(shopId: string) {
  return getBuyer(await db(), shopId, (await cookies()).get(name(shopId))?.value);
}

export async function buyerToken(shopId: string) {
  return (await cookies()).get(name(shopId))?.value;
}

export async function setBuyerCookie(shopId: string, token: string) {
  (await cookies()).set(name(shopId), token, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production", maxAge: 60 * 86_400 });
}

export async function clearBuyerCookie(shopId: string) {
  (await cookies()).delete(name(shopId));
}
