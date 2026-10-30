import "server-only";
import { cookies } from "next/headers";
import { compareIdsFrom } from "@sf/core";

// The products a shopper is comparing, kept on their device as ids only.
const name = (shopId: string) => `sf_cmp_${shopId}`;

export async function readCompare(shopId: string) {
  const raw = (await cookies()).get(name(shopId))?.value;
  if (!raw) return [];
  try {
    return compareIdsFrom(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function writeCompare(shopId: string, ids: string[]) {
  const jar = await cookies();
  const clean = compareIdsFrom(ids);
  if (!clean.length) jar.delete(name(shopId));
  else jar.set(name(shopId), JSON.stringify(clean), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
}
