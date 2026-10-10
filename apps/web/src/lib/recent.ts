import "server-only";
import { cookies } from "next/headers";
import { recentIdsFrom } from "@sf/core";

/** Set on the shopper's device by RememberView; read here. Holds product ids only. */
export const recentCookie = (shopId: string) => `sf_rv_${shopId}`;

export async function readRecent(shopId: string) {
  const raw = (await cookies()).get(recentCookie(shopId))?.value;
  if (!raw) return [];
  try {
    return recentIdsFrom(JSON.parse(decodeURIComponent(raw)));
  } catch {
    return [];
  }
}
