import "server-only";
import { cookies } from "next/headers";
import { savedIdsFrom, savedProductIds } from "@sf/core";
import { currentBuyer } from "./buyer";
import { db } from "./server";

// Guests keep their saved products in a cookie; signed-in buyers on their account.
const name = (shopId: string) => `sf_saved_${shopId}`;

export async function readGuestSaved(shopId: string) {
  const raw = (await cookies()).get(name(shopId))?.value;
  if (!raw) return [];
  try {
    return savedIdsFrom(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function writeGuestSaved(shopId: string, ids: string[]) {
  const jar = await cookies();
  const clean = savedIdsFrom(ids);
  if (!clean.length) jar.delete(name(shopId));
  else jar.set(name(shopId), JSON.stringify(clean), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
}

/** The product ids this visitor saved, signed in or not. */
export async function savedIds(shopId: string) {
  const buyer = await currentBuyer(shopId);
  return buyer ? savedProductIds(await db(), buyer.id) : readGuestSaved(shopId);
}
